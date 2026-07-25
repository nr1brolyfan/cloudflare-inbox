import {
  AuthBadRequestError,
  AuthConflictError,
  AuthInternalError,
  AuthOriginCheckMiddleware,
  AuthPolicyDeniedError,
  AuthRateLimitedError,
  AuthSchemaErrorMiddleware,
  AuthUnauthenticatedError,
} from "@effect-auth/core/HttpApi";
import * as HttpApi from "effect/unstable/httpapi/HttpApi";
import * as HttpApiEndpoint from "effect/unstable/httpapi/HttpApiEndpoint";
import * as HttpApiGroup from "effect/unstable/httpapi/HttpApiGroup";
import * as HttpApiSchema from "effect/unstable/httpapi/HttpApiSchema";

import {
  EnrollFirstOwnerPasswordCommand,
  FirstOwnerPasswordAlreadyEnrolled,
  FirstOwnerPasswordEnrolled,
} from "#/modules/account-security/application/FirstOwnerPasswordEnrollment";
import { CurrentRequestAuthMiddleware } from "#/modules/account-security/contracts/RequestAuthMiddleware";
import { BackendRequestContextMiddleware } from "#/platform/observability/BackendRequestContextMiddleware";

const Enroll = HttpApiEndpoint.post("enroll", "/auth/first-owner/password", {
  error: [
    AuthBadRequestError,
    AuthUnauthenticatedError,
    AuthPolicyDeniedError,
    AuthRateLimitedError,
    AuthConflictError,
    AuthInternalError,
  ],
  payload: EnrollFirstOwnerPasswordCommand,
  success: [
    FirstOwnerPasswordEnrolled.pipe(HttpApiSchema.status(201)),
    FirstOwnerPasswordAlreadyEnrolled.pipe(HttpApiSchema.status(200)),
  ],
});

export class FirstOwnerPasswordEnrollmentGroup extends HttpApiGroup.make(
  "firstOwnerPasswordEnrollment"
)
  .add(Enroll)
  .middleware(AuthSchemaErrorMiddleware)
  .middleware(BackendRequestContextMiddleware)
  .middleware(CurrentRequestAuthMiddleware)
  .middleware(AuthOriginCheckMiddleware) {}

export const FirstOwnerPasswordEnrollmentHttpApi = HttpApi.make("AuthApi").add(
  FirstOwnerPasswordEnrollmentGroup
);
