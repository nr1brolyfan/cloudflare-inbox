import {
  AuthBadRequestError,
  AuthConflictError,
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

import { RecoveryRemediationRequestAuthMiddleware } from "#/modules/account-security/adapters/http/RequestSessionAuthentication";
import {
  FinishPasskeyEnrollmentCommand,
  RecoveryPasskeyRemediationCompleted,
  StartedPasskeyEnrollment,
  StartPasskeyEnrollmentCommand,
} from "#/modules/account-security/application/PasskeyEnrollment";
import { BackendRequestContextMiddleware } from "#/platform/observability/BackendRequestContextMiddleware";

const errors = [
  AuthBadRequestError,
  AuthUnauthenticatedError,
  AuthPolicyDeniedError,
  AuthStepUpRequiredError,
  AuthConflictError,
  AuthRateLimitedError,
  AuthInternalError,
] as const;

const Start = HttpApiEndpoint.post(
  "start",
  "/auth/account-recovery/passkey/enroll/start",
  {
    error: errors,
    payload: StartPasskeyEnrollmentCommand,
    success: StartedPasskeyEnrollment,
  }
);
const Finish = HttpApiEndpoint.post(
  "finish",
  "/auth/account-recovery/passkey/enroll/finish",
  {
    error: errors,
    payload: FinishPasskeyEnrollmentCommand,
    success: RecoveryPasskeyRemediationCompleted,
  }
);

export class RecoveryPasskeyEnrollmentGroup extends HttpApiGroup.make(
  "recoveryPasskeyEnrollment"
)
  .add(Start, Finish)
  .middleware(AuthSchemaErrorMiddleware)
  .middleware(BackendRequestContextMiddleware)
  .middleware(RecoveryRemediationRequestAuthMiddleware)
  .middleware(AuthOriginCheckMiddleware) {}
