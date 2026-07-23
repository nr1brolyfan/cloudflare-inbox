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
  ChallengeIdSchema,
  UnixMillisSchema,
} from "@effect-auth/core/Identifiers";
import * as Schema from "effect/Schema";
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
} from "effect/unstable/httpapi";

import {
  EnrolledPasskeyCredential,
  FinishPasskeyEnrollmentCommand,
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

const RegistrationOptions = Schema.Struct({
  attestation: Schema.optional(Schema.String),
  authenticatorSelection: Schema.optional(
    Schema.Record(Schema.String, Schema.Unknown)
  ),
  challenge: Schema.String,
  excludeCredentials: Schema.optional(Schema.Array(Schema.Unknown)),
  pubKeyCredParams: Schema.Array(Schema.Unknown),
  rp: Schema.Struct({ id: Schema.String, name: Schema.String }),
  timeout: Schema.optional(Schema.Number),
  user: Schema.Struct({
    displayName: Schema.String,
    id: Schema.String,
    name: Schema.String,
  }),
});

const Started = Schema.Struct({
  challengeId: ChallengeIdSchema,
  expiresAt: UnixMillisSchema,
  publicKey: RegistrationOptions,
});

const Start = HttpApiEndpoint.post(
  "registerStart",
  "/auth/passkey/register/start",
  {
    error: errors,
    payload: Schema.Struct({}),
    success: Started,
  }
);
const Finish = HttpApiEndpoint.post(
  "registerFinish",
  "/auth/passkey/register/finish",
  {
    error: errors,
    payload: FinishPasskeyEnrollmentCommand,
    success: EnrolledPasskeyCredential,
  }
);

export class PasskeyEnrollmentGroup extends HttpApiGroup.make("passkey")
  .add(Start, Finish)
  .middleware(AuthSchemaErrorMiddleware)
  .middleware(BackendRequestContextMiddleware)
  .middleware(CurrentRequestAuthMiddleware)
  .middleware(AuthOriginCheckMiddleware) {}

export const PasskeyEnrollmentHttpApi = HttpApi.make("AuthApi").add(
  PasskeyEnrollmentGroup
);
