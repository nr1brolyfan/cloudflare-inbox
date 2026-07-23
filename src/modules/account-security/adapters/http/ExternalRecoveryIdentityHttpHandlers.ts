import {
  AuthBadRequestError,
  AuthConflictError,
  AuthInternalError,
  AuthNotFoundError,
  AuthPolicyDeniedError,
  AuthStepUpRequiredError,
} from "@effect-auth/core/HttpApi";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import {
  ExternalRecoveryIdentityManagement,
  ExternalRecoveryIdentityOperationReceiptSchema,
} from "#/modules/account-security/application/ExternalRecoveryIdentityManagement";
import type { ExternalRecoveryIdentityManagementError } from "#/modules/account-security/application/ExternalRecoveryIdentityManagement";

import { ExternalRecoveryIdentityHttpApi } from "./ExternalRecoveryIdentityHttpApi";

type ExternalRecoveryIdentityPublicError =
  | AuthBadRequestError
  | AuthConflictError
  | AuthInternalError
  | AuthNotFoundError
  | AuthPolicyDeniedError
  | AuthStepUpRequiredError;

const internalError = () =>
  new AuthInternalError({
    code: "internal_error",
    message: "External recovery identity operation failed",
  });

const mapManagementError = (
  error: ExternalRecoveryIdentityManagementError
): Effect.Effect<never, ExternalRecoveryIdentityPublicError> => {
  switch (error.reason) {
    case "invalid-input":
    case "challenge-invalid": {
      return Effect.fail(
        new AuthBadRequestError({
          code: "bad_request",
          message: "External recovery verification is invalid",
        })
      );
    }
    case "version-conflict": {
      return Effect.fail(
        new AuthConflictError({
          code: "conflict",
          message: "External recovery identity changed",
        })
      );
    }
    case "operation-conflict": {
      return Effect.fail(
        new AuthConflictError({
          code: "conflict",
          message: "External recovery operation ID conflict",
        })
      );
    }
    case "not-found": {
      return Effect.fail(
        new AuthNotFoundError({
          code: "not_found",
          message: "External recovery operation not found",
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
    case "policy-denied":
    case "restricted-session": {
      return Effect.fail(
        new AuthPolicyDeniedError({
          code: "policy_denied",
          message: "External recovery identity is unavailable",
        })
      );
    }
    case "delivery":
    case "storage": {
      return Effect.fail(internalError());
    }
    default: {
      return Effect.fail(internalError());
    }
  }
};

export const ExternalRecoveryIdentityHttpHandlersLayer = HttpApiBuilder.group(
  ExternalRecoveryIdentityHttpApi,
  "externalRecoveryIdentity",
  Effect.fn("auth.http.external_recovery_identity_group")(function* (handlers) {
    const management = yield* ExternalRecoveryIdentityManagement;

    return handlers
      .handle("enroll", ({ payload }) =>
        management
          .enroll(payload)
          .pipe(
            Effect.catchTag(
              "ExternalRecoveryIdentityManagementError",
              mapManagementError
            )
          )
      )
      .handle("readOperation", ({ params }) =>
        Effect.gen(function* () {
          const receipt = yield* management
            .readOperation(params)
            .pipe(
              Effect.catchTag(
                "ExternalRecoveryIdentityManagementError",
                mapManagementError
              )
            );
          const encoded = yield* Schema.encodeEffect(
            ExternalRecoveryIdentityOperationReceiptSchema
          )(receipt).pipe(Effect.orDie);
          return yield* HttpServerResponse.json(encoded, {
            headers: {
              "cache-control": "private, no-store",
              pragma: "no-cache",
            },
          }).pipe(Effect.orDie);
        })
      )
      .handle("verify", ({ payload }) =>
        management
          .verify(payload)
          .pipe(
            Effect.catchTag(
              "ExternalRecoveryIdentityManagementError",
              mapManagementError
            )
          )
      );
  })
);
