import {
  AuthBadRequestError,
  AuthInternalError,
  AuthOriginCheckMiddleware,
  AuthPolicyDeniedError,
  AuthRateLimitedError,
  AuthSchemaErrorMiddleware,
  AuthStepUpRequiredError,
  AuthUnauthenticatedError,
} from "@effect-auth/core/HttpApi";
import * as HttpApi from "effect/unstable/httpapi/HttpApi";
import * as HttpApiEndpoint from "effect/unstable/httpapi/HttpApiEndpoint";
import * as HttpApiGroup from "effect/unstable/httpapi/HttpApiGroup";

import {
  GenerateRecoveryCodesCommand,
  GeneratedRecoveryCodeSet,
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
      AuthInternalError,
    ],
    payload: GenerateRecoveryCodesCommand,
    success: GeneratedRecoveryCodeSet,
  }
);

export class RecoveryCodeManagementGroup extends HttpApiGroup.make(
  "recoveryCodeManagement"
)
  .add(Generate)
  .middleware(AuthSchemaErrorMiddleware)
  .middleware(BackendRequestContextMiddleware)
  .middleware(CurrentRequestAuthMiddleware)
  .middleware(AuthOriginCheckMiddleware) {}

export const RecoveryCodeManagementHttpApi = HttpApi.make("AuthApi").add(
  RecoveryCodeManagementGroup
);
