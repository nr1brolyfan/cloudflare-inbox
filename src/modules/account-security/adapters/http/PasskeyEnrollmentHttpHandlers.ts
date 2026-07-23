import {
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
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { PasskeyEnrollment } from "#/modules/account-security/application/PasskeyEnrollment";
import type { PasskeyEnrollmentError } from "#/modules/account-security/application/PasskeyEnrollment";

import { PasskeyEnrollmentHttpApi } from "./PasskeyEnrollmentHttpApi";
import { RecoveryPasskeyEnrollmentHttpApi } from "./RecoveryPasskeyEnrollmentHttpApi";

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

export const PasskeyEnrollmentHttpHandlersLayer = HttpApiBuilder.group(
  PasskeyEnrollmentHttpApi,
  "passkey",
  Effect.fn("auth.http.passkey_enrollment_group")(function* (handlers) {
    const enrollment = yield* PasskeyEnrollment;
    return handlers
      .handle("registerStart", () =>
        enrollment
          .start({})
          .pipe(Effect.catchTag("PasskeyEnrollmentError", mapError))
      )
      .handle("registerFinish", ({ payload }) =>
        enrollment
          .finish(payload)
          .pipe(Effect.map(({ credentialId }) => ({ credentialId })))
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
            return yield* new AuthPolicyDeniedError({
              code: "policy_denied",
              message: "Recovery remediation session required",
            });
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
