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

import type { OrganizationAdministrationError } from "#/modules/organization/application/OrganizationAdministration";
import {
  OrganizationAdministration,
  OrganizationAdministrationReceiptSchema,
} from "#/modules/organization/application/OrganizationAdministration";

import { OrganizationHttpApi } from "./BackendOrganizationHttpApi";

type OrganizationPublicError =
  | AuthBadRequestError
  | AuthConflictError
  | AuthInternalError
  | AuthNotFoundError
  | AuthPolicyDeniedError
  | AuthStepUpRequiredError;

const internalError = () =>
  new AuthInternalError({
    code: "internal_error",
    message: "Organization operation failed",
  });

const mapAdministrationError = (
  error: OrganizationAdministrationError
): Effect.Effect<never, OrganizationPublicError> => {
  switch (error.reason) {
    case "invalid-input": {
      return Effect.fail(
        new AuthBadRequestError({
          code: "bad_request",
          message: "Invalid organization request",
        })
      );
    }
    case "conflict":
    case "operation-conflict": {
      return Effect.fail(
        new AuthConflictError({
          code: "conflict",
          message:
            error.reason === "operation-conflict"
              ? "Organization operation ID conflict"
              : "Organization changed",
        })
      );
    }
    case "not-found": {
      return Effect.fail(
        new AuthNotFoundError({
          code: "not_found",
          message: "Organization operation not found",
        })
      );
    }
    case "authorization-recheck":
    case "membership-recheck": {
      return Effect.fail(
        new AuthPolicyDeniedError({
          code: "policy_denied",
          message: "Organization operation denied",
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
    case "session-recheck": {
      return Effect.fail(
        new AuthPolicyDeniedError({
          code: "policy_denied",
          message: "Complete account verification and sign in again",
        })
      );
    }
    default: {
      return Effect.fail(internalError());
    }
  }
};

export const OrganizationHttpHandlersLayer = HttpApiBuilder.group(
  OrganizationHttpApi,
  "organizations",
  Effect.fn("backend.http.organization_group")(function* (handlers) {
    const administration = yield* OrganizationAdministration;
    return handlers
      .handle("readOrganizationLifecycleOperation", ({ params }) =>
        administration.readOperation(params).pipe(
          Effect.catchTag(
            "OrganizationAdministrationError",
            mapAdministrationError
          ),
          Effect.flatMap((receipt) =>
            Schema.encodeEffect(OrganizationAdministrationReceiptSchema)(
              receipt
            ).pipe(
              Effect.flatMap((encoded) =>
                HttpServerResponse.json(encoded, {
                  headers: {
                    "cache-control": "private, no-store",
                    pragma: "no-cache",
                  },
                })
              ),
              Effect.orDie
            )
          )
        )
      )
      .handle("resumeOrganization", ({ params, payload }) =>
        administration
          .resume({ ...params, ...payload })
          .pipe(
            Effect.catchTag(
              "OrganizationAdministrationError",
              mapAdministrationError
            )
          )
      )
      .handle("suspendOrganization", ({ params, payload }) =>
        administration
          .suspend({ ...params, ...payload })
          .pipe(
            Effect.catchTag(
              "OrganizationAdministrationError",
              mapAdministrationError
            )
          )
      );
  })
);
