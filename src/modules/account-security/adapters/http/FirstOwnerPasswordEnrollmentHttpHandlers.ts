import {
  AuthBadRequestError,
  AuthConflictError,
  AuthInternalError,
  AuthPolicyDeniedError,
  AuthRateLimitedError,
  AuthStepUpRequiredError,
} from "@effect-auth/core/HttpApi";
import { RateLimitExceededError } from "@effect-auth/core/RateLimiter";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";

import {
  FirstOwnerPasswordEnrollment,
  FirstOwnerPasswordEnrollmentResult,
} from "#/modules/account-security/application/FirstOwnerPasswordEnrollment";
import type { FirstOwnerPasswordEnrollmentError } from "#/modules/account-security/application/FirstOwnerPasswordEnrollment";

import { FirstOwnerPasswordEnrollmentHttpApi } from "./FirstOwnerPasswordEnrollmentHttpApi";

type PublicError =
  | AuthBadRequestError
  | AuthConflictError
  | AuthInternalError
  | AuthPolicyDeniedError
  | AuthRateLimitedError
  | AuthStepUpRequiredError;

const mapError = (
  error: FirstOwnerPasswordEnrollmentError
): Effect.Effect<never, PublicError> => {
  switch (error.reason) {
    case "invalid-input": {
      return Effect.fail(
        new AuthBadRequestError({
          code: "bad_request",
          message: "Invalid password enrollment request",
        })
      );
    }
    case "operation-conflict":
    case "state-conflict": {
      return Effect.fail(
        new AuthConflictError({
          code: "conflict",
          message: "Password enrollment conflict",
        })
      );
    }
    case "rate-limited": {
      return Effect.fail(
        new AuthRateLimitedError({
          code: "rate_limited",
          message: "Too many password enrollment requests",
          retryAfter:
            error.cause instanceof RateLimitExceededError
              ? error.cause.retryAfter
              : Duration.seconds(60),
        })
      );
    }
    case "proof-required": {
      return Effect.fail(
        new AuthStepUpRequiredError({
          code: "step_up_required",
          message: "Fresh email authentication required",
        })
      );
    }
    case "deployment-not-empty":
    case "owner-config-invalid":
    case "owner-not-eligible":
    case "restricted-session": {
      return Effect.fail(
        new AuthPolicyDeniedError({
          code: "policy_denied",
          message: "First-owner password enrollment denied",
        })
      );
    }
    default: {
      return Effect.fail(
        new AuthInternalError({
          code: "internal_error",
          message: "Password enrollment failed",
        })
      );
    }
  }
};

export const FirstOwnerPasswordEnrollmentHttpHandlersLayer =
  HttpApiBuilder.group(
    FirstOwnerPasswordEnrollmentHttpApi,
    "firstOwnerPasswordEnrollment",
    Effect.fn("auth.http.first_owner_password_enrollment")(
      function* (handlers) {
        const enrollment = yield* FirstOwnerPasswordEnrollment;
        return handlers.handle("enroll", ({ payload }) =>
          Effect.gen(function* () {
            const result = yield* enrollment
              .enroll(payload)
              .pipe(
                Effect.catchTag("FirstOwnerPasswordEnrollmentError", mapError)
              );
            const encoded = yield* Schema.encodeEffect(
              FirstOwnerPasswordEnrollmentResult
            )(result).pipe(Effect.orDie);
            return yield* HttpServerResponse.json(encoded, {
              headers: {
                "cache-control": "private, no-store",
                pragma: "no-cache",
              },
              status: result._tag === "FirstOwnerPasswordEnrolled" ? 201 : 200,
            }).pipe(Effect.orDie);
          })
        );
      }
    )
  );
