import {
  AuthBadRequestError,
  AuthInternalError,
  AuthPolicyDeniedError,
  AuthRateLimitedError,
  AuthStepUpRequiredError,
  AuthUnauthenticatedError,
} from "@effect-auth/core/HttpApi";
import { RateLimitExceededError } from "@effect-auth/core/RateLimiter";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";

import {
  GeneratedRecoveryCodeSet,
  RecoveryCodeAdministration,
} from "../auth/recovery-code-administration";
import type { RecoveryCodeAdministrationError } from "../auth/recovery-code-administration";
import { BackendHttpApi } from "./api";

type PublicError =
  | AuthBadRequestError
  | AuthInternalError
  | AuthPolicyDeniedError
  | AuthRateLimitedError
  | AuthStepUpRequiredError
  | AuthUnauthenticatedError;

const mapError = (
  error: RecoveryCodeAdministrationError
): Effect.Effect<never, PublicError> => {
  switch (error.reason) {
    case "invalid-input": {
      return Effect.fail(
        new AuthBadRequestError({
          code: "bad_request",
          message: "Invalid recovery-code request",
        })
      );
    }
    case "unauthenticated": {
      return Effect.fail(
        new AuthUnauthenticatedError({
          code: "unauthenticated",
          message: "Authentication required",
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
          message: "Recovery-code operation denied",
        })
      );
    }
    case "rate-limited": {
      return Effect.fail(
        new AuthRateLimitedError({
          code: "rate_limited",
          message: "Too many recovery-code requests",
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
            "Recovery-code replacement may have completed. Generate a new set before relying on any codes.",
        })
      );
    }
    default: {
      return Effect.fail(
        new AuthInternalError({
          code: "internal_error",
          message: "Recovery-code operation failed",
        })
      );
    }
  }
};

export const RecoveryCodeManagementApiLayer = HttpApiBuilder.group(
  BackendHttpApi,
  "recoveryCodeManagement",
  Effect.fn("auth.http.recovery_code_management")(function* (handlers) {
    const administration = yield* RecoveryCodeAdministration;
    return handlers.handle("generate", ({ payload }) =>
      Effect.gen(function* () {
        const result = yield* administration
          .generate(payload)
          .pipe(Effect.catchTag("RecoveryCodeAdministrationError", mapError));
        const encoded = yield* Schema.encodeEffect(GeneratedRecoveryCodeSet)(
          result
        ).pipe(Effect.orDie);
        return yield* HttpServerResponse.json(encoded, {
          headers: {
            "cache-control": "private, no-store",
            pragma: "no-cache",
          },
        }).pipe(Effect.orDie);
      })
    );
  })
);
