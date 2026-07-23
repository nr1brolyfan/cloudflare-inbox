/* oxlint-disable max-classes-per-file -- Restricted ceremony and public proof readback require different middleware groups. */
import {
  AuthBadRequestError,
  AuthConflictError,
  AuthInternalError,
  AuthOriginCheckMiddleware,
  AuthRequestMetadataMiddleware,
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
  FinishPasskeyEnrollmentCommand,
  PasskeyEnrollmentReceiptSchema,
  RecoveryPasskeyEnrollmentResult,
  StartedPasskeyEnrollment,
  StartPasskeyEnrollmentCommand,
} from "#/modules/account-security/application/PasskeyEnrollment";
import { RecoveryRemediationRequestAuthMiddleware } from "#/modules/account-security/contracts/RequestAuthMiddleware";
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
    success: RecoveryPasskeyEnrollmentResult,
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

export const RecoveryPasskeyEnrollmentHttpApi = HttpApi.make("AuthApi").add(
  RecoveryPasskeyEnrollmentGroup
);

const ReadOperation = HttpApiEndpoint.post(
  "readOperation",
  "/auth/account-recovery/passkey/enroll/read",
  {
    error: errors,
    payload: Schema.Struct({
      challengeId: Schema.optional(Schema.Unknown),
      credential: Schema.optional(Schema.Unknown),
      operationId: Schema.optional(Schema.Unknown),
      readbackSecret: Schema.optional(Schema.Unknown),
    }),
    success: PasskeyEnrollmentReceiptSchema,
  }
);

export class RecoveryPasskeyEnrollmentReadbackGroup extends HttpApiGroup.make(
  "recoveryPasskeyEnrollmentReadback"
)
  .add(ReadOperation)
  .middleware(AuthSchemaErrorMiddleware)
  .middleware(BackendRequestContextMiddleware)
  .middleware(AuthRequestMetadataMiddleware)
  .middleware(AuthOriginCheckMiddleware) {}

export const RecoveryPasskeyEnrollmentReadbackHttpApi = HttpApi.make(
  "AuthApi"
).add(RecoveryPasskeyEnrollmentReadbackGroup);
