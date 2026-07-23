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
import * as Schema from "effect/Schema";
import * as HttpBody from "effect/unstable/http/HttpBody";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";

import { AccountRecovery } from "#/modules/account-security/application/AccountRecovery";
import { AccountRecoveryCompletionReceipt } from "#/modules/account-security/domain/AccountRecovery";
import type { AccountRecoveryError } from "#/modules/account-security/domain/AccountRecovery";

import { AccountRecoveryHttpApi } from "./AccountRecoveryHttpApi";

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

const receiptResponse = (receipt: AccountRecoveryCompletionReceipt) =>
  Effect.gen(function* () {
    const encoded = yield* Schema.encodeEffect(
      AccountRecoveryCompletionReceipt
    )(receipt).pipe(Effect.orDie);
    return yield* HttpServerResponse.json(encoded, {
      headers: {
        "cache-control": "private, no-store",
        pragma: "no-cache",
      },
    }).pipe(Effect.orDie);
  });

const privateNoStoreHeaders = {
  "cache-control": "private, no-store",
  pragma: "no-cache",
} as const;

const startResponse = (accepted: { readonly accepted: true }) =>
  HttpServerResponse.json(accepted, {
    headers: privateNoStoreHeaders,
  }).pipe(Effect.orDie);

const startRateLimitResponse = (error: AuthRateLimitedError) =>
  Effect.gen(function* () {
    const encoded = yield* Schema.encodeEffect(AuthRateLimitedError)(
      error
    ).pipe(Effect.orDie);
    return yield* HttpServerResponse.json(encoded, {
      headers: {
        ...privateNoStoreHeaders,
        "retry-after": String(error.retryAfterSeconds),
      },
      status: 429,
    }).pipe(Effect.orDie);
  });

export const AccountRecoveryHttpHandlersLayer = HttpApiBuilder.group(
  AccountRecoveryHttpApi,
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

    const requirePublicIpLimit = (
      id: "app.account_recovery.complete.ip" | "app.account_recovery.read.ip"
    ) =>
      Effect.gen(function* () {
        const metadata = yield* AuthRequestMetadata;
        yield* authRateLimit
          .require({
            operation: "auth.recovery_code.verify",
            policy: AuthRateLimit.rules([
              {
                id,
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
          const limit = yield* requireStartLimit(payload.address).pipe(
            Effect.as({ _tag: "Allowed" as const }),
            Effect.catchTag("AuthRateLimitedError", (error) =>
              Effect.succeed({ _tag: "RateLimited" as const, error })
            )
          );
          if (limit._tag === "RateLimited") {
            return yield* startRateLimitResponse(limit.error);
          }
          const accepted = yield* recovery
            .start(payload)
            .pipe(Effect.catchTag("AccountRecoveryError", mapError));
          return yield* startResponse(accepted);
        })
      )
      .handle("complete", ({ payload }) =>
        Effect.gen(function* () {
          yield* requirePublicIpLimit("app.account_recovery.complete.ip");
          const result = yield* recovery
            .complete(payload)
            .pipe(Effect.catchTag("AccountRecoveryError", mapError));
          if (result._tag === "AccountRecoveryAlreadyCompleted") {
            return yield* receiptResponse(result.receipt);
          }
          const encoded = yield* Schema.encodeEffect(
            AccountRecoveryCompletionReceipt
          )(result.receipt).pipe(Effect.orDie);
          const response = yield* authHttp
            .commitAuthenticatedSession(result.session)
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
            HttpServerResponse.setBody(HttpBody.jsonUnsafe(encoded)),
            HttpServerResponse.setHeaders({
              "cache-control": "private, no-store",
              pragma: "no-cache",
            })
          );
        })
      )
      .handle("readCompletion", ({ payload }) =>
        Effect.gen(function* () {
          yield* requirePublicIpLimit("app.account_recovery.read.ip");
          const receipt = yield* recovery
            .readCompletion(payload)
            .pipe(Effect.catchTag("AccountRecoveryError", mapError));
          return yield* receiptResponse(receipt);
        })
      );
  })
);
