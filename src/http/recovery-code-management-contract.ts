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
import * as HttpApiEndpoint from "effect/unstable/httpapi/HttpApiEndpoint";
import * as HttpApiGroup from "effect/unstable/httpapi/HttpApiGroup";

import {
  GenerateRecoveryCodesCommand,
  GeneratedRecoveryCodeSet,
} from "../auth/recovery-code-administration";
import { CurrentRequestAuthMiddleware } from "../auth/session";
import { BackendRequestContextMiddleware } from "../observability/request-context-middleware";

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
