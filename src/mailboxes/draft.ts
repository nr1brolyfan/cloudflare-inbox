import * as Schema from "effect/Schema";

import {
  AttachmentId,
  DraftId,
  MailboxId,
  MessageId,
  ThreadId,
} from "./identifiers";
import { MailAddress } from "./mail-address";
import { MessageSubject, UnixMillis, Version } from "./primitives";

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
