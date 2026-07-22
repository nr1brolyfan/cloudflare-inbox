import {
  AuthInternalError,
  AuthUnauthenticatedError,
  SessionHttpOperations,
  SessionHttpOperationsLive,
} from "@effect-auth/core/HttpApi";
import type { SessionHttpOperationsService } from "@effect-auth/core/HttpApi";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { RequestSessionAuthenticatorShape } from "../auth/session";
import { RequestSessionAuthenticator } from "../auth/session";

const denied = () =>
  new AuthUnauthenticatedError({
    code: "unauthenticated",
    message: "Complete account recovery before managing sessions",
  });

const authenticationError = (cause: unknown) =>
  cause instanceof AuthUnauthenticatedError
    ? cause
    : new AuthInternalError({
        code: "internal_error",
        message: "Failed to validate session",
      });

export const makeApplicationSessionHttpOperations = (
  operations: SessionHttpOperationsService,
  authenticator: RequestSessionAuthenticatorShape
) => {
  const requireUnrestricted = (headers: Readonly<Record<string, string>>) =>
    authenticator
      .authenticate(
        new Request("https://backend.invalid/auth/session", { headers })
      )
      .pipe(
        Effect.mapError(authenticationError),
        Effect.flatMap((authenticated) =>
          (authenticated.session.claims?.requirements?.length ?? 0) === 0
            ? Effect.void
            : Effect.fail(denied())
        )
      );

  return SessionHttpOperations.of({
    current: operations.current,
    logout: operations.logout,
    list: (request) =>
      requireUnrestricted(request.request.headers).pipe(
        Effect.andThen(operations.list(request))
      ),
    refresh: (request) =>
      requireUnrestricted(request.request.headers).pipe(
        Effect.andThen(operations.refresh(request))
      ),
    revoke: (request) =>
      requireUnrestricted(request.request.headers).pipe(
        Effect.andThen(operations.revoke(request))
      ),
    revokeOthers: (request) =>
      requireUnrestricted(request.request.headers).pipe(
        Effect.andThen(operations.revokeOthers(request))
      ),
  });
};

const ApplicationSessionHttpOperationsNoDepsLayer = Layer.effect(
  SessionHttpOperations,
  Effect.gen(function* () {
    const operations = yield* SessionHttpOperations;
    const authenticator = yield* RequestSessionAuthenticator;
    return makeApplicationSessionHttpOperations(operations, authenticator);
  })
);

export const ApplicationSessionHttpOperationsLayer =
  ApplicationSessionHttpOperationsNoDepsLayer.pipe(
    Layer.provide(SessionHttpOperationsLive)
  );
