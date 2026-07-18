import * as Schema from "effect/Schema";

import {
  FolderId,
  LabelId,
  MailboxId,
  MessageId,
  OutboundDeliveryId,
  ThreadId,
} from "./identifiers";
import { MailAddress } from "./mail-address";
import { OutboundDeliveryStatus } from "./outbound-delivery-status";
import {
  ByteSize,
  MessageDirection,
  MessageSnippet,
  MessageSubject,
  UnixMillis,
  Version,
} from "./primitives";

export class MessageSummary extends Schema.Class<MessageSummary>(
  "cloudflare-inbox/MessageSummary"
)({
  id: MessageId,
  mailboxId: MailboxId,
  folderId: FolderId,
  threadId: ThreadId,
  direction: MessageDirection,
  outboundDeliveryId: Schema.optional(OutboundDeliveryId),
  deliveryStatus: Schema.optional(OutboundDeliveryStatus),
  subject: MessageSubject,
  sender: Schema.optional(MailAddress),
  recipients: Schema.Array(MailAddress),
  snippet: MessageSnippet,
  activityAt: UnixMillis,
  read: Schema.Boolean,
  starred: Schema.Boolean,
  hasAttachments: Schema.Boolean,
  labelIds: Schema.Array(LabelId),
  size: ByteSize,
  version: Version,
}) {}

export const MessageSummarySchema = MessageSummary.check(
  Schema.makeFilter((message) => {
    const hasDeliveryId = message.outboundDeliveryId !== undefined;
    const hasDeliveryStatus = message.deliveryStatus !== undefined;
    const hasDelivery = hasDeliveryId && hasDeliveryStatus;
    const hasAnyDelivery = hasDeliveryId || hasDeliveryStatus;
    const validDelivery =
      message.direction === "outbound" ? hasDelivery : !hasAnyDelivery;
    return validDelivery
      ? undefined
      : "delivery fields must be present exactly for outbound messages";
  })
);
