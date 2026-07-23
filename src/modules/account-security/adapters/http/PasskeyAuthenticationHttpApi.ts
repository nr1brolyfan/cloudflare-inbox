import {
  AuthBadRequestError,
  AuthInternalError,
  AuthOriginCheckMiddleware,
  AuthPolicyDeniedError,
  AuthRateLimitedError,
  AuthRequestMetadataMiddleware,
  AuthSchemaErrorMiddleware,
  AuthenticatedHttpBody,
  PasskeyAuthenticationStartedBody,
} from "@effect-auth/core/HttpApi";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";

import {
  FinishPasskeySignInCommand,
  StartPasskeySignInCommand,
} from "#/modules/account-security/application/PasskeyAuthentication";
import { BackendRequestContextMiddleware } from "#/observability/request-context-middleware";

const errors = [
  AuthBadRequestError,
  AuthPolicyDeniedError,
  AuthRateLimitedError,
  AuthInternalError,
] as const;

const Start = HttpApiEndpoint.post(
  "authenticateStart",
  "/auth/passkey/authenticate/start",
  {
    error: errors,
    payload: StartPasskeySignInCommand,
    success: PasskeyAuthenticationStartedBody,
  }
);
const Finish = HttpApiEndpoint.post(
  "authenticateFinish",
  "/auth/passkey/authenticate/finish",
  {
    error: errors,
    payload: FinishPasskeySignInCommand,
    success: AuthenticatedHttpBody,
  }
);

export class PasskeyAuthenticationGroup extends HttpApiGroup.make(
  "passkeyAuthentication"
)
  .add(Start, Finish)
  .middleware(AuthSchemaErrorMiddleware)
  .middleware(BackendRequestContextMiddleware)
  .middleware(AuthRequestMetadataMiddleware)
  .middleware(AuthOriginCheckMiddleware) {}
