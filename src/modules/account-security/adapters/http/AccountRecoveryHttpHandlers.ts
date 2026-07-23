import { AuthRateLimit } from "@effect-auth/core/AuthRateLimit";
import {
  AuthBadRequestError,
  AuthHttp,
  AuthInternalError,
  AuthRateLimitedError,
  AuthRequestMetadata,
} from "@effect-auth/core/HttpApi";
import { Email } from "@effect-auth/core/Identifiers";
import { RateLimitExceededError } from "@effect-auth/core/RateLimiter";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";

import { BackendHttpApi } from "#/http/api";
import { AccountRecovery } from "#/modules/account-security/application/AccountRecovery";
import type { AccountRecoveryError } from "#/modules/account-security/domain/AccountRecovery";

type PublicError =
  | AuthBadRequestError
  | AuthInternalError
  | AuthRateLimitedError;

const internalError = () =>
  new AuthInternalError({
    code: "internal_error",
    message: "Account recovery failed",
  });

const mapError = (
  error: AccountRecoveryError
): Effect.Effect<never, PublicError> => {
  switch (error.reason) {
    case "invalid-input":
    case "invalid-proof": {
      return Effect.fail(
        new AuthBadRequestError({
          code: "bad_request",
          message: "Invalid account recovery request",
        })
      );
    }
    case "rate-limited": {
      return Effect.fail(
        new AuthRateLimitedError({
          code: "rate_limited",
          message: "Too many account recovery attempts",
          retryAfter:
            error.cause instanceof RateLimitExceededError
              ? error.cause.retryAfter
              : Duration.seconds(60),
        })
      );
    }
    case "indeterminate": {
      return Effect.fail(
        new AuthInternalError({
          code: "internal_error",
          message:
            "Account recovery may have completed. Restart recovery with another unused code before retrying.",
        })
      );
    }
    default: {
      return Effect.fail(internalError());
    }
  }
};

export const AccountRecoveryHttpHandlersLayer = HttpApiBuilder.group(
  BackendHttpApi,
  "accountRecovery",
  Effect.fn("auth.http.account_recovery")(function* (handlers) {
    const authHttp = yield* AuthHttp;
    const authRateLimit = yield* AuthRateLimit;
    const recovery = yield* AccountRecovery;

    const requireStartLimit = (address: string) =>
      Effect.gen(function* () {
        const metadata = yield* AuthRequestMetadata;
        yield* authRateLimit
          .require({
            email: Email(address),
            operation: "auth.password.reset_start",
            policy: AuthRateLimit.rules([
              {
                id: "app.account_recovery.start.ip",
                key: "ip",
                limit: 10,
                window: Duration.minutes(10),
              },
              {
                id: "app.account_recovery.start.email",
                key: "email",
                limit: 5,
                window: Duration.minutes(10),
              },
            ]),
            ...(metadata.ipAddress === undefined
              ? {}
              : { ipAddress: metadata.ipAddress }),
          })
          .pipe(
            Effect.mapError((cause) =>
              cause instanceof RateLimitExceededError
                ? new AuthRateLimitedError({
                    code: "rate_limited",
                    message: "Too many account recovery attempts",
                    retryAfter: cause.retryAfter,
                  })
                : internalError()
            )
          );
      });

    const requireCompleteIpLimit = Effect.gen(function* () {
      const metadata = yield* AuthRequestMetadata;
      yield* authRateLimit
        .require({
          operation: "auth.recovery_code.verify",
          policy: AuthRateLimit.rules([
            {
              id: "app.account_recovery.complete.ip",
              key: "ip",
              limit: 20,
              window: Duration.minutes(10),
            },
          ]),
          ...(metadata.ipAddress === undefined
            ? {}
            : { ipAddress: metadata.ipAddress }),
        })
        .pipe(
          Effect.mapError((cause) =>
            cause instanceof RateLimitExceededError
              ? new AuthRateLimitedError({
                  code: "rate_limited",
                  message: "Too many account recovery attempts",
                  retryAfter: cause.retryAfter,
                })
              : internalError()
          )
        );
    });

    return handlers
      .handle("start", ({ payload }) =>
        Effect.gen(function* () {
          yield* requireStartLimit(payload.address);
          return yield* recovery
            .start(payload)
            .pipe(Effect.catchTag("AccountRecoveryError", mapError));
        })
      )
      .handle("complete", ({ payload }) =>
        Effect.gen(function* () {
          yield* requireCompleteIpLimit;
          const session = yield* recovery
            .complete(payload)
            .pipe(Effect.catchTag("AccountRecoveryError", mapError));
          const response = yield* authHttp
            .commitAuthenticatedSession(session)
            .pipe(
              Effect.mapError(
                () =>
                  new AuthInternalError({
                    code: "internal_error",
                    message:
                      "Account recovery may have completed. Restart recovery with another unused code before retrying.",
                  })
              )
            );
          return response.pipe(
            HttpServerResponse.setHeaders({
              "cache-control": "private, no-store",
              pragma: "no-cache",
            })
          );
        })
      );
  })
);
