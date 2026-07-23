import {
  AuthBadRequestError,
  AuthConflictError,
  AuthInternalError,
  AuthOriginCheckMiddleware,
  AuthPolicyDeniedError,
  AuthSchemaErrorMiddleware,
  AuthStepUpRequiredError,
  AuthUnauthenticatedError,
} from "@effect-auth/core/HttpApi";
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
} from "effect/unstable/httpapi";

import { CurrentRequestAuthMiddleware } from "#/modules/account-security/adapters/http/RequestSessionAuthentication";
import {
  EnrollExternalRecoveryIdentityCommand,
  VerifyExternalRecoveryIdentityCommand,
} from "#/modules/account-security/application/ExternalRecoveryIdentityManagement";
import { ExternalRecoveryIdentitySchema } from "#/modules/account-security/domain/ExternalRecoveryIdentity";
import { BackendRequestContextMiddleware } from "#/observability/request-context-middleware";

const ExternalRecoveryIdentityErrors = [
  AuthBadRequestError,
  AuthUnauthenticatedError,
  AuthPolicyDeniedError,
  AuthStepUpRequiredError,
  AuthConflictError,
  AuthInternalError,
] as const;

export const EnrollExternalRecoveryIdentityEndpoint = HttpApiEndpoint.post(
  "enroll",
  "/auth/external-recovery-identity/enroll",
  {
    error: ExternalRecoveryIdentityErrors,
    payload: EnrollExternalRecoveryIdentityCommand,
    success: ExternalRecoveryIdentitySchema.pipe(HttpApiSchema.status(201)),
  }
);

export const VerifyExternalRecoveryIdentityEndpoint = HttpApiEndpoint.post(
  "verify",
  "/auth/external-recovery-identity/verify",
  {
    error: ExternalRecoveryIdentityErrors,
    payload: VerifyExternalRecoveryIdentityCommand,
    success: ExternalRecoveryIdentitySchema,
  }
);

export class ExternalRecoveryIdentityGroup extends HttpApiGroup.make(
  "externalRecoveryIdentity"
)
  .add(
    EnrollExternalRecoveryIdentityEndpoint,
    VerifyExternalRecoveryIdentityEndpoint
  )
  .middleware(AuthSchemaErrorMiddleware)
  .middleware(BackendRequestContextMiddleware)
  .middleware(CurrentRequestAuthMiddleware)
  .middleware(AuthOriginCheckMiddleware) {}

export const ExternalRecoveryIdentityClientHttpApi = HttpApi.make(
  "externalRecoveryIdentityClient"
).add(ExternalRecoveryIdentityGroup);
