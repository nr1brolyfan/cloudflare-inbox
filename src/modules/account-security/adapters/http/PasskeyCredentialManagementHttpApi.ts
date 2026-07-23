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
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
} from "effect/unstable/httpapi";

import {
  ListPasskeyCredentialsQuery,
  PasskeyCredentialList,
  PasskeyRevocationReceipt,
  ReadPasskeyRevocationQuery,
  RevokePasskeyCredentialCommand,
} from "#/modules/account-security/application/PasskeyCredentialAdministration";
import { CurrentRequestAuthMiddleware } from "#/modules/account-security/contracts/RequestAuthMiddleware";
import { BackendRequestContextMiddleware } from "#/platform/observability/BackendRequestContextMiddleware";

const errors = [
  AuthBadRequestError,
  AuthUnauthenticatedError,
  AuthPolicyDeniedError,
  AuthStepUpRequiredError,
  AuthNotFoundError,
  AuthConflictError,
  AuthRateLimitedError,
  AuthInternalError,
] as const;

const List = HttpApiEndpoint.post("list", "/auth/passkey/credentials/list", {
  error: errors,
  payload: ListPasskeyCredentialsQuery,
  success: PasskeyCredentialList,
});
const Revoke = HttpApiEndpoint.post(
  "revoke",
  "/auth/passkey/credentials/revoke",
  {
    error: errors,
    payload: RevokePasskeyCredentialCommand,
    success: PasskeyRevocationReceipt,
  }
);
const ReadRevocation = HttpApiEndpoint.post(
  "readRevocation",
  "/auth/passkey/credentials/revocations/read",
  {
    error: errors,
    payload: ReadPasskeyRevocationQuery,
    success: PasskeyRevocationReceipt,
  }
);

export class PasskeyCredentialManagementGroup extends HttpApiGroup.make(
  "passkeyCredentialManagement"
)
  .add(List, Revoke, ReadRevocation)
  .middleware(AuthSchemaErrorMiddleware)
  .middleware(BackendRequestContextMiddleware)
  .middleware(CurrentRequestAuthMiddleware)
  .middleware(AuthOriginCheckMiddleware) {}

export const PasskeyCredentialManagementHttpApi = HttpApi.make("AuthApi").add(
  PasskeyCredentialManagementGroup
);
