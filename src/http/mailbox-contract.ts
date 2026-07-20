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
  Cursor,
  FolderId,
  InboundIngestId,
  LabelId,
  MailboxId,
  MailboxRecordSchema,
  MessageId,
  SearchQuery,
  ThreadId,
} from "../mailboxes/core";
import {
  InboundProcessingResult,
  ReplayInboundInput,
} from "../mailboxes/inbound";
import {
  MailboxMessageListResult,
  MailboxThreadResult,
} from "../mailboxes/message-reading";
import { MailboxNavigationResult } from "../mailboxes/navigation";

const MailboxParams = Schema.Struct({ mailboxId: MailboxId });
const InboundReplayParams = Schema.Struct({
  mailboxId: MailboxId,
  inboundIngestId: InboundIngestId,
});
const MailboxThreadParams = Schema.Struct({
  mailboxId: MailboxId,
  threadId: ThreadId,
});
export const MailboxMessageViewQuery = Schema.Struct({
  attachment: Schema.optional(Schema.Literals(["true", "false"])),
  cursor: Schema.optional(Cursor),
  folder: Schema.optional(FolderId),
  label: Schema.optional(LabelId),
  q: Schema.optional(SearchQuery),
  read: Schema.optional(Schema.Literals(["true", "false"])),
  starred: Schema.optional(Schema.Literals(["true", "false"])),
}).check(
  Schema.makeFilter((query) =>
    (query.folder === undefined) === (query.label === undefined)
      ? "exactly one folder or label is required"
      : undefined
  )
);
export const MailboxThreadViewQuery = Schema.Struct({
  folder: Schema.optional(FolderId),
  label: Schema.optional(LabelId),
  message: MessageId,
}).check(
  Schema.makeFilter((query) =>
    (query.folder === undefined) === (query.label === undefined)
      ? "exactly one folder or label is required"
      : undefined
  )
);
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

export const ListMailboxMessagesEndpoint = HttpApiEndpoint.get(
  "listMessages",
  "/api/mailboxes/:mailboxId/messages",
  {
    error: MailboxErrors,
    params: MailboxParams,
    query: MailboxMessageViewQuery,
    success: MailboxMessageListResult,
  }
);

export const GetMailboxThreadEndpoint = HttpApiEndpoint.get(
  "getThread",
  "/api/mailboxes/:mailboxId/threads/:threadId",
  {
    error: MailboxErrors,
    params: MailboxThreadParams,
    query: MailboxThreadViewQuery,
    success: MailboxThreadResult,
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
    GetMailboxThreadEndpoint,
    GetMailboxNavigationEndpoint,
    ListMailboxMessagesEndpoint,
    RenameMailboxEndpoint,
    ReplayInboundEndpoint
  )
  .middleware(AuthSchemaErrorMiddleware)
  .middleware(CurrentRequestAuthMiddleware)
  .middleware(AuthOriginCheckMiddleware) {}
