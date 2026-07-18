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
import type { SessionValidateError } from "@effect-auth/core/Sessions";
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
    validateRequestSession(request).pipe(
      Effect.map((validated) =>
        Layer.mergeAll(
          Layer.succeed(
            CurrentSession,
            CurrentSession.of(validated.currentSession)
          ),
          Layer.succeed(CurrentActor, CurrentActor.of(validated.actor)),
          Layer.succeed(
            CurrentPrincipal,
            CurrentPrincipal.of(PermissionSubject.user(validated.actor.userId))
          )
        )
      )
    )
  );
