import * as Schema from "effect/Schema";

import { DraftSchema } from "./draft";
import {
  AttachmentId,
  DraftId,
  MailboxId,
  MessageId,
  OperationId,
  ThreadId,
} from "./identifiers";
import { MailAddress } from "./mail-address";
import { MessageSubject, Version } from "./primitives";

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

export const UpdateDraftInput = Schema.Struct({
  mailboxId: MailboxId,
  draftId: DraftId,
  expectedVersion: Version,
  content: DraftContent,
});
export type UpdateDraftInput = Schema.Schema.Type<typeof UpdateDraftInput>;

export const DraftResult = DraftSchema;
export type DraftResult = Schema.Schema.Type<typeof DraftResult>;
