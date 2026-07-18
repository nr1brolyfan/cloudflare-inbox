import * as Schema from "effect/Schema";

import { AttachmentMetadata } from "./attachment-metadata";
import { RfcMessageId } from "./identifiers";
import { MailAddress } from "./mail-address";
import { MessageSummary } from "./message-summary";
import { UnixMillis } from "./primitives";

export class MessageDetail extends MessageSummary.extend<MessageDetail>(
  "cloudflare-inbox/MessageDetail"
)({
  rfcMessageId: Schema.optional(RfcMessageId),
  inReplyTo: Schema.optional(RfcMessageId),
  references: Schema.Array(RfcMessageId),
  to: Schema.Array(MailAddress),
  cc: Schema.Array(MailAddress),
  bcc: Schema.Array(MailAddress),
  textBody: Schema.optional(Schema.String),
  htmlBody: Schema.optional(Schema.String),
  headerDate: Schema.optional(UnixMillis),
  receivedAt: Schema.optional(UnixMillis),
  scheduledAt: Schema.optional(UnixMillis),
  sentAt: Schema.optional(UnixMillis),
  attachments: Schema.Array(AttachmentMetadata),
}) {}

export const MessageDetailSchema = MessageDetail.check(
  Schema.makeFilter((message) => {
    if (message.hasAttachments !== message.attachments.length > 0) {
      return "hasAttachments must match the attachment list";
    }
    return message.attachments.every(
      (attachment) => attachment.messageId === message.id
    )
      ? undefined
      : "every attachment must belong to the containing message";
  })
);
