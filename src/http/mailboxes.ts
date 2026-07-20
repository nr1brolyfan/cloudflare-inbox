import {
  AuthInternalError,
  AuthUnauthenticatedError,
  AuthBadRequestError,
  AuthConflictError,
  AuthNotFoundError,
  AuthPolicyDeniedError,
  mapAuthGuardErrors,
} from "@effect-auth/core/HttpApi";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import type { MailAuthorizationError } from "../authorization/mail-authorization";
import type { MailboxAdministrationError } from "../mailboxes/administration";
import { MailboxAdministration } from "../mailboxes/administration";
import type {
  MailboxDomainError,
  MailboxRepositoryError,
  WorkflowStartError,
} from "../mailboxes/errors";
import { InboundReplay } from "../mailboxes/inbound";
import { InboundReplayAuthorization } from "../mailboxes/inbound-replay-authorization-live";
import type { MailboxMessageReadingError } from "../mailboxes/message-reading";
import { MailboxMessageReading } from "../mailboxes/message-reading";
import type { MailboxNavigationError } from "../mailboxes/navigation";
import { MailboxNavigation } from "../mailboxes/navigation";
import { BackendHttpApi } from "./api";
import { MailboxPublicErrorSchema } from "./mailbox-contract";

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
  | AuthPolicyDeniedError;

const mapAdministrationError = (
  error: MailboxAdministrationError
): Effect.Effect<never, MailboxPublicError> => {
  const fail = <E extends MailboxPublicError>(publicError: E) =>
    Schema.encodeEffect(MailboxPublicErrorSchema)(publicError).pipe(
      Effect.orDie,
      Effect.andThen(
        Effect.logWarning(
          `Mailbox ${error.operation} rejected: ${error.reason}`
        )
      ),
      Effect.flatMap(() => Effect.fail(publicError))
    );

  switch (error.reason) {
    case "invalid-input": {
      return fail(
        new AuthBadRequestError({
          code: "bad_request",
          message: "Invalid mailbox request",
        })
      );
    }
    case "conflict": {
      return fail(
        new AuthConflictError({
          code: "conflict",
          message: "Mailbox already exists",
        })
      );
    }
    case "not-found": {
      return fail(
        new AuthNotFoundError({
          code: "not_found",
          message: "Mailbox not found",
        })
      );
    }
    case "authorization-recheck": {
      return fail(
        new AuthPolicyDeniedError({
          code: "policy_denied",
          message: "Mailbox operation denied",
        })
      );
    }
    case "owner-not-eligible": {
      return fail(
        new AuthPolicyDeniedError({
          code: "policy_denied",
          message: "Mailbox owner account required",
        })
      );
    }
    case "session-recheck": {
      return fail(
        new AuthPolicyDeniedError({
          code: "policy_denied",
          message: "Complete account verification and sign in again",
        })
      );
    }
    case "storage": {
      return fail(internalError());
    }
    default: {
      return fail(internalError());
    }
  }
};

type MailboxHandlerError =
  | AuthInternalError
  | AuthUnauthenticatedError
  | MailAuthorizationError
  | MailboxAdministrationError
  | MailboxNavigationError
  | MailboxMessageReadingError
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

const mapHttpErrors = <A, R>(
  effect: Effect.Effect<A, MailboxHandlerError, R>
) =>
  mapAuthGuardErrors(effect).pipe(
    Effect.catchTag("MailboxAdministrationError", mapAdministrationError),
    Effect.catchTag("MailboxNavigationError", mapNavigationError),
    Effect.catchTag("MailboxMessageReadingError", mapMessageReadingError),
    Effect.catchTag("MailboxDomainError", mapInboundDomainError),
    Effect.catchTags({
      MailboxRepositoryError: () => Effect.fail(internalError()),
      WorkflowStartError: () => Effect.fail(internalError()),
    }),
    Effect.catchTag("MailResourceResolveError", () =>
      Effect.fail(internalError())
    ),
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

/** Mailbox handlers; request auth is supplied by CurrentRequestAuthMiddleware. */
export const MailboxGroupLive = HttpApiBuilder.group(
  BackendHttpApi,
  "mailboxes",
  Effect.fn("backend.http.mailbox_group")(function* (handlers) {
    const administration = yield* MailboxAdministration;
    const navigation = yield* MailboxNavigation;
    const messageReading = yield* MailboxMessageReading;
    const replayAuthorization = yield* InboundReplayAuthorization;
    const inboundReplay = yield* InboundReplay;

    return handlers
      .handle("bootstrapOwner", ({ payload }) =>
        administration
          .bootstrapOwner({ displayName: payload.displayName })
          .pipe(mapHttpErrors)
      )
      .handle("getNavigation", () => navigation.getCurrent.pipe(mapHttpErrors))
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
            mailboxId: params.mailboxId,
          })
          .pipe(mapHttpErrors)
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
      );
  })
);
