import { AuthSecrets } from "@effect-auth/core/AuthConfig";
import { Crypto } from "@effect-auth/core/Crypto";
import {
  AuthBadRequestError,
  AuthConflictError,
  AuthInternalError,
  AuthNotFoundError,
  AuthOriginCheckMiddleware,
  AuthOriginCheckMiddlewareLive,
  AuthPolicyDeniedError,
  AuthSchemaErrorMiddleware,
  AuthSchemaErrorMiddlewareLive,
  AuthUnauthenticatedError,
  mapAuthGuardErrors,
} from "@effect-auth/core/HttpApi";
import { SessionCookie, Sessions } from "@effect-auth/core/Sessions";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
} from "effect/unstable/httpapi";

import { makeCurrentRequestAuthLive } from "../auth/session";
import { MailAuthorization } from "../authorization/mail-authorization";
import type { MailAuthorizationError } from "../authorization/mail-authorization";
import type { MailboxAdministrationError } from "../mailboxes/administration";
import { MailboxAdministration } from "../mailboxes/administration";

export const MailboxRecordSchema = Schema.Struct({
  createdAt: Schema.Number,
  createdByUserId: Schema.String,
  displayName: Schema.String,
  id: Schema.String,
  status: Schema.Literal("active"),
  updatedAt: Schema.Number,
  version: Schema.Number,
});

export type MailboxRecord = Schema.Schema.Type<typeof MailboxRecordSchema>;

const MailboxDisplayNamePayload = Schema.Struct({
  displayName: Schema.String,
});
const MailboxParams = Schema.Struct({ mailboxId: Schema.String });
const MailboxErrors = [
  AuthBadRequestError,
  AuthUnauthenticatedError,
  AuthPolicyDeniedError,
  AuthNotFoundError,
  AuthConflictError,
  AuthInternalError,
] as const;

export const BootstrapOwnerEndpoint = HttpApiEndpoint.post(
  "bootstrapOwner",
  "/api/mailboxes/bootstrap-owner",
  {
    error: MailboxErrors,
    payload: MailboxDisplayNamePayload,
    success: MailboxRecordSchema.pipe(HttpApiSchema.status(201)),
  }
);

export const RenameMailboxEndpoint = HttpApiEndpoint.patch(
  "rename",
  "/api/mailboxes/:mailboxId",
  {
    error: MailboxErrors,
    params: MailboxParams,
    payload: MailboxDisplayNamePayload,
    success: MailboxRecordSchema,
  }
);

export class MailboxGroup extends HttpApiGroup.make("mailboxes")
  .add(BootstrapOwnerEndpoint, RenameMailboxEndpoint)
  .middleware(AuthSchemaErrorMiddleware)
  .middleware(AuthOriginCheckMiddleware) {}

export const MailboxHttpApi = HttpApi.make("MailboxHttpApi").add(MailboxGroup);

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
  const fail = <E>(publicError: E) =>
    Effect.logWarning(
      `Mailbox ${error.operation} rejected: ${error.reason}`
    ).pipe(Effect.flatMap(() => Effect.fail(publicError)));

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

export const MailboxGroupLive = HttpApiBuilder.group(
  MailboxHttpApi,
  "mailboxes",
  Effect.fn("backend.http.mailbox_group")(function* (handlers) {
    const administration = yield* MailboxAdministration;
    const authSecrets = yield* AuthSecrets;
    const crypto = yield* Crypto;
    const mailAuthorization = yield* MailAuthorization;
    const sessionCookie = yield* SessionCookie;
    const sessions = yield* Sessions;
    const requestAuthDependenciesLive = Layer.mergeAll(
      Layer.succeed(AuthSecrets, authSecrets),
      Layer.succeed(Crypto, crypto),
      Layer.succeed(SessionCookie, sessionCookie),
      Layer.succeed(Sessions, sessions)
    );
    const withCurrentRequestAuth = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const webRequest = yield* HttpServerRequest.toWeb(request).pipe(
          Effect.mapError(() => internalError())
        );
        return yield* effect.pipe(
          Effect.provide(
            makeCurrentRequestAuthLive(webRequest).pipe(
              Layer.provide(requestAuthDependenciesLive)
            )
          )
        );
      });

    return handlers
      .handle("bootstrapOwner", ({ payload }) =>
        withCurrentRequestAuth(
          Effect.suspend(() =>
            administration.bootstrapOwner({ displayName: payload.displayName })
          )
        ).pipe(mapHttpErrors)
      )
      .handle("rename", ({ params, payload }) =>
        withCurrentRequestAuth(
          Effect.suspend(() =>
            administration.rename({
              displayName: payload.displayName,
              mailboxId: params.mailboxId,
            })
          ).pipe(Effect.provideService(MailAuthorization, mailAuthorization))
        ).pipe(mapHttpErrors)
      );
  })
);

export const makeMailboxHttpMiddlewareLive = (publicOrigin: string) =>
  Layer.merge(
    AuthSchemaErrorMiddlewareLive,
    AuthOriginCheckMiddlewareLive({
      allowMissingOrigin: false,
      allowedOrigins: [publicOrigin],
    })
  );

export const MailboxHttpLive = HttpApiBuilder.layer(MailboxHttpApi);
