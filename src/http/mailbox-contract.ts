import {
  AuthBadRequestError,
  AuthConflictError,
  AuthInternalError,
  AuthNotFoundError,
  AuthOriginCheckMiddleware,
  AuthPolicyDeniedError,
  AuthRequestRejectedError,
  AuthSchemaErrorMiddleware,
  AuthUnauthenticatedError,
} from "@effect-auth/core/HttpApi";
import * as Schema from "effect/Schema";
import {
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
} from "effect/unstable/httpapi";

import { CurrentRequestAuthMiddleware } from "../auth/session";
import {
  BootstrapOwnerMailboxCommand,
  RenameMailboxCommand,
} from "../mailboxes/administration";
import { MailboxId, MailboxRecordSchema } from "../mailboxes/core";

const MailboxParams = Schema.Struct({ mailboxId: MailboxId });
const MailboxErrors = [
  AuthBadRequestError,
  AuthUnauthenticatedError,
  AuthPolicyDeniedError,
  AuthRequestRejectedError,
  AuthNotFoundError,
  AuthConflictError,
  AuthInternalError,
] as const;

export const MailboxPublicErrorSchema = Schema.Union(MailboxErrors);
export type MailboxPublicError = Schema.Codec.Encoded<
  typeof MailboxPublicErrorSchema
>;

export const BootstrapOwnerEndpoint = HttpApiEndpoint.post(
  "bootstrapOwner",
  "/api/mailboxes/bootstrap-owner",
  {
    error: MailboxErrors,
    payload: BootstrapOwnerMailboxCommand,
    success: MailboxRecordSchema.pipe(HttpApiSchema.status(201)),
  }
);

export const RenameMailboxEndpoint = HttpApiEndpoint.patch(
  "rename",
  "/api/mailboxes/:mailboxId",
  {
    error: MailboxErrors,
    params: MailboxParams,
    payload: Schema.Struct({
      displayName: RenameMailboxCommand.fields.displayName,
    }),
    success: MailboxRecordSchema,
  }
);

export class MailboxGroup extends HttpApiGroup.make("mailboxes")
  .add(BootstrapOwnerEndpoint, RenameMailboxEndpoint)
  .middleware(AuthSchemaErrorMiddleware)
  .middleware(CurrentRequestAuthMiddleware)
  .middleware(AuthOriginCheckMiddleware) {}
