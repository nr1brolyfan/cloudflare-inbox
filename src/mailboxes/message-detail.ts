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
  acceptedAt: Schema.optional(UnixMillis),
  attachments: Schema.Array(AttachmentMetadata),
}) {}

export const MessageDetailSchema = MessageDetail.check(
  Schema.makeFilter((message) => {
    const hasDeliveryId = message.outboundDeliveryId !== undefined;
    const hasDeliveryStatus = message.deliveryStatus !== undefined;
    const hasDelivery = hasDeliveryId && hasDeliveryStatus;
    const hasAnyDelivery = hasDeliveryId || hasDeliveryStatus;
    if (message.direction === "outbound" ? !hasDelivery : hasAnyDelivery) {
      return "delivery fields must be present exactly for outbound messages";
    }
    if (message.direction === "inbound") {
      if (
        message.receivedAt === undefined ||
        message.scheduledAt !== undefined ||
        message.acceptedAt !== undefined
      ) {
        return "inbound messages require only receivedAt lifecycle metadata";
      }
    } else {
      const accepted =
        message.deliveryStatus === "accepted" ||
        message.deliveryStatus === "delivered" ||
        message.deliveryStatus === "bounced";
      if (
        message.receivedAt !== undefined ||
        message.scheduledAt === undefined ||
        accepted !== (message.acceptedAt !== undefined) ||
        (message.acceptedAt !== undefined &&
          message.acceptedAt < message.scheduledAt)
      ) {
        return "outbound lifecycle metadata must match its delivery status";
      }
    }
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
