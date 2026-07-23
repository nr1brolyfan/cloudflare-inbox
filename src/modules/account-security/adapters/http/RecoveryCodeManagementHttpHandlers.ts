import {
  AuthBadRequestError,
  AuthConflictError,
  AuthInternalError,
  AuthNotFoundError,
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
  GenerateRecoveryCodesResult,
  RecoveryCodeAdministration,
  RecoveryCodeRotationReceiptSchema,
} from "#/modules/account-security/application/RecoveryCodeAdministration";
import type { RecoveryCodeAdministrationError } from "#/modules/account-security/application/RecoveryCodeAdministration";

import { RecoveryCodeManagementHttpApi } from "./RecoveryCodeManagementHttpApi";

type PublicError =
  | AuthBadRequestError
  | AuthConflictError
  | AuthInternalError
  | AuthNotFoundError
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
    case "operation-conflict":
    case "state-conflict": {
      return Effect.fail(
        new AuthConflictError({
          code: "conflict",
          message: "Recovery-code rotation conflict",
        })
      );
    }
    case "not-found": {
      return Effect.fail(
        new AuthNotFoundError({
          code: "not_found",
          message: "Recovery-code rotation not found",
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
            "Recovery-code replacement outcome is unknown. Check the operation before rotating again.",
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

export const RecoveryCodeManagementHttpHandlersLayer = HttpApiBuilder.group(
  RecoveryCodeManagementHttpApi,
  "recoveryCodeManagement",
  Effect.fn("auth.http.recovery_code_management")(function* (handlers) {
    const administration = yield* RecoveryCodeAdministration;
    return handlers
      .handle("generate", ({ payload }) =>
        Effect.gen(function* () {
          const result = yield* administration
            .generate(payload)
            .pipe(Effect.catchTag("RecoveryCodeAdministrationError", mapError));
          const encoded = yield* Schema.encodeEffect(
            GenerateRecoveryCodesResult
          )(result).pipe(Effect.orDie);
          return yield* HttpServerResponse.json(encoded, {
            headers: {
              "cache-control": "private, no-store",
              pragma: "no-cache",
            },
          }).pipe(Effect.orDie);
        })
      )
      .handle("readOperation", ({ params }) =>
        Effect.gen(function* () {
          const receipt = yield* administration
            .readOperation(params)
            .pipe(Effect.catchTag("RecoveryCodeAdministrationError", mapError));
          const encoded = yield* Schema.encodeEffect(
            RecoveryCodeRotationReceiptSchema
          )(receipt).pipe(Effect.orDie);
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
