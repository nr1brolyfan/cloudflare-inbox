import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { MailboxPublicError } from "../http/mailbox-contract";
import { MailboxPublicErrorSchema } from "../http/mailbox-contract";
import type { MailboxInlineAttachmentInput } from "../mailboxes/attachment-reading";
import { isSafeInlineImageMimeType } from "../mailboxes/attachment-reading";
import { MailboxRecordSchema } from "../mailboxes/core";
import type {
  CreateMailboxDraftCommand,
  GetMailboxDraftQuery,
  UpdateMailboxDraftCommand,
} from "../mailboxes/draft-editing";
import { DraftEditorDraft } from "../mailboxes/draft-editing";
import type { MailboxMessageActionCommand } from "../mailboxes/message-actions";
import { MailboxMessageActionResult } from "../mailboxes/message-actions";
import type { MailboxMessageHtmlInput } from "../mailboxes/message-html";
import { MailboxMessageHtmlResult } from "../mailboxes/message-html";
import type {
  MailboxMessageListInput,
  OpenMailboxThreadInput,
} from "../mailboxes/message-reading";
import {
  MailboxMessageListResult,
  MailboxThreadResult,
} from "../mailboxes/message-reading";
import { MailboxNavigationResult } from "../mailboxes/navigation";
import { BackendClient } from "./website-platform";

export type MailboxPublicStatus = 400 | 401 | 403 | 404 | 409 | 500 | 502;

export interface MailboxServerErrorResult {
  readonly error: MailboxPublicError;
  readonly ok: false;
  readonly status: MailboxPublicStatus;
}

export type MailboxServerResult =
  | {
      readonly mailbox: Schema.Codec.Encoded<typeof MailboxRecordSchema>;
      readonly ok: true;
    }
  | MailboxServerErrorResult;

export type MailboxNavigationServerResult =
  | {
      readonly navigation: Schema.Codec.Encoded<typeof MailboxNavigationResult>;
      readonly ok: true;
    }
  | MailboxServerErrorResult;

export type MailboxMessageListServerResult =
  | {
      readonly messages: Schema.Codec.Encoded<typeof MailboxMessageListResult>;
      readonly ok: true;
    }
  | MailboxServerErrorResult;

export type MailboxMessageHtmlServerResult =
  | {
      readonly html: Schema.Codec.Encoded<typeof MailboxMessageHtmlResult>;
      readonly ok: true;
    }
  | MailboxServerErrorResult;

export type MailboxInlineAttachmentServerResult =
  | {
      readonly bytes: Uint8Array;
      readonly mimeType: string;
      readonly ok: true;
    }
  | MailboxServerErrorResult;

export type MailboxMessageActionServerResult =
  | {
      readonly action: Schema.Codec.Encoded<typeof MailboxMessageActionResult>;
      readonly ok: true;
    }
  | MailboxServerErrorResult;

export type MailboxThreadServerResult =
  | {
      readonly thread: Schema.Codec.Encoded<typeof MailboxThreadResult>;
      readonly ok: true;
    }
  | MailboxServerErrorResult;

export type MailboxDraftServerResult =
  | {
      readonly draft: Schema.Codec.Encoded<typeof DraftEditorDraft>;
      readonly ok: true;
    }
  | MailboxServerErrorResult;

interface ForwardMailboxRequestInput {
  readonly incoming: Request;
  readonly method: "GET" | "PATCH" | "POST";
  readonly operation: string;
  readonly path: string;
  readonly payload?: Readonly<Record<string, unknown>>;
}

type ForwardMailboxResult =
  | { readonly body: unknown; readonly ok: true }
  | MailboxServerErrorResult;

const forwardedHeaderNames = [
  "cookie",
  "origin",
  "referer",
  "user-agent",
] as const;

const publicErrors = {
  bad_request: {
    _tag: "AuthBadRequestError",
    message: "Invalid mailbox request",
    status: 400,
  },
  conflict: {
    _tag: "AuthConflictError",
    message: "Mailbox already exists",
    status: 409,
  },
  internal_error: {
    _tag: "AuthInternalError",
    message: "Mailbox operation failed",
    status: 500,
  },
  not_found: {
    _tag: "AuthNotFoundError",
    message: "Mailbox not found",
    status: 404,
  },
  policy_denied: {
    _tag: "AuthPolicyDeniedError",
    message: "Mailbox operation denied",
    status: 403,
  },
  request_rejected: {
    _tag: "AuthRequestRejectedError",
    message: "Request rejected",
    status: 403,
  },
  unauthenticated: {
    _tag: "AuthUnauthenticatedError",
    message: "Unauthenticated",
    status: 401,
  },
} as const;

const isPublicErrorCode = (code: string): code is keyof typeof publicErrors =>
  Object.hasOwn(publicErrors, code);

const invalidBackendResponse = (): MailboxServerErrorResult => ({
  error: {
    _tag: "AuthInternalError",
    code: "internal_error",
    message: "Invalid Backend response",
  },
  ok: false,
  status: 502,
});

const policyDeniedMessage = (body: object, operation: string) => {
  if (!("message" in body) || typeof body.message !== "string") {
    return publicErrors.policy_denied.message;
  }

  const administrativeOperation =
    operation === "website.mailbox.bootstrap" ||
    operation === "website.mailbox.rename";
  return administrativeOperation &&
    (body.message === "Mailbox owner account required" ||
      body.message === "Complete account verification and sign in again")
    ? body.message
    : publicErrors.policy_denied.message;
};

const operationErrorMessage = (
  code: keyof typeof publicErrors,
  operation: string
) => {
  if (operation.startsWith("website.mailbox.draft")) {
    if (code === "bad_request") {
      return "Invalid draft content";
    }
    if (code === "conflict") {
      return "Draft changed";
    }
    return code === "not_found"
      ? "Draft not found"
      : publicErrors[code].message;
  }
  if (operation !== "website.mailbox.message_action") {
    return publicErrors[code].message;
  }
  if (code === "bad_request") {
    return "Invalid mailbox message action";
  }
  if (code === "conflict") {
    return "Mailbox message changed";
  }
  return code === "not_found"
    ? "Mailbox message not found"
    : publicErrors[code].message;
};

export interface MailboxBackendOperationsShape {
  readonly actOnMessage: (input: {
    readonly command: MailboxMessageActionCommand;
    readonly incoming: Request;
  }) => Effect.Effect<MailboxMessageActionServerResult>;
  readonly bootstrapOwner: (input: {
    readonly displayName: string;
    readonly incoming: Request;
  }) => Effect.Effect<MailboxServerResult>;
  readonly createDraft: (input: {
    readonly command: CreateMailboxDraftCommand;
    readonly incoming: Request;
  }) => Effect.Effect<MailboxDraftServerResult>;
  readonly getDraft: (input: {
    readonly incoming: Request;
    readonly query: GetMailboxDraftQuery;
  }) => Effect.Effect<MailboxDraftServerResult>;
  readonly getNavigation: (
    incoming: Request
  ) => Effect.Effect<MailboxNavigationServerResult>;
  readonly getMessageHtml: (input: {
    readonly incoming: Request;
    readonly query: MailboxMessageHtmlInput;
  }) => Effect.Effect<MailboxMessageHtmlServerResult>;
  readonly getInlineAttachment: (input: {
    readonly incoming: Request;
    readonly query: MailboxInlineAttachmentInput;
  }) => Effect.Effect<MailboxInlineAttachmentServerResult>;
  readonly getThread: (input: {
    readonly incoming: Request;
    readonly query: OpenMailboxThreadInput;
  }) => Effect.Effect<MailboxThreadServerResult>;
  readonly listMessages: (input: {
    readonly incoming: Request;
    readonly query: MailboxMessageListInput;
  }) => Effect.Effect<MailboxMessageListServerResult>;
  readonly rename: (input: {
    readonly displayName: string;
    readonly incoming: Request;
    readonly mailboxId: string;
  }) => Effect.Effect<MailboxServerResult>;
  readonly updateDraft: (input: {
    readonly command: UpdateMailboxDraftCommand;
    readonly incoming: Request;
  }) => Effect.Effect<MailboxDraftServerResult>;
}

/** Website mailbox use cases backed by the private Backend binding. */
export const MailboxBackendOperations =
  Context.Service<MailboxBackendOperationsShape>(
    "cloudflare-inbox/MailboxBackendOperations"
  );

export const MailboxBackendOperationsLive = Layer.effect(
  MailboxBackendOperations,
  Effect.gen(function* () {
    const backend = yield* BackendClient;
    const forwardErrorResponse = (
      response: Response,
      operation: string
    ): Effect.Effect<MailboxServerErrorResult> =>
      Effect.gen(function* () {
        const bodyOption = yield* Effect.tryPromise(() => response.json()).pipe(
          Effect.option
        );
        if (Option.isNone(bodyOption)) {
          return invalidBackendResponse();
        }
        const decodedError = Schema.decodeUnknownExit(
          Schema.toCodecJson(MailboxPublicErrorSchema)
        )(bodyOption.value);
        if (
          Exit.isFailure(decodedError) ||
          !isPublicErrorCode(decodedError.value.code)
        ) {
          return invalidBackendResponse();
        }

        const encodedError = yield* Schema.encodeEffect(
          MailboxPublicErrorSchema
        )(decodedError.value).pipe(Effect.orDie);
        const definition = publicErrors[encodedError.code];
        const message =
          encodedError.code === "policy_denied"
            ? policyDeniedMessage(encodedError, operation)
            : operationErrorMessage(encodedError.code, operation);
        const sanitizedError = yield* Schema.decodeUnknownEffect(
          MailboxPublicErrorSchema
        )({ ...encodedError, message }).pipe(
          Effect.flatMap(Schema.encodeEffect(MailboxPublicErrorSchema)),
          Effect.orDie
        );
        return response.status === definition.status
          ? {
              error: sanitizedError,
              ok: false,
              status: definition.status,
            }
          : invalidBackendResponse();
      });
    const forwardRequest = (
      input: ForwardMailboxRequestInput
    ): Effect.Effect<ForwardMailboxResult> =>
      Effect.gen(function* () {
        const headers = new Headers();
        if (input.payload !== undefined) {
          headers.set("content-type", "application/json");
        }
        for (const name of forwardedHeaderNames) {
          const value = input.incoming.headers.get(name);
          if (value !== null) {
            headers.set(name, value);
          }
        }

        const url = new URL(input.path, input.incoming.url);
        const response = yield* backend.fetch(
          input.operation,
          new Request(url, {
            body:
              input.payload === undefined
                ? undefined
                : JSON.stringify(input.payload),
            headers,
            method: input.method,
          })
        );
        if (!response.ok) {
          return yield* forwardErrorResponse(response, input.operation);
        }
        const bodyOption = yield* Effect.tryPromise(() => response.json()).pipe(
          Effect.option
        );
        return Option.isSome(bodyOption)
          ? { body: bodyOption.value, ok: true }
          : invalidBackendResponse();
      });

    const forwardInlineAttachment = (
      query: MailboxInlineAttachmentInput,
      incoming: Request
    ): Effect.Effect<MailboxInlineAttachmentServerResult> =>
      Effect.gen(function* () {
        const headers = new Headers();
        for (const name of forwardedHeaderNames) {
          const value = incoming.headers.get(name);
          if (value !== null) {
            headers.set(name, value);
          }
        }
        const search = new URLSearchParams();
        if (query._tag === "Folder") {
          search.set("folder", query.folderId);
        } else {
          search.set("label", query.labelId);
        }
        const path = `/api/mailboxes/${encodeURIComponent(query.mailboxId)}/messages/${encodeURIComponent(query.messageId)}/attachments/${encodeURIComponent(query.attachmentId)}/inline?${search.toString()}`;
        const response = yield* backend.fetch(
          "website.mailbox.inline_attachment",
          new Request(new URL(path, incoming.url), { headers })
        );
        if (!response.ok) {
          return yield* forwardErrorResponse(
            response,
            "website.mailbox.inline_attachment"
          );
        }

        const mimeType = response.headers.get("content-type");
        const encodedLength = response.headers.get("content-length");
        const contentLength =
          encodedLength === null ? Number.NaN : Number(encodedLength);
        if (
          mimeType === null ||
          !isSafeInlineImageMimeType(mimeType) ||
          !Number.isSafeInteger(contentLength) ||
          contentLength < 0
        ) {
          return invalidBackendResponse();
        }
        const bufferOption = yield* Effect.tryPromise(() =>
          response.arrayBuffer()
        ).pipe(Effect.option);
        if (
          Option.isNone(bufferOption) ||
          bufferOption.value.byteLength !== contentLength
        ) {
          return invalidBackendResponse();
        }
        return {
          bytes: new Uint8Array(bufferOption.value),
          mimeType,
          ok: true,
        };
      });

    const decodeDraftResult = (
      result: ForwardMailboxResult,
      mailboxId: string,
      draftId?: string
    ): MailboxDraftServerResult => {
      if (!result.ok) {
        return result;
      }
      const decoded = Schema.decodeUnknownExit(
        Schema.toCodecJson(DraftEditorDraft)
      )(result.body);
      return Exit.isSuccess(decoded) &&
        decoded.value.mailboxId === mailboxId &&
        (draftId === undefined || decoded.value.id === draftId)
        ? {
            draft: Schema.encodeSync(DraftEditorDraft)(decoded.value),
            ok: true,
          }
        : invalidBackendResponse();
    };

    return MailboxBackendOperations.of({
      actOnMessage: ({ command, incoming }) => {
        const payload =
          command._tag === "SetRead"
            ? {
                _tag: command._tag,
                expectedVersion: command.expectedVersion,
                operationId: command.operationId,
                read: command.read,
              }
            : command._tag === "SetStarred"
              ? {
                  _tag: command._tag,
                  expectedVersion: command.expectedVersion,
                  operationId: command.operationId,
                  starred: command.starred,
                }
              : {
                  _tag: command._tag,
                  expectedVersion: command.expectedVersion,
                  operationId: command.operationId,
                };
        return forwardRequest({
          incoming,
          method: "PATCH",
          operation: "website.mailbox.message_action",
          path: `/api/mailboxes/${encodeURIComponent(command.mailboxId)}/messages/${encodeURIComponent(command.messageId)}`,
          payload,
        }).pipe(
          Effect.map((result): MailboxMessageActionServerResult => {
            if (!result.ok) {
              return result;
            }
            const decoded = Schema.decodeUnknownExit(
              Schema.toCodecJson(MailboxMessageActionResult)
            )(result.body);
            return Exit.isSuccess(decoded) &&
              decoded.value.id === command.messageId
              ? {
                  action: Schema.encodeSync(MailboxMessageActionResult)(
                    decoded.value
                  ),
                  ok: true,
                }
              : invalidBackendResponse();
          })
        );
      },
      bootstrapOwner: ({ displayName, incoming }) =>
        forwardRequest({
          incoming,
          method: "POST",
          operation: "website.mailbox.bootstrap",
          path: "/api/mailboxes/bootstrap-owner",
          payload: { displayName },
        }).pipe(
          Effect.map((result): MailboxServerResult => {
            if (!result.ok) {
              return result;
            }
            const decoded = Schema.decodeUnknownExit(
              Schema.toCodecJson(MailboxRecordSchema)
            )(result.body);
            return Exit.isSuccess(decoded)
              ? {
                  mailbox: Schema.encodeSync(MailboxRecordSchema)(
                    decoded.value
                  ),
                  ok: true,
                }
              : invalidBackendResponse();
          })
        ),
      createDraft: ({ command, incoming }) =>
        forwardRequest({
          incoming,
          method: "POST",
          operation: "website.mailbox.draft_create",
          path: `/api/mailboxes/${encodeURIComponent(command.mailboxId)}/drafts`,
          payload: {
            content: command.content,
            operationId: command.operationId,
          },
        }).pipe(
          Effect.map((result) => decodeDraftResult(result, command.mailboxId))
        ),
      getDraft: ({ incoming, query }) =>
        forwardRequest({
          incoming,
          method: "GET",
          operation: "website.mailbox.draft_get",
          path: `/api/mailboxes/${encodeURIComponent(query.mailboxId)}/drafts/${encodeURIComponent(query.draftId)}`,
        }).pipe(
          Effect.map((result) =>
            decodeDraftResult(result, query.mailboxId, query.draftId)
          )
        ),
      getNavigation: (incoming) =>
        forwardRequest({
          incoming,
          method: "GET",
          operation: "website.mailbox.navigation",
          path: "/api/mailboxes/current/navigation",
        }).pipe(
          Effect.map((result): MailboxNavigationServerResult => {
            if (!result.ok) {
              return result;
            }
            const decoded = Schema.decodeUnknownExit(
              Schema.toCodecJson(MailboxNavigationResult)
            )(result.body);
            return Exit.isSuccess(decoded)
              ? {
                  navigation: Schema.encodeSync(MailboxNavigationResult)(
                    decoded.value
                  ),
                  ok: true,
                }
              : invalidBackendResponse();
          })
        ),
      getInlineAttachment: ({ incoming, query }) =>
        forwardInlineAttachment(query, incoming),
      getMessageHtml: ({ incoming, query }) => {
        const search = new URLSearchParams();
        if (query._tag === "Folder") {
          search.set("folder", query.folderId);
        } else {
          search.set("label", query.labelId);
        }
        return forwardRequest({
          incoming,
          method: "GET",
          operation: "website.mailbox.message_html",
          path: `/api/mailboxes/${encodeURIComponent(query.mailboxId)}/messages/${encodeURIComponent(query.messageId)}/html?${search.toString()}`,
        }).pipe(
          Effect.map((result): MailboxMessageHtmlServerResult => {
            if (!result.ok) {
              return result;
            }
            const decoded = Schema.decodeUnknownExit(
              Schema.toCodecJson(MailboxMessageHtmlResult)
            )(result.body);
            const validIdentity =
              Exit.isSuccess(decoded) &&
              decoded.value._tag === query._tag &&
              decoded.value.mailboxId === query.mailboxId &&
              decoded.value.messageId === query.messageId &&
              (query._tag === "Folder"
                ? decoded.value._tag === "Folder" &&
                  decoded.value.folderId === query.folderId
                : decoded.value._tag === "Label" &&
                  decoded.value.labelId === query.labelId);
            return validIdentity && Exit.isSuccess(decoded)
              ? {
                  html: Schema.encodeSync(MailboxMessageHtmlResult)(
                    decoded.value
                  ),
                  ok: true,
                }
              : invalidBackendResponse();
          })
        );
      },
      getThread: ({ incoming, query }) =>
        forwardRequest({
          incoming,
          method: "GET",
          operation: "website.mailbox.thread",
          path: `/api/mailboxes/${encodeURIComponent(query.mailboxId)}/threads/${encodeURIComponent(query.threadId)}?${
            query._tag === "Folder"
              ? new URLSearchParams({
                  folder: query.folderId,
                  message: query.messageId,
                }).toString()
              : new URLSearchParams({
                  label: query.labelId,
                  message: query.messageId,
                }).toString()
          }`,
        }).pipe(
          Effect.map((result): MailboxThreadServerResult => {
            if (!result.ok) {
              return result;
            }
            const decoded = Schema.decodeUnknownExit(
              Schema.toCodecJson(MailboxThreadResult)
            )(result.body);
            return Exit.isSuccess(decoded) &&
              decoded.value.thread.id === query.threadId
              ? {
                  ok: true,
                  thread: Schema.encodeSync(MailboxThreadResult)(decoded.value),
                }
              : invalidBackendResponse();
          })
        ),
      listMessages: ({ incoming, query }) => {
        const search = new URLSearchParams();
        if (query._tag === "Folder") {
          search.set("folder", query.folderId);
        } else {
          search.set("label", query.labelId);
        }
        if (query.query !== undefined) {
          search.set("q", query.query);
        }
        if (query.read !== undefined) {
          search.set("read", String(query.read));
        }
        if (query.starred !== undefined) {
          search.set("starred", String(query.starred));
        }
        if (query.hasAttachment !== undefined) {
          search.set("attachment", String(query.hasAttachment));
        }
        if (query.cursor !== undefined) {
          search.set("cursor", query.cursor);
        }

        return forwardRequest({
          incoming,
          method: "GET",
          operation: "website.mailbox.messages",
          path: `/api/mailboxes/${encodeURIComponent(query.mailboxId)}/messages?${search.toString()}`,
        }).pipe(
          Effect.map((result): MailboxMessageListServerResult => {
            if (!result.ok) {
              return result;
            }
            const decoded = Schema.decodeUnknownExit(
              Schema.toCodecJson(MailboxMessageListResult)
            )(result.body);
            return Exit.isSuccess(decoded)
              ? {
                  messages: Schema.encodeSync(MailboxMessageListResult)(
                    decoded.value
                  ),
                  ok: true,
                }
              : invalidBackendResponse();
          })
        );
      },
      rename: ({ displayName, incoming, mailboxId }) =>
        forwardRequest({
          incoming,
          method: "PATCH",
          operation: "website.mailbox.rename",
          path: `/api/mailboxes/${encodeURIComponent(mailboxId)}`,
          payload: { displayName },
        }).pipe(
          Effect.map((result): MailboxServerResult => {
            if (!result.ok) {
              return result;
            }
            const decoded = Schema.decodeUnknownExit(
              Schema.toCodecJson(MailboxRecordSchema)
            )(result.body);
            return Exit.isSuccess(decoded)
              ? {
                  mailbox: Schema.encodeSync(MailboxRecordSchema)(
                    decoded.value
                  ),
                  ok: true,
                }
              : invalidBackendResponse();
          })
        ),
      updateDraft: ({ command, incoming }) =>
        forwardRequest({
          incoming,
          method: "PATCH",
          operation: "website.mailbox.draft_update",
          path: `/api/mailboxes/${encodeURIComponent(command.mailboxId)}/drafts/${encodeURIComponent(command.draftId)}`,
          payload: {
            content: command.content,
            expectedVersion: command.expectedVersion,
            operationId: command.operationId,
          },
        }).pipe(
          Effect.map((result) =>
            decodeDraftResult(result, command.mailboxId, command.draftId)
          )
        ),
    });
  })
);
