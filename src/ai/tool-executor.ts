import type * as AuthPermission from "@effect-auth/core/Permission";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { MailboxDraftEditing } from "#/modules/mailbox/application/MailboxDraftEditing";
import type {
  MailboxDraftEditingError,
  MailboxDraftEditingService,
} from "#/modules/mailbox/application/MailboxDraftEditing";
import { MailboxMessageReading } from "#/modules/mailbox/application/MailboxMessageReading";
import type {
  MailboxMessageReadingError,
  MailboxMessageReadResult,
  MailboxMessageListItem,
  MailboxMessageReadingService,
  MailboxThreadMessage,
  MailboxThreadResult,
} from "#/modules/mailbox/application/MailboxMessageReading";
import { MailboxId, OperationId } from "#/modules/mailbox/domain/Mailbox";
import type { MailAddress } from "#/modules/mailbox/domain/Mailbox";
import {
  AiToolExecution,
  CurrentMailboxOperationProvenance,
} from "#/modules/mailbox/ports/MailboxOperationProvenance";

import type { MailAuthorizationError } from "../authorization/mail-authorization";
import type { MailResourceResolveError } from "../authorization/resources";
import {
  MailCreateDraftArguments,
  MailCreateDraftSuccess,
  MailReadArguments,
  MailReadSuccess,
  MailSearchArguments,
  MailSearchSuccess,
  MailThreadArguments,
  MailThreadSuccess,
  mailPlainTextMaxLength,
  mailSearchDefaultLimit,
  mailThreadMaxMessages,
} from "./mail-tools";
import { AiToolAudit, AiToolAuditEvent, AiToolAuditReason } from "./tool-audit";
import type { AiToolAuditReason as AiToolAuditReasonValue } from "./tool-audit";
import {
  AiToolArguments,
  AiToolCall,
  AiToolCallId,
  AiToolExecutionError,
  AiToolFailure,
  AiToolFailureResult,
  AiToolProtocolError,
  AiToolRunId,
  AiToolName,
  AiToolSuccessResult,
  AiToolResultData,
} from "./tool-protocol";
import type { AiToolResult } from "./tool-protocol";
import { AiToolRunBudget } from "./tool-run-budget";
import type { AiToolBudgetExceeded, AiToolKind } from "./tool-run-budget";

export const CurrentAiToolScopeSchema = Schema.Struct({
  mailboxId: MailboxId,
  runId: AiToolRunId,
  source: Schema.Literal("interactive-session"),
});
export type CurrentAiToolScope = Schema.Schema.Type<
  typeof CurrentAiToolScopeSchema
>;

/** Trusted request scope supplied by the interactive-session boundary, never by the model. */
export const CurrentAiToolScope = Context.Service<CurrentAiToolScope>(
  "cloudflare-inbox/CurrentAiToolScope"
);

export interface AiToolExecutor {
  readonly execute: (
    call: unknown
  ) => Effect.Effect<
    AiToolResult,
    AiToolExecutionError | AiToolProtocolError,
    AuthPermission.CurrentPrincipal | CurrentAiToolScope
  >;
}

export const AiToolExecutor = Context.Service<AiToolExecutor>(
  "cloudflare-inbox/AiToolExecutor"
);

const strictDecodeOptions = { onExcessProperty: "error" } as const;
const textEncoder = new TextEncoder();
const CallMetadata = Schema.Struct({ callId: AiToolCallId, name: AiToolName });
const CallEnvelope = Schema.Struct({
  arguments: Schema.Unknown,
  callId: AiToolCallId,
  name: AiToolName,
});

type CallMetadata = Schema.Schema.Type<typeof CallMetadata>;

const safeCallMetadata = (value: unknown) =>
  Effect.sync(() => {
    try {
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        return null;
      }
      const prototype = Object.getPrototypeOf(value);
      if (
        prototype !== Object.prototype &&
        prototype !== AiToolCall.prototype &&
        prototype !== null
      ) {
        return null;
      }
      const descriptors = Object.getOwnPropertyDescriptors(value);
      const { callId, name } = descriptors;
      if (
        callId === undefined ||
        name === undefined ||
        !("value" in callId) ||
        !("value" in name)
      ) {
        return null;
      }
      return { callId: callId.value, name: name.value };
    } catch {
      return null;
    }
  }).pipe(
    Effect.flatMap((metadata) =>
      metadata === null
        ? Effect.succeed(null)
        : Schema.decodeUnknownEffect(CallMetadata)(metadata).pipe(
            Effect.option,
            Effect.map((option) =>
              option._tag === "Some" ? option.value : null
            )
          )
    )
  );

const safelyMapCallEnvelope = (value: unknown) =>
  Effect.try({
    try: () => {
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("Envelope must be an object");
      }
      const prototype = Object.getPrototypeOf(value);
      if (
        prototype !== Object.prototype &&
        prototype !== AiToolCall.prototype &&
        prototype !== null
      ) {
        throw new Error("Envelope has an unsafe prototype");
      }
      if (Object.getOwnPropertySymbols(value).length > 0) {
        throw new Error("Envelope has symbol fields");
      }
      const descriptors = Object.getOwnPropertyDescriptors(value);
      const keys = Object.keys(descriptors);
      if (
        keys.length !== 3 ||
        !keys.includes("arguments") ||
        !keys.includes("callId") ||
        !keys.includes("name")
      ) {
        throw new Error("Envelope fields do not match the protocol");
      }
      const argumentsDescriptor = descriptors.arguments;
      const callIdDescriptor = descriptors.callId;
      const nameDescriptor = descriptors.name;
      if (
        argumentsDescriptor === undefined ||
        callIdDescriptor === undefined ||
        nameDescriptor === undefined ||
        !("value" in argumentsDescriptor) ||
        !("value" in callIdDescriptor) ||
        !("value" in nameDescriptor)
      ) {
        throw new Error("Envelope must contain data fields only");
      }

      let entries = 0;
      // oxlint-disable-next-line eslint/complexity -- Every branch rejects one unsafe JSON shape.
      const copyJson = (input: unknown, depth: number): Schema.Json => {
        if (depth > 8) {
          throw new Error("JSON nesting is too deep");
        }
        if (
          input === null ||
          typeof input === "string" ||
          typeof input === "boolean"
        ) {
          return input;
        }
        if (typeof input === "number" && Number.isFinite(input)) {
          return input;
        }
        if (typeof input !== "object") {
          throw new TypeError("Value is not JSON");
        }
        if (Object.getOwnPropertySymbols(input).length > 0) {
          throw new Error("JSON has symbol fields");
        }
        const inputPrototype = Object.getPrototypeOf(input);
        const inputDescriptors = Object.getOwnPropertyDescriptors(input);
        if (Array.isArray(input)) {
          if (inputPrototype !== Array.prototype) {
            throw new Error("JSON array has an unsafe prototype");
          }
          const lengthDescriptor = inputDescriptors.length;
          if (
            lengthDescriptor === undefined ||
            !("value" in lengthDescriptor) ||
            typeof lengthDescriptor.value !== "number"
          ) {
            throw new Error("JSON array length is invalid");
          }
          const length = lengthDescriptor.value;
          if (Object.keys(inputDescriptors).length !== length + 1) {
            throw new Error("JSON arrays must be dense and contain no fields");
          }
          entries += length;
          if (entries > 256) {
            throw new Error("JSON has too many entries");
          }
          const output: Schema.Json[] = [];
          for (let index = 0; index < length; index += 1) {
            const descriptor = inputDescriptors[String(index)];
            if (descriptor === undefined || !("value" in descriptor)) {
              throw new Error("JSON arrays must contain data fields only");
            }
            output.push(copyJson(descriptor.value, depth + 1));
          }
          return output;
        }
        if (inputPrototype !== Object.prototype && inputPrototype !== null) {
          throw new Error("JSON object has an unsafe prototype");
        }
        const output = Object.create(null) as Record<string, Schema.Json>;
        const objectKeys = Object.keys(inputDescriptors);
        entries += objectKeys.length;
        if (entries > 256) {
          throw new Error("JSON has too many entries");
        }
        for (const key of objectKeys) {
          const descriptor = inputDescriptors[key];
          if (descriptor === undefined || !("value" in descriptor)) {
            throw new Error("JSON objects must contain data fields only");
          }
          Object.defineProperty(output, key, {
            configurable: true,
            enumerable: true,
            value: copyJson(descriptor.value, depth + 1),
            writable: true,
          });
        }
        return output;
      };

      return {
        arguments: copyJson(argumentsDescriptor.value, 1),
        callId: callIdDescriptor.value,
        name: nameDescriptor.value,
      };
    },
    catch: () =>
      new AiToolProtocolError({
        message: "AI tool call is outside the protocol contract",
        reason: "invalid-call",
      }),
  });

const decodeCall = (value: unknown) =>
  safelyMapCallEnvelope(value).pipe(
    Effect.flatMap((envelope) =>
      Schema.decodeUnknownEffect(CallEnvelope)(envelope, strictDecodeOptions)
    ),
    Effect.mapError(
      () =>
        new AiToolProtocolError({
          message: "AI tool call is outside the protocol contract",
          reason: "invalid-call",
        })
    ),
    Effect.flatMap((envelope) =>
      Schema.decodeUnknownEffect(AiToolArguments)(
        envelope.arguments,
        strictDecodeOptions
      ).pipe(
        Effect.mapError(
          () =>
            new AiToolProtocolError({
              callId: envelope.callId,
              message: "AI tool arguments are not permitted",
              reason: "forbidden-arguments",
            })
        ),
        Effect.map(
          (argumentsValue) =>
            new AiToolCall({
              arguments: argumentsValue,
              callId: envelope.callId,
              name: envelope.name,
            })
        )
      )
    )
  );

const toolKind = (name: AiToolName): AiToolKind => {
  switch (name) {
    case "mail_create_draft": {
      return "mutation";
    }
    case "mail_read":
    case "mail_search":
    case "mail_thread": {
      return "read";
    }
    default: {
      return "unknown";
    }
  }
};

const utf8JsonBytes = (value: unknown) =>
  Effect.try({
    try: () => textEncoder.encode(JSON.stringify(value)).byteLength,
    catch: () =>
      new AiToolProtocolError({
        message: "AI tool data could not be encoded",
        reason: "invalid-call",
      }),
  });

const budgetReason = (error: AiToolBudgetExceeded): AiToolAuditReasonValue =>
  Schema.decodeUnknownSync(AiToolAuditReason)(`limit-${error.limit}`);

const budgetFailure = (callId: AiToolCallId) =>
  new AiToolFailureResult({
    _tag: "AiToolFailureResult",
    callId,
    error: new AiToolFailure({
      code: "limit-exceeded",
      message: "AI tool run limit was exceeded",
      retryable: false,
    }),
  });

const auditExecutionError = (callId: AiToolCallId) =>
  new AiToolExecutionError({
    callId,
    message: "AI tool execution could not be audited",
    reason: "failed",
    retryable: true,
  });

/** Foundation toolset has no names or handlers and therefore fails closed. */
export const AiToolExecutorFoundationLive = Layer.effect(
  AiToolExecutor,
  Effect.gen(function* () {
    const audit = yield* AiToolAudit;
    const budget = yield* AiToolRunBudget;

    return AiToolExecutor.of({
      execute: (untrustedCall) =>
        Effect.gen(function* () {
          const scope = yield* CurrentAiToolScope;
          const metadata = yield* safeCallMetadata(untrustedCall);
          if (metadata === null) {
            return yield* Effect.fail(
              new AiToolProtocolError({
                message: "AI tool call is outside the protocol contract",
                reason: "invalid-call",
              })
            );
          }

          const record = (
            outcome: AiToolAuditEvent["outcome"],
            reason: AiToolAuditReasonValue
          ) =>
            audit
              .record(
                new AiToolAuditEvent({
                  callId: metadata.callId,
                  kind: "unknown",
                  mailboxId: scope.mailboxId,
                  name: metadata.name,
                  outcome,
                  reason,
                  runId: scope.runId,
                  source: scope.source,
                })
              )
              .pipe(
                Effect.mapError(() => auditExecutionError(metadata.callId))
              );

          const consumed = yield* budget
            .consumeCall(metadata.callId, metadata.name)
            .pipe(Effect.result);
          if (consumed._tag === "Failure") {
            yield* record("rejected", budgetReason(consumed.failure));
            return budgetFailure(metadata.callId);
          }

          const decoded = yield* decodeCall(untrustedCall).pipe(Effect.result);
          if (decoded._tag === "Failure") {
            const reason =
              decoded.failure.reason === "limit-exceeded"
                ? "invalid-call"
                : decoded.failure.reason;
            yield* record("rejected", reason);
            return yield* Effect.fail(
              new AiToolProtocolError({
                callId: metadata.callId,
                message: decoded.failure.message,
                reason: decoded.failure.reason,
              })
            );
          }

          yield* record("rejected", "unknown-tool");

          return yield* Effect.fail(
            new AiToolProtocolError({
              callId: metadata.callId,
              message: "AI tool is not available",
              reason: "unknown-tool",
            })
          );
        }),
    });
  })
);

const truncate = (value: string, maxLength: number) =>
  [...value].slice(0, maxLength).join("");

const projectAddress = (address: MailAddress) => ({
  address: address.address,
  ...(address.displayName === undefined
    ? {}
    : { displayName: truncate(address.displayName, 100) }),
});

const projectAddresses = (addresses: readonly MailAddress[]) =>
  addresses.slice(0, 3).map(projectAddress);

const projectText = (text: string | undefined) => ({
  ...(text === undefined
    ? {}
    : { plainText: truncate(text, mailPlainTextMaxLength) }),
  textTruncated:
    text !== undefined && [...text].length > mailPlainTextMaxLength,
});

const projectSearchItem = (message: MailboxMessageListItem) => ({
  activityAt: message.activityAt,
  direction: message.direction,
  id: message.id,
  recipients: projectAddresses(message.recipients),
  ...(message.sender === undefined
    ? {}
    : { sender: projectAddress(message.sender) }),
  snippet: truncate(message.snippet, 300),
  subject: truncate(message.subject, 300),
  threadId: message.threadId,
});

const projectMessageContent = (
  message: MailboxThreadMessage | MailboxMessageReadResult
) => ({
  activityAt: message.activityAt,
  cc: projectAddresses(message.cc),
  direction: message.direction,
  hasAttachments:
    "hasAttachments" in message
      ? message.hasAttachments
      : message.attachments.length > 0,
  id: message.id,
  ...(message.sender === undefined
    ? {}
    : { sender: projectAddress(message.sender) }),
  ...projectText(message.textBody),
  to: projectAddresses(message.to),
});

type ExpectedToolError =
  | MailAuthorizationError
  | MailboxDraftEditingError
  | MailboxMessageReadingError;

const expectedFailure = (error: ExpectedToolError) => {
  switch (error._tag) {
    case "AuthorizationError": {
      return new AiToolFailure({
        code: "denied",
        message: "Mail access was denied",
        retryable: false,
      });
    }
    case "MailboxMessageReadingError": {
      const { reason } = error;
      switch (reason) {
        case "invalid-input": {
          return new AiToolFailure({
            code: "invalid-arguments",
            message: "Mail tool arguments are invalid",
            retryable: false,
          });
        }
        case "not-found": {
          return new AiToolFailure({
            code: "unavailable",
            message: "Mail content is unavailable",
            retryable: false,
          });
        }
        case "storage": {
          return new AiToolFailure({
            code: "execution-failed",
            message: "Mail content could not be loaded",
            retryable: true,
          });
        }
        default: {
          return reason satisfies never;
        }
      }
    }
    case "MailboxDraftEditingError": {
      const { reason } = error;
      switch (reason) {
        case "invalid-input": {
          return new AiToolFailure({
            code: "invalid-arguments",
            message: "Draft content is invalid",
            retryable: false,
          });
        }
        case "not-found": {
          return new AiToolFailure({
            code: "unavailable",
            message: "Draft is unavailable",
            retryable: false,
          });
        }
        case "conflict": {
          return new AiToolFailure({
            code: "execution-failed",
            message: "Draft could not be created",
            retryable: false,
          });
        }
        case "storage": {
          return new AiToolFailure({
            code: "execution-failed",
            message: "Draft could not be created",
            retryable: true,
          });
        }
        default: {
          return reason satisfies never;
        }
      }
    }
    case "MailResourceResolveError": {
      const resolveError: MailResourceResolveError = error;
      return new AiToolFailure({
        code:
          resolveError.reason === "not-found"
            ? "unavailable"
            : "execution-failed",
        message:
          resolveError.reason === "not-found"
            ? "Mail content is unavailable"
            : "Mail content could not be loaded",
        retryable: resolveError.reason === "storage",
      });
    }
    case "PermissionCheckError": {
      return new AiToolFailure({
        code: "execution-failed",
        message: "Mail authorization could not be checked",
        retryable: true,
      });
    }
    default: {
      return error satisfies never;
    }
  }
};

const failureOutcome = (failure: AiToolFailure) =>
  failure.code === "denied" || failure.code === "invalid-arguments"
    ? ("rejected" as const)
    : ("failed" as const);

const failureReason = (failure: AiToolFailure): AiToolAuditReasonValue => {
  switch (failure.code) {
    case "denied":
    case "execution-failed":
    case "invalid-arguments":
    case "invalid-result":
    case "unavailable": {
      return failure.code;
    }
    case "limit-exceeded": {
      return "limit-replay-mismatch";
    }
    default: {
      return failure.code satisfies never;
    }
  }
};

const operationIdFrom = (runId: AiToolRunId, callId: AiToolCall["callId"]) => {
  const encoded = `${runId.length}:${runId}:${callId.length}:${callId}`;
  const readable = `ai-draft:${encoded}`;
  const value =
    readable.length <= 128
      ? Effect.succeed(readable)
      : Effect.tryPromise({
          try: () =>
            crypto.subtle.digest("SHA-256", new TextEncoder().encode(encoded)),
          catch: (cause) => cause,
        }).pipe(
          Effect.map(
            (digest) =>
              `ai-draft-sha256:${[...new Uint8Array(digest)]
                .map((byte) => byte.toString(16).padStart(2, "0"))
                .join("")}`
          )
        );

  return value.pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(OperationId)),
    Effect.mapError(
      () =>
        new AiToolExecutionError({
          callId,
          message: "Draft operation could not be prepared",
          reason: "failed",
          retryable: true,
        })
    )
  );
};

const mailExecutor = (
  audit: AiToolAudit,
  budget: AiToolRunBudget,
  reading: MailboxMessageReadingService,
  editing?: MailboxDraftEditingService
) =>
  AiToolExecutor.of({
    execute: (untrustedCall) =>
      Effect.gen(function* () {
        const scope = yield* CurrentAiToolScope;
        const metadata = yield* safeCallMetadata(untrustedCall);
        if (metadata === null) {
          return yield* Effect.fail(
            new AiToolProtocolError({
              message: "AI tool call is outside the protocol contract",
              reason: "invalid-call",
            })
          );
        }
        const kind =
          metadata.name === "mail_create_draft" && editing === undefined
            ? "unknown"
            : toolKind(metadata.name);
        const record = (
          outcome: AiToolAuditEvent["outcome"],
          reason: AiToolAuditReasonValue
        ) =>
          audit
            .record(
              new AiToolAuditEvent({
                callId: metadata.callId,
                kind,
                mailboxId: scope.mailboxId,
                name: metadata.name,
                outcome,
                reason,
                runId: scope.runId,
                source: scope.source,
              })
            )
            .pipe(Effect.mapError(() => auditExecutionError(metadata.callId)));

        const consumed = yield* budget
          .consumeCall(metadata.callId, metadata.name)
          .pipe(Effect.result);
        if (consumed._tag === "Failure") {
          yield* record("rejected", budgetReason(consumed.failure));
          return budgetFailure(metadata.callId);
        }

        const decodedCall = yield* decodeCall(untrustedCall).pipe(
          Effect.result
        );
        if (decodedCall._tag === "Failure") {
          const reason =
            decodedCall.failure.reason === "limit-exceeded"
              ? "invalid-call"
              : decodedCall.failure.reason;
          yield* record("rejected", reason);
          return yield* Effect.fail(
            new AiToolProtocolError({
              callId: metadata.callId,
              message: decodedCall.failure.message,
              reason: decodedCall.failure.reason,
            })
          );
        }
        const call = decodedCall.success;

        if (kind === "unknown") {
          yield* record("rejected", "unknown-tool");
          return yield* Effect.fail(
            new AiToolProtocolError({
              callId: call.callId,
              message: "AI tool is not available",
              reason: "unknown-tool",
            })
          );
        }

        const argumentBytes = yield* utf8JsonBytes(call.arguments);
        const inputConsumed = yield* budget
          .consumeInput(call.callId, kind, argumentBytes)
          .pipe(Effect.result);
        if (inputConsumed._tag === "Failure") {
          yield* record("rejected", budgetReason(inputConsumed.failure));
          return budgetFailure(call.callId);
        }

        const invalidArguments = Effect.gen(function* () {
          const failure = new AiToolFailure({
            code: "invalid-arguments",
            message: "Mail tool arguments are invalid",
            retryable: false,
          });
          yield* record("rejected", "invalid-arguments");
          return new AiToolFailureResult({
            _tag: "AiToolFailureResult",
            callId: call.callId,
            error: failure,
          });
        });
        const decodeArguments = <S extends Schema.Top>(schema: S) =>
          Schema.decodeUnknownEffect(schema)(
            call.arguments,
            strictDecodeOptions
          ).pipe(Effect.option);
        const finish = <S extends Schema.Top>(schema: S, output: unknown) =>
          Effect.gen(function* () {
            const encodedResult = yield* Schema.encodeUnknownEffect(schema)(
              output,
              strictDecodeOptions
            ).pipe(
              Effect.flatMap((encoded) =>
                Schema.decodeUnknownEffect(AiToolResultData)(
                  encoded,
                  strictDecodeOptions
                )
              ),
              Effect.result
            );
            if (encodedResult._tag === "Failure") {
              yield* record("failed", "invalid-result");
              return yield* Effect.fail(
                new AiToolExecutionError({
                  callId: call.callId,
                  message: "Mail tool returned an invalid result",
                  reason: "invalid-result",
                  retryable: false,
                })
              );
            }

            const encoded = encodedResult.success;
            const resultBytes = textEncoder.encode(
              JSON.stringify(encoded)
            ).byteLength;
            const resultConsumed = yield* budget
              .consumeResult(call.callId, resultBytes)
              .pipe(Effect.result);
            if (resultConsumed._tag === "Failure") {
              yield* record("rejected", budgetReason(resultConsumed.failure));
              return budgetFailure(call.callId);
            }

            yield* record("succeeded", "completed");
            return new AiToolSuccessResult({
              _tag: "AiToolSuccessResult",
              callId: call.callId,
              output: encoded,
            });
          });
        const run = <A, S extends Schema.Top>(
          effect: Effect.Effect<
            A,
            ExpectedToolError,
            AuthPermission.CurrentPrincipal
          >,
          schema: S,
          project: (value: A) => unknown
        ) =>
          effect.pipe(
            Effect.provideService(
              CurrentMailboxOperationProvenance,
              new AiToolExecution({
                callId: call.callId,
                mailboxId: scope.mailboxId,
                runId: scope.runId,
                toolName: call.name,
              })
            ),
            Effect.matchEffect({
              onFailure: (error) => {
                const failure = expectedFailure(error);
                return record(
                  failureOutcome(failure),
                  failureReason(failure)
                ).pipe(
                  Effect.as(
                    new AiToolFailureResult({
                      _tag: "AiToolFailureResult",
                      callId: call.callId,
                      error: failure,
                    })
                  )
                );
              },
              onSuccess: (value) => finish(schema, project(value)),
            })
          );
        const viewInput = (
          view: MailReadArguments["view"] | MailThreadArguments["view"]
        ) =>
          "folderId" in view
            ? {
                _tag: "Folder" as const,
                folderId: view.folderId,
                mailboxId: scope.mailboxId,
              }
            : {
                _tag: "Label" as const,
                labelId: view.labelId,
                mailboxId: scope.mailboxId,
              };

        switch (call.name) {
          case "mail_create_draft": {
            if (editing === undefined) {
              return yield* Effect.die(
                "Unavailable draft tool passed availability check"
              );
            }
            const decoded = yield* decodeArguments(MailCreateDraftArguments);
            if (decoded._tag === "None") {
              return yield* invalidArguments;
            }
            const input = decoded.value;
            const operationId = yield* operationIdFrom(
              scope.runId,
              call.callId
            ).pipe(Effect.tapError(() => record("failed", "execution-failed")));
            return yield* run(
              editing.create({
                content: {
                  bcc: input.bcc,
                  cc: input.cc,
                  subject: input.subject,
                  textBody: input.plainText,
                  to: input.to,
                },
                mailboxId: scope.mailboxId,
                operationId,
              }),
              MailCreateDraftSuccess,
              (draft) => ({ draftId: draft.id, version: draft.version })
            );
          }
          case "mail_read": {
            const decoded = yield* decodeArguments(MailReadArguments);
            if (decoded._tag === "None") {
              return yield* invalidArguments;
            }
            const input = decoded.value;
            return yield* run(
              reading.readMessage({
                ...viewInput(input.view),
                messageId: input.messageId,
              }),
              MailReadSuccess,
              (message) => ({
                message: {
                  ...projectMessageContent(message),
                  subject: truncate(message.subject, 300),
                  threadId: message.threadId,
                },
              })
            );
          }
          case "mail_search": {
            const decoded = yield* decodeArguments(MailSearchArguments);
            if (decoded._tag === "None") {
              return yield* invalidArguments;
            }
            const input = decoded.value;
            return yield* run(
              reading.listView({
                ...viewInput(input.view),
                cursor: input.cursor,
                hasAttachment: input.hasAttachment,
                limit: input.limit ?? mailSearchDefaultLimit,
                query: input.query,
                read: input.read,
                starred: input.starred,
              }),
              MailSearchSuccess,
              (result) => ({
                items: result.items
                  .slice(0, input.limit ?? mailSearchDefaultLimit)
                  .map(projectSearchItem),
                ...(result.nextCursor === undefined
                  ? {}
                  : { nextCursor: result.nextCursor }),
              })
            );
          }
          case "mail_thread": {
            const decoded = yield* decodeArguments(MailThreadArguments);
            if (decoded._tag === "None") {
              return yield* invalidArguments;
            }
            const input = decoded.value;
            return yield* run(
              reading.openThread({
                ...viewInput(input.view),
                messageId: input.anchorMessageId,
                threadId: input.threadId,
              }),
              MailThreadSuccess,
              (result: MailboxThreadResult) => {
                const messages = result.messages.slice(-mailThreadMaxMessages);
                return {
                  hasMore:
                    result.hasMore || messages.length < result.messages.length,
                  messages: messages.map(projectMessageContent),
                  thread: {
                    id: result.thread.id,
                    latestActivityAt: result.thread.latestActivityAt,
                    messageCount: result.thread.messageCount,
                    subject: truncate(result.thread.subject, 300),
                    unreadCount: result.thread.unreadCount,
                  },
                };
              }
            );
          }
          default: {
            yield* record("rejected", "unknown-tool");
            return yield* Effect.fail(
              new AiToolProtocolError({
                callId: call.callId,
                message: "AI tool is not available",
                reason: "unknown-tool",
              })
            );
          }
        }
      }),
  });

/** Concrete read-only toolset; model input never supplies mailbox or principal authority. */
export const AiToolExecutorMailReadOnlyLive = Layer.effect(
  AiToolExecutor,
  Effect.gen(function* () {
    const audit = yield* AiToolAudit;
    const budget = yield* AiToolRunBudget;
    const reading = yield* MailboxMessageReading;

    return mailExecutor(audit, budget, reading);
  })
);

/** Interactive toolset adds authorized draft creation without outbound capability. */
export const AiToolExecutorMailInteractiveLive = Layer.effect(
  AiToolExecutor,
  Effect.gen(function* () {
    const audit = yield* AiToolAudit;
    const budget = yield* AiToolRunBudget;
    const editing = yield* MailboxDraftEditing;
    const reading = yield* MailboxMessageReading;

    return mailExecutor(audit, budget, reading, editing);
  })
);
