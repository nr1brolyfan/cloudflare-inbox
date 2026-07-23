import {
  AuthBadRequestError,
  AuthInternalError,
  AuthOriginCheckMiddleware,
  AuthRateLimitedError,
  AuthRequestMetadataMiddleware,
  AuthSchemaErrorMiddleware,
} from "@effect-auth/core/HttpApi";
import * as Schema from "effect/Schema";
import * as HttpApi from "effect/unstable/httpapi/HttpApi";
import * as HttpApiEndpoint from "effect/unstable/httpapi/HttpApiEndpoint";
import * as HttpApiGroup from "effect/unstable/httpapi/HttpApiGroup";

import {
  AccountRecoveryAccepted,
  AccountRecoveryCompletionReceipt,
  CompleteAccountRecoveryCommand,
  StartAccountRecoveryCommand,
} from "#/modules/account-security/domain/AccountRecovery";
import { BackendRequestContextMiddleware } from "#/platform/observability/BackendRequestContextMiddleware";

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
    success: AccountRecoveryCompletionReceipt,
  }
);
const ReadCompletion = HttpApiEndpoint.post(
  "readCompletion",
  "/auth/account-recovery/completion/read",
  {
    error: errors,
    // Strict branded decoding happens in the service so missing and malformed
    // public proof has the same response as a mismatched proof.
    payload: Schema.Struct({
      operationId: Schema.optional(Schema.Unknown),
      readbackSecret: Schema.optional(Schema.Unknown),
    }),
    success: AccountRecoveryCompletionReceipt,
  }
);

export class AccountRecoveryGroup extends HttpApiGroup.make("accountRecovery")
  .add(Start, Complete, ReadCompletion)
  .middleware(AuthSchemaErrorMiddleware)
  .middleware(BackendRequestContextMiddleware)
  .middleware(AuthRequestMetadataMiddleware)
  .middleware(AuthOriginCheckMiddleware) {}

export const AccountRecoveryHttpApi =
  HttpApi.make("AuthApi").add(AccountRecoveryGroup);
