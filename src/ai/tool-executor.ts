import * as AuthPermission from "@effect-auth/core/Permission";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import type { MailAuthorizationError } from "../authorization/mail-authorization";
import type { MailResourceResolveError } from "../authorization/resources";
import { MailboxId, OperationId } from "../mailboxes/core";
import type { MailAddress } from "../mailboxes/core";
import { MailboxDraftEditing } from "../mailboxes/draft-editing";
import type { MailboxDraftEditingError } from "../mailboxes/draft-editing";
import { MailboxMessageReading } from "../mailboxes/message-reading";
import type {
  MailboxMessageReadingError,
  MailboxMessageReadResult,
  MailboxMessageListItem,
  MailboxThreadMessage,
  MailboxThreadResult,
} from "../mailboxes/message-reading";
import {
  AiToolExecution,
  CurrentMailboxOperationProvenance,
} from "../mailboxes/operation-provenance";
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
import { AiToolAudit, AiToolAuditEvent } from "./tool-audit";
import {
  AiToolArguments,
  AiToolCall,
  AiToolExecutionError,
  AiToolFailure,
  AiToolFailureResult,
  AiToolProtocolError,
  AiToolRunId,
  AiToolSuccessResult,
  AiToolResultData,
} from "./tool-protocol";
import type { AiToolResult } from "./tool-protocol";

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
    call: AiToolCall
  ) => Effect.Effect<
    AiToolResult,
    AiToolExecutionError | AiToolProtocolError,
    AuthPermission.CurrentPrincipal | CurrentAiToolScope
  >;
}

export const AiToolExecutor = Context.Service<AiToolExecutor>(
  "cloudflare-inbox/AiToolExecutor"
);

/** Foundation toolset has no names or handlers and therefore fails closed. */
export const AiToolExecutorFoundationLive = Layer.effect(
  AiToolExecutor,
  Effect.gen(function* () {
    const audit = yield* AiToolAudit;

    return AiToolExecutor.of({
      execute: (untrustedCall) =>
        Effect.gen(function* () {
          yield* AuthPermission.CurrentPrincipal;
          const scope = yield* CurrentAiToolScope;
          yield* Schema.decodeUnknownEffect(AiToolArguments)(
            untrustedCall.arguments
          ).pipe(
            Effect.mapError(
              () =>
                new AiToolProtocolError({
                  message: "AI tool arguments are not permitted",
                  reason: "forbidden-arguments",
                })
            )
          );
          const call = yield* Schema.decodeUnknownEffect(AiToolCall)(
            untrustedCall
          ).pipe(
            Effect.mapError(
              () =>
                new AiToolProtocolError({
                  message: "AI tool call is outside the protocol contract",
                  reason: "invalid-call",
                })
            )
          );

          yield* audit.record(
            new AiToolAuditEvent({
              callId: call.callId,
              mailboxId: scope.mailboxId,
              name: call.name,
              outcome: "rejected",
              runId: scope.runId,
              source: scope.source,
            })
          );

          return yield* Effect.fail(
            new AiToolProtocolError({
              callId: call.callId,
              message: "AI tool is not available",
              reason: "unknown-tool",
            })
          );
        }),
    });
  })
);

const strictDecodeOptions = { onExcessProperty: "error" } as const;

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
  reading: MailboxMessageReading,
  editing?: MailboxDraftEditing
) =>
  AiToolExecutor.of({
    execute: (untrustedCall) =>
      Effect.gen(function* () {
        yield* AuthPermission.CurrentPrincipal;
        const scope = yield* CurrentAiToolScope;
        yield* Schema.decodeUnknownEffect(AiToolArguments)(
          untrustedCall.arguments
        ).pipe(
          Effect.mapError(
            () =>
              new AiToolProtocolError({
                message: "AI tool arguments are not permitted",
                reason: "forbidden-arguments",
              })
          )
        );
        const call = yield* Schema.decodeUnknownEffect(AiToolCall)(
          untrustedCall
        ).pipe(
          Effect.mapError(
            () =>
              new AiToolProtocolError({
                message: "AI tool call is outside the protocol contract",
                reason: "invalid-call",
              })
          )
        );

        const record = (outcome: "failed" | "rejected" | "succeeded") =>
          audit.record(
            new AiToolAuditEvent({
              callId: call.callId,
              mailboxId: scope.mailboxId,
              name: call.name,
              outcome,
              runId: scope.runId,
              source: scope.source,
            })
          );
        const invalidArguments = Effect.gen(function* () {
          const failure = new AiToolFailure({
            code: "invalid-arguments",
            message: "Mail tool arguments are invalid",
            retryable: false,
          });
          yield* record("rejected");
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
          Schema.encodeUnknownEffect(schema)(output, strictDecodeOptions).pipe(
            Effect.flatMap((encoded) =>
              Schema.decodeUnknownEffect(AiToolResultData)(encoded)
            ),
            Effect.mapError(
              () =>
                new AiToolExecutionError({
                  callId: call.callId,
                  message: "Mail tool returned an invalid result",
                  reason: "invalid-result",
                  retryable: false,
                })
            ),
            Effect.tapError(() => record("failed")),
            Effect.tap(() => record("succeeded")),
            Effect.map(
              (encoded) =>
                new AiToolSuccessResult({
                  _tag: "AiToolSuccessResult",
                  callId: call.callId,
                  output: encoded,
                })
            )
          );
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
                return record(failureOutcome(failure)).pipe(
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
              yield* record("rejected");
              return yield* Effect.fail(
                new AiToolProtocolError({
                  callId: call.callId,
                  message: "AI tool is not available",
                  reason: "unknown-tool",
                })
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
            ).pipe(Effect.tapError(() => record("failed")));
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
            yield* record("rejected");
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
    const reading = yield* MailboxMessageReading;

    return mailExecutor(audit, reading);
  })
);

/** Interactive toolset adds authorized draft creation without outbound capability. */
export const AiToolExecutorMailInteractiveLive = Layer.effect(
  AiToolExecutor,
  Effect.gen(function* () {
    const audit = yield* AiToolAudit;
    const editing = yield* MailboxDraftEditing;
    const reading = yield* MailboxMessageReading;

    return mailExecutor(audit, reading, editing);
  })
);
