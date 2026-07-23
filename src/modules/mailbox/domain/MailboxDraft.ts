/* oxlint-disable max-classes-per-file -- Draft detail and list projections share one domain contract. */
import * as Schema from "effect/Schema";

import { MailAddress } from "#/shared/MailAddress";
import { OperationId } from "#/shared/Operation";
import { UnixMillis, Version } from "#/shared/Temporal";

import {
  AttachmentId,
  Cursor,
  DraftId,
  MailboxId,
  MessageId,
  MessageSnippet,
  MessageSubject,
  PageSize,
  ThreadId,
} from "./Mailbox";

export class Draft extends Schema.Class<Draft>("cloudflare-inbox/Draft")({
  id: DraftId,
  mailboxId: MailboxId,
  threadId: Schema.optional(ThreadId),
  inReplyToMessageId: Schema.optional(MessageId),
  to: Schema.Array(MailAddress),
  cc: Schema.Array(MailAddress),
  bcc: Schema.Array(MailAddress),
  subject: MessageSubject,
  textBody: Schema.optional(Schema.String),
  htmlBody: Schema.optional(Schema.String),
  attachmentIds: Schema.Array(AttachmentId),
  createdAt: UnixMillis,
  updatedAt: UnixMillis,
  version: Version,
}) {}

export const DraftSchema = Draft.check(
  Schema.makeFilter((draft) =>
    draft.updatedAt >= draft.createdAt
      ? undefined
      : "updatedAt cannot be earlier than createdAt"
  )
);

export const DraftContent = Schema.Struct({
  threadId: Schema.optional(ThreadId),
  inReplyToMessageId: Schema.optional(MessageId),
  to: Schema.Array(MailAddress),
  cc: Schema.Array(MailAddress),
  bcc: Schema.Array(MailAddress),
  subject: MessageSubject,
  textBody: Schema.optional(Schema.String),
  htmlBody: Schema.optional(Schema.String),
  attachmentIds: Schema.Array(AttachmentId),
});
export type DraftContent = Schema.Schema.Type<typeof DraftContent>;

export const CreateDraftInput = Schema.Struct({
  mailboxId: MailboxId,
  operationId: OperationId,
  content: DraftContent,
});
export type CreateDraftInput = Schema.Schema.Type<typeof CreateDraftInput>;

export const GetDraftInput = Schema.Struct({
  mailboxId: MailboxId,
  draftId: DraftId,
});
export type GetDraftInput = Schema.Schema.Type<typeof GetDraftInput>;

export const ListDraftsInput = Schema.Struct({
  mailboxId: MailboxId,
  page: Schema.optional(
    Schema.Struct({
      cursor: Schema.optional(Cursor),
      limit: Schema.optional(PageSize),
    })
  ),
});
export type ListDraftsInput = Schema.Schema.Type<typeof ListDraftsInput>;

const DraftRecipientPreview = Schema.Array(MailAddress).check(
  Schema.makeFilter((recipients) =>
    recipients.length <= 3
      ? undefined
      : "at most 3 recipient previews are allowed"
  )
);

export class DraftSummary extends Schema.Class<DraftSummary>(
  "cloudflare-inbox/DraftSummary"
)({
  id: DraftId,
  mailboxId: MailboxId,
  recipients: DraftRecipientPreview,
  subject: MessageSubject,
  snippet: MessageSnippet,
  hasAttachments: Schema.Boolean,
  updatedAt: UnixMillis,
  version: Version,
}) {}

export const DraftPage = Schema.Struct({
  items: Schema.Array(DraftSummary),
  nextCursor: Schema.optional(Cursor),
});
export type DraftPage = Schema.Schema.Type<typeof DraftPage>;

export const UpdateDraftInput = Schema.Struct({
  mailboxId: MailboxId,
  operationId: OperationId,
  draftId: DraftId,
  expectedVersion: Version,
  content: DraftContent,
});
export type UpdateDraftInput = Schema.Schema.Type<typeof UpdateDraftInput>;

export const DraftResult = DraftSchema;
export type DraftResult = Schema.Schema.Type<typeof DraftResult>;
