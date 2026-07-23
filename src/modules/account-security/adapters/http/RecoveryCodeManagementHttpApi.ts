import {
  AuthBadRequestError,
  AuthConflictError,
  AuthInternalError,
  AuthNotFoundError,
  AuthOriginCheckMiddleware,
  AuthPolicyDeniedError,
  AuthRateLimitedError,
  AuthSchemaErrorMiddleware,
  AuthStepUpRequiredError,
  AuthUnauthenticatedError,
} from "@effect-auth/core/HttpApi";
import * as Schema from "effect/Schema";
import * as HttpApi from "effect/unstable/httpapi/HttpApi";
import * as HttpApiEndpoint from "effect/unstable/httpapi/HttpApiEndpoint";
import * as HttpApiGroup from "effect/unstable/httpapi/HttpApiGroup";

import {
  GenerateRecoveryCodesCommand,
  GenerateRecoveryCodesResult,
  ReadRecoveryCodeRotationQuery,
  RecoveryCodeRotationReceiptSchema,
} from "#/modules/account-security/application/RecoveryCodeAdministration";
import { CurrentRequestAuthMiddleware } from "#/modules/account-security/contracts/RequestAuthMiddleware";
import { BackendRequestContextMiddleware } from "#/platform/observability/BackendRequestContextMiddleware";

const Generate = HttpApiEndpoint.post(
  "generate",
  "/auth/recovery-codes/generate",
  {
    error: [
      AuthBadRequestError,
      AuthUnauthenticatedError,
      AuthPolicyDeniedError,
      AuthStepUpRequiredError,
      AuthRateLimitedError,
      AuthConflictError,
      AuthNotFoundError,
      AuthInternalError,
    ],
    payload: GenerateRecoveryCodesCommand,
    success: GenerateRecoveryCodesResult,
  }
);

const ReadOperation = HttpApiEndpoint.get(
  "readOperation",
  "/auth/recovery-codes/operations/:operationId",
  {
    error: [
      AuthBadRequestError,
      AuthUnauthenticatedError,
      AuthPolicyDeniedError,
      AuthStepUpRequiredError,
      AuthRateLimitedError,
      AuthConflictError,
      AuthNotFoundError,
      AuthInternalError,
    ],
    params: Schema.Struct({
      operationId: ReadRecoveryCodeRotationQuery.fields.operationId,
    }),
    success: RecoveryCodeRotationReceiptSchema,
  }
);

export class RecoveryCodeManagementGroup extends HttpApiGroup.make(
  "recoveryCodeManagement"
)
  .add(Generate, ReadOperation)
  .middleware(AuthSchemaErrorMiddleware)
  .middleware(BackendRequestContextMiddleware)
  .middleware(CurrentRequestAuthMiddleware)
  .middleware(AuthOriginCheckMiddleware) {}

export const RecoveryCodeManagementHttpApi = HttpApi.make("AuthApi").add(
  RecoveryCodeManagementGroup
);
