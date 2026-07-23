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
  HttpApiSchema,
} from "effect/unstable/httpapi";

import {
  EnrollExternalRecoveryIdentityCommand,
  ExternalRecoveryIdentityOperationReceiptSchema,
  ReadExternalRecoveryIdentityOperationQuery,
  VerifyExternalRecoveryIdentityCommand,
} from "#/modules/account-security/application/ExternalRecoveryIdentityManagement";
import { CurrentRequestAuthMiddleware } from "#/modules/account-security/contracts/RequestAuthMiddleware";
import { ExternalRecoveryIdentitySchema } from "#/modules/account-security/domain/ExternalRecoveryIdentity";
import { BackendRequestContextMiddleware } from "#/platform/observability/BackendRequestContextMiddleware";

const ExternalRecoveryIdentityErrors = [
  AuthBadRequestError,
  AuthUnauthenticatedError,
  AuthPolicyDeniedError,
  AuthStepUpRequiredError,
  AuthConflictError,
  AuthNotFoundError,
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

export const ReadExternalRecoveryIdentityOperationEndpoint =
  HttpApiEndpoint.get(
    "readOperation",
    "/auth/external-recovery-identity/operations/:operationId",
    {
      error: ExternalRecoveryIdentityErrors,
      params: Schema.Struct({
        operationId:
          ReadExternalRecoveryIdentityOperationQuery.fields.operationId,
      }),
      success: ExternalRecoveryIdentityOperationReceiptSchema,
    }
  );

export class ExternalRecoveryIdentityGroup extends HttpApiGroup.make(
  "externalRecoveryIdentity"
)
  .add(
    EnrollExternalRecoveryIdentityEndpoint,
    ReadExternalRecoveryIdentityOperationEndpoint,
    VerifyExternalRecoveryIdentityEndpoint
  )
  .middleware(AuthSchemaErrorMiddleware)
  .middleware(BackendRequestContextMiddleware)
  .middleware(CurrentRequestAuthMiddleware)
  .middleware(AuthOriginCheckMiddleware) {}

export const ExternalRecoveryIdentityHttpApi = HttpApi.make("AuthApi").add(
  ExternalRecoveryIdentityGroup
);

export const ExternalRecoveryIdentityClientHttpApi = HttpApi.make(
  "externalRecoveryIdentityClient"
).add(ExternalRecoveryIdentityGroup);
