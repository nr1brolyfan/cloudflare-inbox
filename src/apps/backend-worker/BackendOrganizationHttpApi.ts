import {
  AuthBadRequestError,
  AuthConflictError,
  AuthInternalError,
  AuthNotFoundError,
  AuthOriginCheckMiddleware,
  AuthPolicyDeniedError,
  AuthSchemaErrorMiddleware,
  AuthStepUpRequiredError,
  AuthUnauthenticatedError,
} from "@effect-auth/core/HttpApi";
import * as Schema from "effect/Schema";
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
} from "effect/unstable/httpapi";

import { SessionAuthenticationMiddleware } from "#/modules/account-security/contracts/RequestAuthMiddleware";
import {
  OrganizationAdministrationReceiptSchema,
  ReadOrganizationAdministrationOperationQuery,
  ResumeOrganizationCommand,
  SuspendOrganizationCommand,
} from "#/modules/organization/application/OrganizationAdministration";
import {
  OrganizationId,
  OrganizationSchema,
} from "#/modules/organization/domain/Organization";
import { BackendRequestContextMiddleware } from "#/platform/observability/BackendRequestContextMiddleware";

import {
  OrganizationOperation,
  OrganizationSessionRequirementsMiddleware,
} from "./OrganizationSessionRequirements";

const OrganizationErrors = Schema.Union([
  AuthBadRequestError,
  AuthConflictError,
  AuthInternalError,
  AuthNotFoundError,
  AuthPolicyDeniedError,
  AuthStepUpRequiredError,
  AuthUnauthenticatedError,
]);
const OrganizationParams = Schema.Struct({ organizationId: OrganizationId });
const LifecyclePayload = Schema.Struct({
  expectedVersion: SuspendOrganizationCommand.fields.expectedVersion,
  operationId: SuspendOrganizationCommand.fields.operationId,
});

export const SuspendOrganizationEndpoint = HttpApiEndpoint.post(
  OrganizationOperation.suspend,
  "/api/organizations/:organizationId/suspend",
  {
    error: OrganizationErrors,
    params: OrganizationParams,
    payload: LifecyclePayload,
    success: OrganizationSchema,
  }
);

export const ResumeOrganizationEndpoint = HttpApiEndpoint.post(
  OrganizationOperation.resume,
  "/api/organizations/:organizationId/resume",
  {
    error: OrganizationErrors,
    params: OrganizationParams,
    payload: Schema.Struct({
      expectedVersion: ResumeOrganizationCommand.fields.expectedVersion,
      operationId: ResumeOrganizationCommand.fields.operationId,
    }),
    success: OrganizationSchema,
  }
);

export const ReadOrganizationLifecycleOperationEndpoint = HttpApiEndpoint.get(
  OrganizationOperation.readLifecycleOperation,
  "/api/organizations/operations/:operationId",
  {
    error: OrganizationErrors,
    params: ReadOrganizationAdministrationOperationQuery,
    success: OrganizationAdministrationReceiptSchema,
  }
);

export class OrganizationGroup extends HttpApiGroup.make("organizations")
  .add(
    ReadOrganizationLifecycleOperationEndpoint,
    ResumeOrganizationEndpoint,
    SuspendOrganizationEndpoint
  )
  .middleware(AuthSchemaErrorMiddleware)
  .middleware(BackendRequestContextMiddleware)
  .middleware(OrganizationSessionRequirementsMiddleware)
  .middleware(SessionAuthenticationMiddleware)
  .middleware(AuthOriginCheckMiddleware) {}

export const OrganizationHttpApi =
  HttpApi.make("AuthApi").add(OrganizationGroup);
