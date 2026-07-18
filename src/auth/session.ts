import { AuthSecrets } from "@effect-auth/core/AuthConfig";
import { Crypto } from "@effect-auth/core/Crypto";
import {
  AuthInternalError,
  AuthUnauthenticatedError,
} from "@effect-auth/core/HttpApi";
import {
  CurrentPrincipal,
  PermissionSubject,
} from "@effect-auth/core/Permission";
import {
  CurrentActor,
  CurrentSession,
  SessionCookie,
  Sessions,
} from "@effect-auth/core/Sessions";
import type {
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

export const CurrentValidatedSession = Context.Service<ValidatedSession>(
  "cloudflare-inbox/CurrentValidatedSession"
);

export interface CurrentRequestAuthShape {
  readonly sessionSecretHash: string;
  readonly validated: ValidatedSession;
}

export const CurrentRequestAuth = Context.Service<CurrentRequestAuthShape>(
  "cloudflare-inbox/CurrentRequestAuth"
);

export class CurrentRequestAuthMiddleware extends HttpApiMiddleware.Service<
  CurrentRequestAuthMiddleware,
  {
    provides:
      | CurrentRequestAuthShape
      | ValidatedSession
      | CurrentSession
      | CurrentActor
      | CurrentPrincipal;
  }
>()("cloudflare-inbox/CurrentRequestAuthMiddleware", {
  error: [AuthUnauthenticatedError, AuthInternalError],
}) {}

export const validateRequestSession = (request: Request) =>
  Effect.gen(function* () {
    const sessionCookie = yield* SessionCookie;
    const sessions = yield* Sessions;
    const token = yield* sessionCookie
      .read(request)
      .pipe(Effect.mapError(validationError));

    if (Option.isNone(token)) {
      return yield* unauthenticated();
    }

    return yield* sessions
      .validate(token.value)
      .pipe(Effect.mapError(validationError));
  });

export const currentRequestAuthContext = (request: Request) =>
  Effect.gen(function* () {
    const validated = yield* validateRequestSession(request);
    const crypto = yield* Crypto;
    const secrets = yield* AuthSecrets;
    const token = String(validated.issued.token);
    const separator = token.indexOf(".");

    if (separator <= 0 || separator === token.length - 1) {
      return yield* Effect.die(
        new Error("Validated session contains an invalid token")
      );
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

    return Context.make(
      CurrentRequestAuth,
      CurrentRequestAuth.of({ sessionSecretHash, validated })
    ).pipe(
      Context.add(
        CurrentValidatedSession,
        CurrentValidatedSession.of(validated)
      ),
      Context.add(CurrentSession, CurrentSession.of(validated.currentSession)),
      Context.add(CurrentActor, CurrentActor.of(validated.actor)),
      Context.add(
        CurrentPrincipal,
        CurrentPrincipal.of(PermissionSubject.user(validated.actor.userId))
      )
    );
  });

/** Validates one request and provides the trusted auth services to its handlers. */
export const CurrentRequestAuthMiddlewareLive = Layer.effect(
  CurrentRequestAuthMiddleware,
  Effect.gen(function* () {
    const dependencies = Context.make(AuthSecrets, yield* AuthSecrets).pipe(
      Context.add(Crypto, yield* Crypto),
      Context.add(SessionCookie, yield* SessionCookie),
      Context.add(Sessions, yield* Sessions)
    );

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
        const authContext = yield* currentRequestAuthContext(webRequest).pipe(
          Effect.provideContext(dependencies)
        );

        return yield* Effect.provideContext(httpEffect, authContext);
      });
  })
);
