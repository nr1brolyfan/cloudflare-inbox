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
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { PasskeyCredentialAdministration } from "#/modules/account-security/application/PasskeyCredentialAdministration";
import type { PasskeyCredentialAdministrationError } from "#/modules/account-security/application/PasskeyCredentialAdministration";

import { PasskeyCredentialManagementHttpApi } from "./PasskeyCredentialManagementHttpApi";

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
  error: PasskeyCredentialAdministrationError
): Effect.Effect<never, PublicError> => {
  switch (error.reason) {
    case "invalid-input": {
      return Effect.fail(
        new AuthBadRequestError({
          code: "bad_request",
          message: "Invalid passkey credential request",
        })
      );
    }
    case "not-found": {
      return Effect.fail(
        new AuthNotFoundError({
          code: "not_found",
          message: "Passkey credential operation not found",
        })
      );
    }
    case "credential-changed":
    case "operation-conflict": {
      return Effect.fail(
        new AuthConflictError({
          code: "conflict",
          message: "Passkey credential changed",
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
    case "unauthenticated": {
      return Effect.fail(
        new AuthUnauthenticatedError({
          code: "unauthenticated",
          message: "Authentication required",
        })
      );
    }
    case "last-factor":
    case "recovery-identity-required":
    case "restricted-session": {
      return Effect.fail(
        new AuthPolicyDeniedError({
          code: "policy_denied",
          message: "Passkey credential operation denied",
        })
      );
    }
    case "rate-limited": {
      return Effect.fail(
        new AuthRateLimitedError({
          code: "rate_limited",
          message: "Too many passkey credential requests",
          retryAfter:
            error.cause instanceof RateLimitExceededError
              ? error.cause.retryAfter
              : Duration.seconds(60),
        })
      );
    }
    default: {
      return Effect.fail(
        new AuthInternalError({
          code: "internal_error",
          message: "Passkey credential operation failed",
        })
      );
    }
  }
};

export const PasskeyCredentialManagementHttpHandlersLayer =
  HttpApiBuilder.group(
    PasskeyCredentialManagementHttpApi,
    "passkeyCredentialManagement",
    Effect.fn("auth.http.passkey_credential_management_group")(
      function* (handlers) {
        const administration = yield* PasskeyCredentialAdministration;
        return handlers
          .handle("list", ({ payload }) =>
            administration
              .list(payload)
              .pipe(
                Effect.catchTag(
                  "PasskeyCredentialAdministrationError",
                  mapError
                )
              )
          )
          .handle("revoke", ({ payload }) =>
            administration
              .revoke(payload)
              .pipe(
                Effect.catchTag(
                  "PasskeyCredentialAdministrationError",
                  mapError
                )
              )
          )
          .handle("readRevocation", ({ payload }) =>
            administration
              .readRevocation(payload)
              .pipe(
                Effect.catchTag(
                  "PasskeyCredentialAdministrationError",
                  mapError
                )
              )
          );
      }
    )
  );
