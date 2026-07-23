import { AuthRateLimit } from "@effect-auth/core/AuthRateLimit";
import {
  AuthRequestMetadata,
  AuthBadRequestError,
  AuthConflictError,
  AuthInternalError,
  AuthPolicyDeniedError,
  AuthRateLimitedError,
  AuthStepUpRequiredError,
} from "@effect-auth/core/HttpApi";
import { RateLimitExceededError } from "@effect-auth/core/RateLimiter";
import { SessionCookie } from "@effect-auth/core/Sessions";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import {
  PasskeyEnrollment,
  PasskeyEnrollmentAlreadyCompleted,
  PasskeyEnrollmentReceiptSchema,
} from "#/modules/account-security/application/PasskeyEnrollment";
import type {
  PasskeyEnrollmentError,
  PasskeyEnrollmentReceipt,
} from "#/modules/account-security/application/PasskeyEnrollment";

import { PasskeyEnrollmentHttpApi } from "./PasskeyEnrollmentHttpApi";
import {
  RecoveryPasskeyEnrollmentHttpApi,
  RecoveryPasskeyEnrollmentReadbackHttpApi,
} from "./RecoveryPasskeyEnrollmentHttpApi";

type PasskeyEnrollmentPublicError =
  | AuthBadRequestError
  | AuthConflictError
  | AuthInternalError
  | AuthPolicyDeniedError
  | AuthRateLimitedError
  | AuthStepUpRequiredError;

const mapError = (
  failure: PasskeyEnrollmentError
): Effect.Effect<never, PasskeyEnrollmentPublicError> => {
  switch (failure.reason) {
    case "invalid-input":
    case "invalid-proof": {
      return Effect.fail(
        new AuthBadRequestError({
          code: "bad_request",
          message: "Invalid passkey enrollment request",
        })
      );
    }
    case "challenge-invalid":
    case "verification-failed": {
      return Effect.fail(
        new AuthBadRequestError({
          code: "bad_request",
          message: "Passkey registration is invalid",
        })
      );
    }
    case "credential-conflict": {
      return Effect.fail(
        new AuthConflictError({
          code: "conflict",
          message: "Passkey credential already exists",
        })
      );
    }
    case "operation-conflict": {
      return Effect.fail(
        new AuthConflictError({
          code: "conflict",
          message: "Passkey enrollment operation conflicts with prior intent",
        })
      );
    }
    case "step-up-required": {
      return Effect.fail(
        new AuthStepUpRequiredError({
          code: "step_up_required",
          message: "Recent authentication required",
        })
      );
    }
    case "recovery-identity-required":
    case "restricted-session": {
      return Effect.fail(
        new AuthPolicyDeniedError({
          code: "policy_denied",
          message: "Passkey enrollment prerequisites are incomplete",
        })
      );
    }
    case "rate-limited": {
      return Effect.fail(
        new AuthRateLimitedError({
          code: "rate_limited",
          message: "Too many passkey enrollment attempts",
          retryAfter:
            failure.cause instanceof RateLimitExceededError
              ? failure.cause.retryAfter
              : Duration.seconds(60),
        })
      );
    }
    case "indeterminate": {
      return Effect.fail(
        new AuthInternalError({
          code: "internal_error",
          message:
            "Passkey registration may have completed. Sign in with the new passkey and regenerate recovery codes before retrying.",
        })
      );
    }
    default: {
      return Effect.fail(
        new AuthInternalError({
          code: "internal_error",
          message: "Passkey registration failed",
        })
      );
    }
  }
};

const receiptResponse = (receipt: PasskeyEnrollmentReceipt) =>
  Effect.gen(function* () {
    const encoded = yield* Schema.encodeEffect(PasskeyEnrollmentReceiptSchema)(
      receipt
    ).pipe(Effect.orDie);
    return yield* HttpServerResponse.json(encoded, {
      headers: {
        "cache-control": "private, no-store",
        pragma: "no-cache",
      },
    }).pipe(Effect.orDie);
  });

const publicReadbackDenialResponse = () =>
  HttpServerResponse.json(
    {
      _tag: "AuthBadRequestError",
      code: "bad_request",
      message: "Invalid passkey enrollment request",
    },
    {
      headers: {
        "cache-control": "private, no-store",
        pragma: "no-cache",
      },
      status: 400,
    }
  ).pipe(Effect.orDie);

const publicReadbackRateLimitResponse = (retryAfter: Duration.Duration) =>
  HttpServerResponse.json(
    {
      _tag: "AuthRateLimitedError",
      code: "rate_limited",
      message: "Too many passkey enrollment readback attempts",
      retryAfter: Duration.toMillis(retryAfter),
    },
    {
      headers: {
        "cache-control": "private, no-store",
        pragma: "no-cache",
        "retry-after": String(
          Math.max(1, Math.ceil(Duration.toMillis(retryAfter) / 1000))
        ),
      },
      status: 429,
    }
  ).pipe(Effect.orDie);

export const PasskeyEnrollmentHttpHandlersLayer = HttpApiBuilder.group(
  PasskeyEnrollmentHttpApi,
  "passkey",
  Effect.fn("auth.http.passkey_enrollment_group")(function* (handlers) {
    const enrollment = yield* PasskeyEnrollment;
    return handlers
      .handle("registerStart", ({ payload }) =>
        enrollment
          .start(payload)
          .pipe(Effect.catchTag("PasskeyEnrollmentError", mapError))
      )
      .handle("registerFinish", ({ payload }) =>
        enrollment
          .finish(payload)
          .pipe(Effect.flatMap(({ receipt }) => receiptResponse(receipt)))
          .pipe(Effect.catchTag("PasskeyEnrollmentError", mapError))
      )
      .handle("readRegisterOperation", ({ payload }) =>
        enrollment
          .readOperation(payload)
          .pipe(Effect.flatMap(receiptResponse))
          .pipe(Effect.catchTag("PasskeyEnrollmentError", mapError))
      );
  })
);

export const RecoveryPasskeyEnrollmentHttpHandlersLayer = HttpApiBuilder.group(
  RecoveryPasskeyEnrollmentHttpApi,
  "recoveryPasskeyEnrollment",
  Effect.fn("auth.http.recovery_passkey_enrollment")(function* (handlers) {
    const enrollment = yield* PasskeyEnrollment;
    const sessionCookie = yield* SessionCookie;
    return handlers
      .handle("start", ({ payload }) =>
        enrollment
          .start(payload)
          .pipe(Effect.catchTag("PasskeyEnrollmentError", mapError))
      )
      .handle("finish", ({ payload }) =>
        Effect.gen(function* () {
          const result = yield* enrollment
            .finish(payload)
            .pipe(Effect.catchTag("PasskeyEnrollmentError", mapError));
          if (result.remediation === undefined) {
            return yield* HttpServerResponse.json(
              PasskeyEnrollmentAlreadyCompleted.make({
                receipt: result.receipt,
                type: "passkey-enrollment-already-completed",
              }),
              {
                headers: {
                  "cache-control": "private, no-store",
                  pragma: "no-cache",
                },
              }
            ).pipe(Effect.orDie);
          }
          const cookie = yield* sessionCookie
            .commit(result.remediation.session)
            .pipe(
              Effect.mapError(
                () =>
                  new AuthInternalError({
                    code: "internal_error",
                    message:
                      "Recovery may have completed. Sign in with the new passkey and regenerate recovery codes.",
                  })
              )
            );
          return yield* HttpServerResponse.json(result.remediation.body, {
            headers: {
              "cache-control": "private, no-store",
              pragma: "no-cache",
              "set-cookie": cookie,
            },
          }).pipe(Effect.orDie);
        })
      );
  })
);

export const RecoveryPasskeyEnrollmentReadbackHttpHandlersLayer =
  HttpApiBuilder.group(
    RecoveryPasskeyEnrollmentReadbackHttpApi,
    "recoveryPasskeyEnrollmentReadback",
    Effect.fn("auth.http.recovery_passkey_enrollment_readback")(
      function* (handlers) {
        const authRateLimit = yield* AuthRateLimit;
        const enrollment = yield* PasskeyEnrollment;
        return handlers.handle("readOperation", ({ payload }) =>
          Effect.gen(function* () {
            const metadata = yield* AuthRequestMetadata;
            const limited = yield* authRateLimit
              .require({
                operation: "auth.passkey.registration_finish",
                policy: AuthRateLimit.rules([
                  {
                    id: "app.account_recovery.passkey_read.ip",
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
                    ? cause
                    : new AuthInternalError({
                        code: "internal_error",
                        message: "Passkey enrollment readback failed",
                      })
                ),
                Effect.as(null),
                Effect.catchTag("RateLimitExceededError", (cause) =>
                  publicReadbackRateLimitResponse(cause.retryAfter)
                )
              );
            if (limited !== null) {
              return limited;
            }
            return yield* enrollment
              .readRecoveryOperation(payload)
              .pipe(Effect.flatMap(receiptResponse))
              .pipe(
                Effect.catchTag("PasskeyEnrollmentError", (failure) =>
                  failure.reason === "invalid-input" ||
                  failure.reason === "invalid-proof"
                    ? publicReadbackDenialResponse()
                    : mapError(failure)
                )
              );
          })
        );
      }
    )
  );
