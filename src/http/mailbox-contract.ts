import {
  AuthBadRequestError,
  AuthConflictError,
  AuthInternalError,
  AuthNotFoundError,
  AuthOriginCheckMiddleware,
  AuthPolicyDeniedError,
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
import { MailboxRecord } from "../mailboxes/model";

export const MailboxDisplayNamePayloadSchema = Schema.Struct({
  displayName: Schema.String,
});

export const RenameMailboxInputSchema = Schema.Struct({
  displayName: Schema.String,
  mailboxId: Schema.String,
});

const MailboxParams = Schema.Struct({ mailboxId: Schema.String });
const MailboxErrors = [
  AuthBadRequestError,
  AuthUnauthenticatedError,
  AuthPolicyDeniedError,
  AuthNotFoundError,
  AuthConflictError,
  AuthInternalError,
] as const;

export const BootstrapOwnerEndpoint = HttpApiEndpoint.post(
  "bootstrapOwner",
  "/api/mailboxes/bootstrap-owner",
  {
    error: MailboxErrors,
    payload: MailboxDisplayNamePayloadSchema,
    success: MailboxRecord.pipe(HttpApiSchema.status(201)),
  }
);

export const RenameMailboxEndpoint = HttpApiEndpoint.patch(
  "rename",
  "/api/mailboxes/:mailboxId",
  {
    error: MailboxErrors,
    params: MailboxParams,
    payload: MailboxDisplayNamePayloadSchema,
    success: MailboxRecord,
  }
);

export class MailboxGroup extends HttpApiGroup.make("mailboxes")
  .add(BootstrapOwnerEndpoint, RenameMailboxEndpoint)
  .middleware(AuthSchemaErrorMiddleware)
  .middleware(CurrentRequestAuthMiddleware)
  .middleware(AuthOriginCheckMiddleware) {}
