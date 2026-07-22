/* oxlint-disable max-classes-per-file -- Normal and recovery-only request middleware share one session authentication boundary. */
import { AuthSecrets } from "@effect-auth/core/AuthConfig";
import { Crypto } from "@effect-auth/core/Crypto";
import {
  AuthInternalError,
  AuthPolicyDeniedError,
  AuthUnauthenticatedError,
} from "@effect-auth/core/HttpApi";
import {
  CurrentPrincipal,
  PermissionSubject,
} from "@effect-auth/core/Permission";
import type { PermissionSubject as PermissionSubjectShape } from "@effect-auth/core/Permission";
import {
  CurrentActor,
  CurrentSession,
  SessionCookie,
  Sessions,
} from "@effect-auth/core/Sessions";
import type {
  CurrentActorShape,
  CurrentSessionShape,
  SessionValidateError,
  ValidatedSession,
} from "@effect-auth/core/Sessions";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import { HttpApiMiddleware } from "effect/unstable/httpapi";

const unauthenticated = () =>
  new AuthUnauthenticatedError({
    code: "unauthenticated",
    message: "Unauthenticated",
  });

const validationError = (error: SessionValidateError) =>
  error.cause === undefined
    ? unauthenticated()
    : new AuthInternalError({
        code: "internal_error",
        message: "Failed to validate session",
      });

export interface CurrentRequestAuthShape {
  readonly sessionSecretHash: string;
  readonly validated: ValidatedSession;
}

export const CurrentRequestAuth = Context.Service<CurrentRequestAuthShape>(
  "cloudflare-inbox/CurrentRequestAuth"
);

interface AuthenticatedRequest {
  readonly actor: CurrentActorShape;
  readonly principal: PermissionSubjectShape;
  readonly requestAuth: CurrentRequestAuthShape;
  readonly session: CurrentSessionShape;
}

export interface RequestSessionAuthenticatorShape {
  readonly authenticate: (
    request: Request
  ) => Effect.Effect<
    AuthenticatedRequest,
    AuthUnauthenticatedError | AuthInternalError
  >;
}

/** Validates and binds one request to trusted auth values. */
export const RequestSessionAuthenticator =
  Context.Service<RequestSessionAuthenticatorShape>(
    "cloudflare-inbox/RequestSessionAuthenticator"
  );

export class CurrentRequestAuthMiddleware extends HttpApiMiddleware.Service<
  CurrentRequestAuthMiddleware,
  {
    provides:
      | CurrentRequestAuthShape
      | CurrentSession
      | CurrentActor
      | CurrentPrincipal;
  }
>()("cloudflare-inbox/CurrentRequestAuthMiddleware", {
  error: [AuthUnauthenticatedError, AuthPolicyDeniedError, AuthInternalError],
}) {}

export class RecoveryRemediationRequestAuthMiddleware extends HttpApiMiddleware.Service<
  RecoveryRemediationRequestAuthMiddleware,
  {
    provides:
      | CurrentRequestAuthShape
      | CurrentSession
      | CurrentActor
      | CurrentPrincipal;
  }
>()("cloudflare-inbox/RecoveryRemediationRequestAuthMiddleware", {
  error: [AuthUnauthenticatedError, AuthPolicyDeniedError, AuthInternalError],
}) {}

/** Concrete request authenticator with stable auth dependencies captured once. */
export const RequestSessionAuthenticatorLive = Layer.effect(
  RequestSessionAuthenticator,
  Effect.gen(function* () {
    const sessionCookie = yield* SessionCookie;
    const sessions = yield* Sessions;
    const crypto = yield* Crypto;
    const secrets = yield* AuthSecrets;

    return RequestSessionAuthenticator.of({
      authenticate: (request) =>
        Effect.gen(function* () {
          const tokenOption = yield* sessionCookie
            .read(request)
            .pipe(Effect.mapError(validationError));

          if (Option.isNone(tokenOption)) {
            return yield* unauthenticated();
          }

          const validated = yield* sessions
            .validate(tokenOption.value)
            .pipe(Effect.mapError(validationError));
          const token = String(validated.issued.token);
          const separator = token.indexOf(".");

          if (separator <= 0 || separator === token.length - 1) {
            return yield* new AuthInternalError({
              code: "internal_error",
              message: "Failed to bind validated session",
            });
          }

          const sessionSecretHash = yield* crypto
            .hmacSha256({
              data: token.slice(separator + 1),
              key: secrets.session,
            })
            .pipe(
              Effect.mapError(
                () =>
                  new AuthInternalError({
                    code: "internal_error",
                    message: "Failed to bind validated session",
                  })
              )
            );

          return {
            actor: CurrentActor.of(validated.actor),
            principal: CurrentPrincipal.of(
              PermissionSubject.user(validated.actor.userId)
            ),
            requestAuth: CurrentRequestAuth.of({
              sessionSecretHash,
              validated,
            }),
            session: CurrentSession.of(validated.currentSession),
          };
        }),
    });
  })
);

/** Validates one request and provides the trusted auth services to its handlers. */
export const CurrentRequestAuthMiddlewareLive = Layer.effect(
  CurrentRequestAuthMiddleware,
  Effect.gen(function* () {
    const authenticator = yield* RequestSessionAuthenticator;

    return (httpEffect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const webRequest = yield* HttpServerRequest.toWeb(request).pipe(
          Effect.mapError(
            () =>
              new AuthInternalError({
                code: "internal_error",
                message: "Failed to read request",
              })
          )
        );
        const authenticated = yield* authenticator.authenticate(webRequest);
        if ((authenticated.session.claims?.requirements?.length ?? 0) !== 0) {
          return yield* new AuthPolicyDeniedError({
            code: "policy_denied",
            message: "Session remediation required",
          });
        }

        return yield* httpEffect.pipe(
          Effect.provideService(CurrentRequestAuth, authenticated.requestAuth),
          Effect.provideService(CurrentSession, authenticated.session),
          Effect.provideService(CurrentActor, authenticated.actor),
          Effect.provideService(CurrentPrincipal, authenticated.principal)
        );
      });
  })
);

export const RecoveryRemediationRequestAuthMiddlewareLive = Layer.effect(
  RecoveryRemediationRequestAuthMiddleware,
  Effect.gen(function* () {
    const authenticator = yield* RequestSessionAuthenticator;

    return (httpEffect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const webRequest = yield* HttpServerRequest.toWeb(request).pipe(
          Effect.mapError(
            () =>
              new AuthInternalError({
                code: "internal_error",
                message: "Failed to read request",
              })
          )
        );
        const authenticated = yield* authenticator.authenticate(webRequest);
        const { claims } = authenticated.session;
        if (
          claims?.requirements?.length !== 1 ||
          claims.requirements[0] !== "recovery_remediation" ||
          claims.recoveryRemediation?.allowed.includes("second-passkey") !==
            true
        ) {
          return yield* new AuthPolicyDeniedError({
            code: "policy_denied",
            message: "Passkey recovery remediation is not allowed",
          });
        }

        return yield* httpEffect.pipe(
          Effect.provideService(CurrentRequestAuth, authenticated.requestAuth),
          Effect.provideService(CurrentSession, authenticated.session),
          Effect.provideService(CurrentActor, authenticated.actor),
          Effect.provideService(CurrentPrincipal, authenticated.principal)
        );
      });
  })
);
