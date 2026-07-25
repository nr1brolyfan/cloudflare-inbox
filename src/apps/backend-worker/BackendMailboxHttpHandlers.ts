import {
  AuthInternalError,
  AuthUnauthenticatedError,
  AuthBadRequestError,
  AuthConflictError,
  AuthNotFoundError,
  AuthPolicyDeniedError,
  AuthStepUpRequiredError,
  mapAuthGuardErrors,
} from "@effect-auth/core/HttpApi";
import { CurrentActor, CurrentSession } from "@effect-auth/core/Sessions";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import type { MailboxDraftAttachmentError } from "#/modules/mailbox/application/MailboxDraftAttachments";
import { MailboxDraftAttachments } from "#/modules/mailbox/application/MailboxDraftAttachments";
import type { MailboxDraftEditingError } from "#/modules/mailbox/application/MailboxDraftEditing";
import { MailboxDraftEditing } from "#/modules/mailbox/application/MailboxDraftEditing";
import type { MailboxDraftReadingError } from "#/modules/mailbox/application/MailboxDraftReading";
import { MailboxDraftReading } from "#/modules/mailbox/application/MailboxDraftReading";
import type { MailboxInboundAttachmentError } from "#/modules/mailbox/application/MailboxInboundAttachmentReading";
import { MailboxInboundAttachmentReading } from "#/modules/mailbox/application/MailboxInboundAttachmentReading";
import {
  MailboxInboundReplay,
  MailboxInboundReplayAuthorization,
} from "#/modules/mailbox/application/MailboxInboundReplay";
import type { MailboxInlineAttachmentError } from "#/modules/mailbox/application/MailboxInlineAttachmentReading";
import { MailboxInlineAttachmentReading } from "#/modules/mailbox/application/MailboxInlineAttachmentReading";
import type { MailboxMessageActionError } from "#/modules/mailbox/application/MailboxMessageActions";
import { MailboxMessageActions } from "#/modules/mailbox/application/MailboxMessageActions";
import type { MailboxMessageHtmlError } from "#/modules/mailbox/application/MailboxMessageHtmlReading";
import { MailboxMessageHtmlReading } from "#/modules/mailbox/application/MailboxMessageHtmlReading";
import type { MailboxMessageReadingError } from "#/modules/mailbox/application/MailboxMessageReading";
import { MailboxMessageReading } from "#/modules/mailbox/application/MailboxMessageReading";
import type { MailboxOutboundDeliveryReadingError } from "#/modules/mailbox/application/MailboxOutboundDeliveryReading";
import { MailboxOutboundDeliveryReading } from "#/modules/mailbox/application/MailboxOutboundDeliveryReading";
import type { MailboxOutboundSendingError } from "#/modules/mailbox/application/MailboxOutboundSending";
import { MailboxOutboundSending } from "#/modules/mailbox/application/MailboxOutboundSending";
import type { MailboxReplyDraftCreationError } from "#/modules/mailbox/application/MailboxReplyDraftCreation";
import { MailboxReplyDraftCreation } from "#/modules/mailbox/application/MailboxReplyDraftCreation";
import type { MailboxDomainError } from "#/modules/mailbox/domain/MailboxError";
import type {
  MailboxAuthorizationError,
  MailResourceResolveError,
} from "#/modules/mailbox/ports/MailboxAuthorization";
import {
  CurrentMailboxOperationProvenance,
  ExplicitUserAction,
} from "#/modules/mailbox/ports/MailboxOperationProvenance";
import type { MailboxRepositoryError } from "#/modules/mailbox/ports/MailboxRepositoryError";
import type { WorkflowStartError } from "#/modules/mailbox/ports/MailboxWorkflowStarter";
import type { MailboxAdministrationError } from "#/modules/organization/application/MailboxAdministration";
import {
  MailboxAdministration,
  MailboxAdministrationReceiptSchema,
} from "#/modules/organization/application/MailboxAdministration";
import type { MailboxNavigationError } from "#/modules/organization/application/MailboxNavigation";
import { MailboxNavigation } from "#/modules/organization/application/MailboxNavigation";
import type { OrganizationBootstrapError } from "#/modules/organization/application/OrganizationBootstrap";
import { OrganizationBootstrap } from "#/modules/organization/application/OrganizationBootstrap";
import { attachmentContentDisposition } from "#/shared/ContentDisposition";

import { MailboxHttpApi } from "./BackendMailboxHttpApi";

const internalError = () =>
  new AuthInternalError({
    code: "internal_error",
    message: "Mailbox operation failed",
  });

type MailboxPublicError =
  | AuthBadRequestError
  | AuthConflictError
  | AuthInternalError
  | AuthNotFoundError
  | AuthPolicyDeniedError
  | AuthStepUpRequiredError;

const mapAdministrationError = (
  error: MailboxAdministrationError | OrganizationBootstrapError
): Effect.Effect<never, MailboxPublicError> => {
  switch (error.reason) {
    case "invalid-input": {
      return Effect.fail(
        new AuthBadRequestError({
          code: "bad_request",
          message: "Invalid mailbox request",
        })
      );
    }
    case "conflict":
    case "operation-conflict": {
      return Effect.fail(
        new AuthConflictError({
          code: "conflict",
          message:
            error.reason === "operation-conflict"
              ? "Mailbox operation ID conflict"
              : error.operation === "rename"
                ? "Mailbox changed"
                : "Mailbox already exists",
        })
      );
    }
    case "not-found": {
      return Effect.fail(
        new AuthNotFoundError({
          code: "not_found",
          message: "Mailbox not found",
        })
      );
    }
    case "authorization-recheck": {
      return Effect.fail(
        new AuthPolicyDeniedError({
          code: "policy_denied",
          message: "Mailbox operation denied",
        })
      );
    }
    case "owner-not-eligible": {
      return Effect.fail(
        new AuthPolicyDeniedError({
          code: "policy_denied",
          message: "Mailbox owner account required",
        })
      );
    }
    case "step-up-required": {
      return Effect.fail(
        new AuthStepUpRequiredError({
          code: "step_up_required",
          message: "Recent authentication required",
        })
      );
    }
    case "session-recheck": {
      return Effect.fail(
        new AuthPolicyDeniedError({
          code: "policy_denied",
          message: "Complete account verification and sign in again",
        })
      );
    }
    case "storage": {
      return Effect.fail(internalError());
    }
    default: {
      return Effect.fail(internalError());
    }
  }
};

type MailboxHandlerError =
  | AuthInternalError
  | AuthUnauthenticatedError
  | MailboxAuthorizationError
  | MailboxAdministrationError
  | OrganizationBootstrapError
  | MailboxNavigationError
  | MailboxMessageReadingError
  | MailboxMessageActionError
  | MailboxMessageHtmlError
  | MailboxInboundAttachmentError
  | MailboxInlineAttachmentError
  | MailboxDraftEditingError
  | MailboxDraftReadingError
  | MailboxReplyDraftCreationError
  | MailboxDraftAttachmentError
  | MailboxOutboundDeliveryReadingError
  | MailboxOutboundSendingError
  | MailboxDomainError
  | MailboxRepositoryError
  | WorkflowStartError;

const mapInboundDomainError = (
  error: MailboxDomainError
): Effect.Effect<never, AuthNotFoundError | AuthConflictError> =>
  error.reason === "not-found"
    ? Effect.fail(
        new AuthNotFoundError({
          code: "not_found",
          message: "Inbound processing not found",
        })
      )
    : Effect.fail(
        new AuthConflictError({
          code: "conflict",
          message: "Inbound processing cannot be replayed",
        })
      );

const mapNavigationError = (
  error: MailboxNavigationError
): Effect.Effect<never, AuthInternalError | AuthNotFoundError> =>
  error.reason === "not-found"
    ? Effect.fail(
        new AuthNotFoundError({
          code: "not_found",
          message: "Mailbox not found",
        })
      )
    : Effect.fail(internalError());

const mapMessageReadingError = (
  error: MailboxMessageReadingError
): Effect.Effect<
  never,
  AuthBadRequestError | AuthInternalError | AuthNotFoundError
> => {
  if (error.reason === "invalid-input") {
    return Effect.fail(
      new AuthBadRequestError({
        code: "bad_request",
        message: "Invalid mailbox message query",
      })
    );
  }
  return error.reason === "not-found"
    ? Effect.fail(
        new AuthNotFoundError({
          code: "not_found",
          message: "Mailbox message content not found",
        })
      )
    : Effect.fail(internalError());
};

const mapMessageActionError = (
  error: MailboxMessageActionError
): Effect.Effect<
  never,
  | AuthBadRequestError
  | AuthConflictError
  | AuthInternalError
  | AuthNotFoundError
> => {
  switch (error.reason) {
    case "invalid-input": {
      return Effect.fail(
        new AuthBadRequestError({
          code: "bad_request",
          message: "Invalid mailbox message action",
        })
      );
    }
    case "not-found": {
      return Effect.fail(
        new AuthNotFoundError({
          code: "not_found",
          message: "Mailbox message not found",
        })
      );
    }
    case "conflict": {
      return Effect.fail(
        new AuthConflictError({
          code: "conflict",
          message: "Mailbox message changed",
        })
      );
    }
    case "storage": {
      return Effect.fail(internalError());
    }
    default: {
      return Effect.fail(internalError());
    }
  }
};

const mapDraftEditingError = (
  error: MailboxDraftEditingError
): Effect.Effect<
  never,
  | AuthBadRequestError
  | AuthConflictError
  | AuthInternalError
  | AuthNotFoundError
> => {
  if (error.reason === "invalid-input") {
    return Effect.fail(
      new AuthBadRequestError({
        code: "bad_request",
        message: "Invalid draft content",
      })
    );
  }
  if (error.reason === "not-found") {
    return Effect.fail(
      new AuthNotFoundError({ code: "not_found", message: "Draft not found" })
    );
  }
  return error.reason === "conflict"
    ? Effect.fail(
        new AuthConflictError({ code: "conflict", message: "Draft changed" })
      )
    : Effect.fail(internalError());
};

const mapDraftReadingError = (
  error: MailboxDraftReadingError
): Effect.Effect<never, AuthBadRequestError | AuthInternalError> =>
  error.reason === "invalid-input"
    ? Effect.fail(
        new AuthBadRequestError({
          code: "bad_request",
          message: "Invalid mailbox draft query",
        })
      )
    : Effect.fail(internalError());

const mapReplyDraftCreationError = (
  error: MailboxReplyDraftCreationError
): Effect.Effect<
  never,
  | AuthBadRequestError
  | AuthConflictError
  | AuthInternalError
  | AuthNotFoundError
> =>
  error.reason === "invalid-input"
    ? Effect.fail(
        new AuthBadRequestError({
          code: "bad_request",
          message: "Invalid reply target",
        })
      )
    : error.reason === "not-found"
      ? Effect.fail(
          new AuthNotFoundError({
            code: "not_found",
            message: "Reply target not found",
          })
        )
      : error.reason === "conflict"
        ? Effect.fail(
            new AuthConflictError({
              code: "conflict",
              message: "Reply draft operation conflict",
            })
          )
        : Effect.fail(internalError());

const mapDraftAttachmentError = (
  error: MailboxDraftAttachmentError
): Effect.Effect<
  never,
  | AuthBadRequestError
  | AuthConflictError
  | AuthInternalError
  | AuthNotFoundError
> => {
  if (error.reason === "invalid-input") {
    return Effect.fail(
      new AuthBadRequestError({
        code: "bad_request",
        message: "Invalid draft attachment",
      })
    );
  }
  if (error.reason === "not-found") {
    return Effect.fail(
      new AuthNotFoundError({
        code: "not_found",
        message: "Draft attachment not found",
      })
    );
  }
  return error.reason === "conflict" || error.reason === "expired"
    ? Effect.fail(
        new AuthConflictError({
          code: "conflict",
          message:
            error.reason === "expired"
              ? "Draft attachment reservation expired"
              : "Draft attachment changed",
        })
      )
    : Effect.fail(internalError());
};

const mapOutboundSendingError = (
  error: MailboxOutboundSendingError
): Effect.Effect<
  never,
  | AuthBadRequestError
  | AuthConflictError
  | AuthInternalError
  | AuthNotFoundError
  | AuthPolicyDeniedError
> => {
  if (error.reason === "user-action-required") {
    return Effect.fail(
      new AuthPolicyDeniedError({
        code: "policy_denied",
        message: "Explicit user action required to send mail",
      })
    );
  }
  if (error.reason === "invalid-input") {
    return Effect.fail(
      new AuthBadRequestError({
        code: "bad_request",
        message: "Invalid outbound request",
      })
    );
  }
  if (error.reason === "not-found") {
    return Effect.fail(
      new AuthNotFoundError({
        code: "not_found",
        message:
          error.operation === "send"
            ? "Draft not found"
            : "Outbound delivery not found",
      })
    );
  }
  return error.reason === "conflict"
    ? Effect.fail(
        new AuthConflictError({
          code: "conflict",
          message:
            error.operation === "send"
              ? "Draft changed"
              : "Outbound delivery changed",
        })
      )
    : Effect.fail(internalError());
};

const mapOutboundDeliveryReadingError = (
  error: MailboxOutboundDeliveryReadingError
): Effect.Effect<never, AuthInternalError | AuthNotFoundError> =>
  error.reason === "not-found"
    ? Effect.fail(
        new AuthNotFoundError({
          code: "not_found",
          message: "Outbound delivery not found",
        })
      )
    : Effect.fail(internalError());

const mapMessageHtmlError = (
  error: MailboxMessageHtmlError
): Effect.Effect<never, AuthInternalError | AuthNotFoundError> =>
  error.reason === "not-found"
    ? Effect.fail(
        new AuthNotFoundError({
          code: "not_found",
          message: "Mailbox message HTML not found",
        })
      )
    : Effect.fail(internalError());

const mapInlineAttachmentError = (
  error: MailboxInlineAttachmentError
): Effect.Effect<never, AuthInternalError | AuthNotFoundError> =>
  error.reason === "not-found"
    ? Effect.fail(
        new AuthNotFoundError({
          code: "not_found",
          message: "Inline message attachment not found",
        })
      )
    : Effect.fail(internalError());

const mapInboundAttachmentError = (
  error: MailboxInboundAttachmentError
): Effect.Effect<never, AuthInternalError | AuthNotFoundError> =>
  error.reason === "not-found"
    ? Effect.fail(
        new AuthNotFoundError({
          code: "not_found",
          message: "Inbound message attachment not found",
        })
      )
    : Effect.fail(internalError());

const mapResourceResolveError = (
  error: MailResourceResolveError
): Effect.Effect<never, AuthInternalError | AuthNotFoundError> =>
  error.reason === "not-found"
    ? Effect.fail(
        new AuthNotFoundError({
          code: "not_found",
          message: "Mailbox resource not found",
        })
      )
    : Effect.fail(internalError());

const mapHttpErrors = <A, R>(
  effect: Effect.Effect<A, MailboxHandlerError, R>
) =>
  mapAuthGuardErrors(effect).pipe(
    Effect.catchTag("MailboxAdministrationError", mapAdministrationError),
    Effect.catchTag("OrganizationBootstrapError", mapAdministrationError),
    Effect.catchTag("MailboxNavigationError", mapNavigationError),
    Effect.catchTag("MailboxMessageReadingError", mapMessageReadingError),
    Effect.catchTag("MailboxMessageActionError", mapMessageActionError),
    Effect.catchTag("MailboxMessageHtmlError", mapMessageHtmlError),
    Effect.catchTag("MailboxInboundAttachmentError", mapInboundAttachmentError),
    Effect.catchTag("MailboxInlineAttachmentError", mapInlineAttachmentError),
    Effect.catchTag("MailboxDraftEditingError", mapDraftEditingError),
    Effect.catchTag("MailboxDraftReadingError", mapDraftReadingError),
    Effect.catchTag(
      "MailboxReplyDraftCreationError",
      mapReplyDraftCreationError
    ),
    Effect.catchTag("MailboxDraftAttachmentError", mapDraftAttachmentError),
    Effect.catchTag(
      "MailboxOutboundDeliveryReadingError",
      mapOutboundDeliveryReadingError
    ),
    Effect.catchTag("MailboxOutboundSendingError", mapOutboundSendingError),
    Effect.catchTag("MailboxDomainError", mapInboundDomainError),
    Effect.catchTags({
      MailboxRepositoryError: () => Effect.fail(internalError()),
      WorkflowStartError: () => Effect.fail(internalError()),
    }),
    Effect.catchTag("MailResourceResolveError", mapResourceResolveError),
    Effect.catchTag("AuthUnauthenticatedError", () =>
      Effect.fail(
        new AuthUnauthenticatedError({
          code: "unauthenticated",
          message: "Unauthenticated",
        })
      )
    ),
    Effect.catchTag("AuthInternalError", () => Effect.fail(internalError()))
  );

/** Mailbox handlers; request auth is supplied by session authentication middleware. */
export const MailboxHttpHandlersLayer = HttpApiBuilder.group(
  MailboxHttpApi,
  "mailboxes",
  Effect.fn("backend.http.mailbox_group")(function* (handlers) {
    const administration = yield* MailboxAdministration;
    const organizationBootstrap = yield* OrganizationBootstrap;
    const navigation = yield* MailboxNavigation;
    const messageReading = yield* MailboxMessageReading;
    const messageActions = yield* MailboxMessageActions;
    const messageHtml = yield* MailboxMessageHtmlReading;
    const inboundAttachments = yield* MailboxInboundAttachmentReading;
    const inlineAttachments = yield* MailboxInlineAttachmentReading;
    const draftEditing = yield* MailboxDraftEditing;
    const draftReading = yield* MailboxDraftReading;
    const replyDraftCreation = yield* MailboxReplyDraftCreation;
    const draftAttachments = yield* MailboxDraftAttachments;
    const outboundDeliveryReading = yield* MailboxOutboundDeliveryReading;
    const outboundSending = yield* MailboxOutboundSending;
    const replayAuthorization = yield* MailboxInboundReplayAuthorization;
    const inboundReplay = yield* MailboxInboundReplay;

    return handlers
      .handle("actOnMessage", ({ params, payload }) =>
        messageActions
          .execute({
            ...payload,
            mailboxId: params.mailboxId,
            messageId: params.messageId,
          })
          .pipe(mapHttpErrors)
      )
      .handle("bootstrapOwner", ({ payload }) =>
        organizationBootstrap.bootstrap(payload).pipe(mapHttpErrors)
      )
      .handle("createDraft", ({ params, payload }) =>
        draftEditing
          .create({ ...payload, mailboxId: params.mailboxId })
          .pipe(mapHttpErrors)
      )
      .handle("createReplyDraft", ({ params, payload }) =>
        replyDraftCreation.create({ ...params, ...payload }).pipe(mapHttpErrors)
      )
      .handle("getDraft", ({ params }) =>
        draftEditing.get(params).pipe(mapHttpErrors)
      )
      .handle("listDrafts", ({ params, query }) =>
        draftReading
          .list({
            mailboxId: params.mailboxId,
            page: { cursor: query.cursor, limit: query.limit },
          })
          .pipe(mapHttpErrors)
      )
      .handle("readOperation", ({ params }) =>
        administration.readOperation(params).pipe(
          mapHttpErrors,
          Effect.flatMap((receipt) =>
            Schema.encodeEffect(MailboxAdministrationReceiptSchema)(
              receipt
            ).pipe(
              Effect.flatMap((encoded) =>
                HttpServerResponse.json(encoded, {
                  headers: {
                    "cache-control": "private, no-store",
                    pragma: "no-cache",
                  },
                })
              ),
              Effect.orDie
            )
          )
        )
      )
      .handle("getOutboundDelivery", ({ params }) =>
        outboundDeliveryReading.get(params).pipe(mapHttpErrors)
      )
      .handle("getNavigation", () => navigation.getCurrent.pipe(mapHttpErrors))
      .handle("getInlineAttachment", ({ params, query }) =>
        Effect.gen(function* () {
          const view =
            query.folder === undefined
              ? query.label === undefined
                ? yield* Effect.die(
                    new Error("Inline attachment view query invariant failed")
                  )
                : {
                    _tag: "Label" as const,
                    attachmentId: params.attachmentId,
                    labelId: query.label,
                    mailboxId: params.mailboxId,
                    messageId: params.messageId,
                  }
              : {
                  _tag: "Folder" as const,
                  attachmentId: params.attachmentId,
                  folderId: query.folder,
                  mailboxId: params.mailboxId,
                  messageId: params.messageId,
                };
          const content = yield* inlineAttachments.get(view);
          return HttpServerResponse.uint8Array(content.bytes, {
            contentType: content.mimeType,
            headers: {
              "cache-control": "private, no-store",
              "content-disposition": "inline",
              "content-length": String(content.bytes.byteLength),
              "referrer-policy": "no-referrer",
              "x-content-type-options": "nosniff",
            },
          });
        }).pipe(mapHttpErrors)
      )
      .handle("getInboundAttachment", ({ params, query }) =>
        Effect.gen(function* () {
          const view =
            query.folder === undefined
              ? query.label === undefined
                ? yield* Effect.die(
                    new Error("Inbound attachment view query invariant failed")
                  )
                : {
                    _tag: "Label" as const,
                    attachmentId: params.attachmentId,
                    labelId: query.label,
                    mailboxId: params.mailboxId,
                    messageId: params.messageId,
                  }
              : {
                  _tag: "Folder" as const,
                  attachmentId: params.attachmentId,
                  folderId: query.folder,
                  mailboxId: params.mailboxId,
                  messageId: params.messageId,
                };
          const content = yield* inboundAttachments.get(view);
          return HttpServerResponse.uint8Array(content.bytes, {
            contentType: content.mimeType,
            headers: {
              "cache-control": "private, no-store",
              "content-disposition": attachmentContentDisposition(
                content.fileName
              ),
              "content-length": String(content.bytes.byteLength),
              "x-content-type-options": "nosniff",
            },
          });
        }).pipe(mapHttpErrors)
      )
      .handle("getMessageHtml", ({ params, query }) =>
        Effect.gen(function* () {
          const view =
            query.folder === undefined
              ? query.label === undefined
                ? yield* Effect.die(
                    new Error("Message HTML view query invariant failed")
                  )
                : {
                    _tag: "Label" as const,
                    labelId: query.label,
                    mailboxId: params.mailboxId,
                    messageId: params.messageId,
                  }
              : {
                  _tag: "Folder" as const,
                  folderId: query.folder,
                  mailboxId: params.mailboxId,
                  messageId: params.messageId,
                };
          return yield* messageHtml.get(view);
        }).pipe(mapHttpErrors)
      )
      .handle("listMessages", ({ params, query }) =>
        Effect.gen(function* () {
          const filters = {
            cursor: query.cursor,
            hasAttachment:
              query.attachment === undefined
                ? undefined
                : query.attachment === "true",
            query: query.q,
            read: query.read === undefined ? undefined : query.read === "true",
            starred:
              query.starred === undefined
                ? undefined
                : query.starred === "true",
          };
          const view =
            query.folder === undefined
              ? query.label === undefined
                ? yield* Effect.die(
                    new Error("Message view query invariant failed")
                  )
                : {
                    _tag: "Label" as const,
                    ...filters,
                    labelId: query.label,
                    mailboxId: params.mailboxId,
                  }
              : {
                  _tag: "Folder" as const,
                  ...filters,
                  folderId: query.folder,
                  mailboxId: params.mailboxId,
                };
          return yield* messageReading.listView(view);
        }).pipe(mapHttpErrors)
      )
      .handle("getThread", ({ params, query }) =>
        Effect.gen(function* () {
          const view =
            query.folder === undefined
              ? query.label === undefined
                ? yield* Effect.die(
                    new Error("Thread view query invariant failed")
                  )
                : {
                    _tag: "Label" as const,
                    labelId: query.label,
                    mailboxId: params.mailboxId,
                    messageId: query.message,
                    threadId: params.threadId,
                  }
              : {
                  _tag: "Folder" as const,
                  folderId: query.folder,
                  mailboxId: params.mailboxId,
                  messageId: query.message,
                  threadId: params.threadId,
                };
          return yield* messageReading.openThread(view);
        }).pipe(mapHttpErrors)
      )
      .handle("rename", ({ params, payload }) =>
        administration
          .rename({
            displayName: payload.displayName,
            expectedVersion: payload.expectedVersion,
            mailboxId: params.mailboxId,
            operationId: payload.operationId,
          })
          .pipe(mapHttpErrors)
      )
      .handle("reserveDraftAttachment", ({ params, payload }) =>
        draftAttachments.reserve({ ...params, ...payload }).pipe(mapHttpErrors)
      )
      .handle("replayInbound", ({ params, payload }) =>
        Effect.gen(function* () {
          yield* replayAuthorization.require(params.mailboxId);
          return yield* inboundReplay.replay({
            inboundIngestId: params.inboundIngestId,
            mailboxId: params.mailboxId,
            operationId: payload.operationId,
          });
        }).pipe(mapHttpErrors)
      )
      .handle("updateDraft", ({ params, payload }) =>
        draftEditing.update({ ...params, ...payload }).pipe(mapHttpErrors)
      )
      .handle("sendDraft", ({ params, payload }) =>
        Effect.gen(function* () {
          const actor = yield* CurrentActor;
          const session = yield* CurrentSession;
          const command = { ...params, ...payload };
          const provenance = new ExplicitUserAction({
            action: "send-draft",
            actor: {
              sessionId: actor.sessionId,
              userId: actor.userId,
            },
            expectedVersion: command.expectedVersion,
            mailboxId: command.mailboxId,
            operationId: command.operationId,
            resource: { _tag: "Draft", draftId: command.draftId },
            session: {
              sessionId: session.sessionId,
              userId: session.userId,
            },
          });
          return yield* outboundSending
            .send(command)
            .pipe(
              Effect.provideService(
                CurrentMailboxOperationProvenance,
                provenance
              )
            );
        }).pipe(mapHttpErrors)
      )
      .handle("undoSend", ({ params, payload }) =>
        outboundSending.undo({ ...params, ...payload }).pipe(mapHttpErrors)
      )
      .handle("uploadDraftAttachment", ({ params, payload }) =>
        draftAttachments
          .upload({ ...params, content: payload })
          .pipe(mapHttpErrors)
      );
  })
);
