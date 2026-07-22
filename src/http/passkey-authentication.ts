import { AuthRateLimit } from "@effect-auth/core/AuthRateLimit";
import {
  AuthBadRequestError,
  AuthHttp,
  AuthInternalError,
  AuthPolicyDeniedError,
  AuthRateLimitedError,
  AuthRequestMetadata,
} from "@effect-auth/core/HttpApi";
import { RateLimitExceededError } from "@effect-auth/core/RateLimiter";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";

import { PasskeyAuthentication } from "../auth/passkey-authentication";
import type { PasskeyAuthenticationError } from "../auth/passkey-authentication";
import { BackendHttpApi } from "./api";

type PublicError =
  | AuthBadRequestError
  | AuthInternalError
  | AuthPolicyDeniedError
  | AuthRateLimitedError;

const internalError = () =>
  new AuthInternalError({
    code: "internal_error",
    message: "Passkey authentication failed",
  });

const mapError = (
  error: PasskeyAuthenticationError
): Effect.Effect<never, PublicError> => {
  switch (error.reason) {
    case "invalid-input": {
      return Effect.fail(
        new AuthBadRequestError({
          code: "bad_request",
          message: "Invalid passkey authentication request",
        })
      );
    }
    case "invalid-credential": {
      return Effect.fail(
        new AuthBadRequestError({
          code: "bad_request",
          message: "Invalid passkey authentication request",
        })
      );
    }
    case "policy-denied":
    case "restricted-session": {
      return Effect.fail(
        new AuthPolicyDeniedError({
          code: "policy_denied",
          message: "Passkey authentication denied",
        })
      );
    }
    default: {
      return Effect.fail(internalError());
    }
  }
};

const mapRateLimitError = (error: unknown) =>
  error instanceof RateLimitExceededError
    ? new AuthRateLimitedError({
        code: "rate_limited",
        message: "Too many passkey authentication attempts",
        retryAfter: error.retryAfter,
      })
    : error && typeof error === "object" && "retryAfter" in error
      ? new AuthRateLimitedError({
          code: "rate_limited",
          message: "Too many passkey authentication attempts",
          retryAfter: Duration.seconds(60),
        })
      : internalError();

export const PasskeyAuthenticationApiLayer = HttpApiBuilder.group(
  BackendHttpApi,
  "passkeyAuthentication",
  Effect.fn("auth.http.passkey_authentication")(function* (handlers) {
    const authHttp = yield* AuthHttp;
    const authRateLimit = yield* AuthRateLimit;
    const authentication = yield* PasskeyAuthentication;

    const requireRateLimit = (
      operation:
        | "auth.passkey.authentication_finish"
        | "auth.passkey.authentication_start"
    ) =>
      Effect.gen(function* () {
        const metadata = yield* AuthRequestMetadata;
        yield* authRateLimit
          .require({
            operation,
            ...(metadata.ipAddress === undefined
              ? {}
              : { ipAddress: metadata.ipAddress }),
          })
          .pipe(Effect.mapError(mapRateLimitError));
      });

    return handlers
      .handle("authenticateStart", () =>
        Effect.gen(function* () {
          yield* requireRateLimit("auth.passkey.authentication_start");
          return yield* authentication
            .startSignIn({})
            .pipe(Effect.catchTag("PasskeyAuthenticationError", mapError));
        })
      )
      .handle("authenticateFinish", ({ payload }) =>
        Effect.gen(function* () {
          yield* requireRateLimit("auth.passkey.authentication_finish");
          const metadata = yield* AuthRequestMetadata;
          const session = yield* authentication
            .finishSignIn(
              {
                challengeId: payload.challengeId,
                credential: payload.credential,
              },
              {
                ...(metadata.ipAddress === undefined
                  ? {}
                  : { ip: metadata.ipAddress }),
                ...(metadata.userAgent === undefined
                  ? {}
                  : { userAgent: metadata.userAgent }),
              }
            )
            .pipe(Effect.catchTag("PasskeyAuthenticationError", mapError));
          return yield* authHttp.commitAuthenticatedSession(session);
        })
      );
  })
);
