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

import { ExternalRecoveryIdentitySchema } from "../auth/external-recovery-identity";
import {
  EnrollExternalRecoveryIdentityCommand,
  VerifyExternalRecoveryIdentityCommand,
} from "../auth/external-recovery-identity-management";
import { CurrentRequestAuthMiddleware } from "../auth/session";
import { BackendRequestContextMiddleware } from "../observability/request-context-middleware";

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
