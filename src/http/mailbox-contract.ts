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
import {
  InboundIngestId,
  MailboxId,
  MailboxRecordSchema,
} from "../mailboxes/core";
import {
  InboundProcessingResult,
  ReplayInboundInput,
} from "../mailboxes/inbound";
import { MailboxNavigationResult } from "../mailboxes/navigation";

const MailboxParams = Schema.Struct({ mailboxId: MailboxId });
const InboundReplayParams = Schema.Struct({
  mailboxId: MailboxId,
  inboundIngestId: InboundIngestId,
});
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

export const GetMailboxNavigationEndpoint = HttpApiEndpoint.get(
  "getNavigation",
  "/api/mailboxes/current/navigation",
  {
    error: MailboxErrors,
    success: MailboxNavigationResult,
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

export const ReplayInboundEndpoint = HttpApiEndpoint.post(
  "replayInbound",
  "/api/mailboxes/:mailboxId/inbound/:inboundIngestId/replay",
  {
    error: MailboxErrors,
    params: InboundReplayParams,
    payload: Schema.Struct({
      operationId: ReplayInboundInput.fields.operationId,
    }),
    success: InboundProcessingResult.pipe(HttpApiSchema.status(202)),
  }
);

export class MailboxGroup extends HttpApiGroup.make("mailboxes")
  .add(
    BootstrapOwnerEndpoint,
    GetMailboxNavigationEndpoint,
    RenameMailboxEndpoint,
    ReplayInboundEndpoint
  )
  .middleware(AuthSchemaErrorMiddleware)
  .middleware(CurrentRequestAuthMiddleware)
  .middleware(AuthOriginCheckMiddleware) {}
