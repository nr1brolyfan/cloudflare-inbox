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
  | MailboxAdministrationError;

const mapHttpErrors = <A, R>(
  effect: Effect.Effect<A, MailboxHandlerError, R>
) =>
  mapAuthGuardErrors(effect).pipe(
    Effect.catchTag("MailboxAdministrationError", mapAdministrationError),
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

    return handlers
      .handle("bootstrapOwner", ({ payload }) =>
        administration
          .bootstrapOwner({ displayName: payload.displayName })
          .pipe(mapHttpErrors)
      )
      .handle("rename", ({ params, payload }) =>
        administration
          .rename({
            displayName: payload.displayName,
            mailboxId: params.mailboxId,
          })
          .pipe(mapHttpErrors)
      );
  })
);
