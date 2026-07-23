import {
  AuthBadRequestError,
  AuthInternalError,
  AuthOriginCheckMiddleware,
  AuthRateLimitedError,
  AuthRequestMetadataMiddleware,
  AuthSchemaErrorMiddleware,
  AuthenticatedHttpBody,
} from "@effect-auth/core/HttpApi";
import * as HttpApiEndpoint from "effect/unstable/httpapi/HttpApiEndpoint";
import * as HttpApiGroup from "effect/unstable/httpapi/HttpApiGroup";

import {
  AccountRecoveryAccepted,
  CompleteAccountRecoveryCommand,
  StartAccountRecoveryCommand,
} from "#/modules/account-security/domain/AccountRecovery";
import { BackendRequestContextMiddleware } from "#/observability/request-context-middleware";

const errors = [
  AuthBadRequestError,
  AuthRateLimitedError,
  AuthInternalError,
] as const;

const Start = HttpApiEndpoint.post("start", "/auth/account-recovery/start", {
  error: errors,
  payload: StartAccountRecoveryCommand,
  success: AccountRecoveryAccepted,
});
const Complete = HttpApiEndpoint.post(
  "complete",
  "/auth/account-recovery/complete",
  {
    error: errors,
    payload: CompleteAccountRecoveryCommand,
    success: AuthenticatedHttpBody,
  }
);

export class AccountRecoveryGroup extends HttpApiGroup.make("accountRecovery")
  .add(Start, Complete)
  .middleware(AuthSchemaErrorMiddleware)
  .middleware(BackendRequestContextMiddleware)
  .middleware(AuthRequestMetadataMiddleware)
  .middleware(AuthOriginCheckMiddleware) {}
