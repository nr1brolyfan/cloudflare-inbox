import {
  AuthBadRequestError,
  AuthConflictError,
  AuthInternalError,
  AuthPolicyDeniedError,
  AuthStepUpRequiredError,
} from "@effect-auth/core/HttpApi";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { ExternalRecoveryIdentityManagement } from "../auth/external-recovery-identity-management";
import type { ExternalRecoveryIdentityManagementError } from "../auth/external-recovery-identity-management";
import { BackendHttpApi } from "./api";

type ExternalRecoveryIdentityPublicError =
  | AuthBadRequestError
  | AuthConflictError
  | AuthInternalError
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

export const ExternalRecoveryIdentityGroupLive = HttpApiBuilder.group(
  BackendHttpApi,
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
