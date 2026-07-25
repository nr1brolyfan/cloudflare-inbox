import { AuthPolicyDeniedError } from "@effect-auth/core/HttpApi";
import { CurrentSession } from "@effect-auth/core/Sessions";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpApiMiddleware from "effect/unstable/httpapi/HttpApiMiddleware";

import { evaluateSessionRequirements } from "#/modules/account-security/domain/SessionRequirementsPolicy";
import type { VersionedSessionRequirementsMatrix } from "#/modules/account-security/domain/SessionRequirementsPolicy";

export const OrganizationOperation = {
  readLifecycleOperation: "readOrganizationLifecycleOperation",
  resume: "resumeOrganization",
  suspend: "suspendOrganization",
} as const;
export type OrganizationOperation =
  (typeof OrganizationOperation)[keyof typeof OrganizationOperation];

export const ORGANIZATION_SESSION_REQUIREMENTS_MATRIX_ID =
  "organization-session-requirements";
export const ORGANIZATION_SESSION_REQUIREMENTS_POLICY_VERSION = 1;

const unrestrictedOnly = { mode: "unrestricted-only" } as const;

export const OrganizationSessionRequirementsMatrix = {
  matrixId: ORGANIZATION_SESSION_REQUIREMENTS_MATRIX_ID,
  operations: {
    [OrganizationOperation.readLifecycleOperation]: unrestrictedOnly,
    [OrganizationOperation.resume]: unrestrictedOnly,
    [OrganizationOperation.suspend]: unrestrictedOnly,
  },
  policyVersion: ORGANIZATION_SESSION_REQUIREMENTS_POLICY_VERSION,
} as const satisfies VersionedSessionRequirementsMatrix<
  OrganizationOperation,
  typeof ORGANIZATION_SESSION_REQUIREMENTS_MATRIX_ID,
  typeof ORGANIZATION_SESSION_REQUIREMENTS_POLICY_VERSION
>;

export class OrganizationSessionRequirementsMiddleware extends HttpApiMiddleware.Service<
  OrganizationSessionRequirementsMiddleware,
  { requires: CurrentSession }
>()("cloudflare-inbox/OrganizationSessionRequirementsMiddleware", {
  error: AuthPolicyDeniedError,
}) {}

export const OrganizationSessionRequirementsMiddlewareLayer = Layer.succeed(
  OrganizationSessionRequirementsMiddleware,
  (httpEffect, { endpoint }) =>
    Effect.gen(function* () {
      const session = yield* CurrentSession;
      const decision = evaluateSessionRequirements(
        OrganizationSessionRequirementsMatrix,
        endpoint.identifier,
        session.claims
      );
      if (decision.type === "denied") {
        return yield* new AuthPolicyDeniedError({
          code: "policy_denied",
          message: "Organization operation denied",
        });
      }
      return yield* httpEffect;
    })
);
