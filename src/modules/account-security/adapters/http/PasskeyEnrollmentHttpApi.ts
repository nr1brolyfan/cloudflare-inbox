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
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
} from "effect/unstable/httpapi";

import {
  FinishPasskeyEnrollmentCommand,
  PasskeyEnrollmentReceiptSchema,
  ReadPasskeyEnrollmentCommand,
  StartedPasskeyEnrollment,
  StartPasskeyEnrollmentCommand,
} from "#/modules/account-security/application/PasskeyEnrollment";
import { CurrentRequestAuthMiddleware } from "#/modules/account-security/contracts/RequestAuthMiddleware";
import { BackendRequestContextMiddleware } from "#/platform/observability/BackendRequestContextMiddleware";

const errors = [
  AuthBadRequestError,
  AuthUnauthenticatedError,
  AuthPolicyDeniedError,
  AuthStepUpRequiredError,
  AuthConflictError,
  AuthInternalError,
  AuthRateLimitedError,
] as const;

const Start = HttpApiEndpoint.post(
  "registerStart",
  "/auth/passkey/register/start",
  {
    error: errors,
    payload: StartPasskeyEnrollmentCommand,
    success: StartedPasskeyEnrollment,
  }
);
const Finish = HttpApiEndpoint.post(
  "registerFinish",
  "/auth/passkey/register/finish",
  {
    error: errors,
    payload: FinishPasskeyEnrollmentCommand,
    success: PasskeyEnrollmentReceiptSchema,
  }
);
const ReadOperation = HttpApiEndpoint.post(
  "readRegisterOperation",
  "/auth/passkey/register/read",
  {
    error: errors,
    payload: ReadPasskeyEnrollmentCommand,
    success: PasskeyEnrollmentReceiptSchema,
  }
);

export class PasskeyEnrollmentGroup extends HttpApiGroup.make("passkey")
  .add(Start, Finish, ReadOperation)
  .middleware(AuthSchemaErrorMiddleware)
  .middleware(BackendRequestContextMiddleware)
  .middleware(CurrentRequestAuthMiddleware)
  .middleware(AuthOriginCheckMiddleware) {}

export const PasskeyEnrollmentHttpApi = HttpApi.make("AuthApi").add(
  PasskeyEnrollmentGroup
);
