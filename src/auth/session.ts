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

export const makeCurrentRequestAuthLive = (request: Request) =>
  Layer.unwrap(
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

      return Layer.mergeAll(
        Layer.succeed(
          CurrentRequestAuth,
          CurrentRequestAuth.of({ sessionSecretHash, validated })
        ),
        Layer.succeed(
          CurrentValidatedSession,
          CurrentValidatedSession.of(validated)
        ),
        Layer.succeed(
          CurrentSession,
          CurrentSession.of(validated.currentSession)
        ),
        Layer.succeed(CurrentActor, CurrentActor.of(validated.actor)),
        Layer.succeed(
          CurrentPrincipal,
          CurrentPrincipal.of(PermissionSubject.user(validated.actor.userId))
        )
      );
    })
  );
