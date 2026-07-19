/* oxlint-disable max-classes-per-file -- Message domain schemas are intentionally consolidated. */
import * as Schema from "effect/Schema";

import {
  AttachmentId,
  ByteSize,
  Cursor,
  EmailAddress,
  FileName,
  FolderId,
  LabelId,
  MailAddress,
  MailboxId,
  MessageDirection,
  MessageId,
  MessageSnippet,
  MessageSubject,
  MimeType,
  OutboundDeliveryId,
  PageSize,
  RfcMessageId,
  SearchQuery,
  ThreadId,
  UnixMillis,
  Version,
} from "./core";
import { OutboundDeliveryStatus } from "./outbound";

export class AttachmentMetadata extends Schema.Class<AttachmentMetadata>(
  "cloudflare-inbox/AttachmentMetadata"
)({
  id: AttachmentId,
  messageId: MessageId,
  fileName: FileName,
  mimeType: MimeType,
  size: ByteSize,
  contentId: Schema.optional(Schema.String),
  disposition: Schema.Literals(["attachment", "inline"]),
}) {}

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

const Count = Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)));

export class ThreadSummary extends Schema.Class<ThreadSummary>(
  "cloudflare-inbox/ThreadSummary"
)({
  id: ThreadId,
  mailboxId: MailboxId,
  subject: MessageSubject,
  participants: Schema.Array(MailAddress),
  messageCount: Count,
  unreadCount: Count,
  latestActivityAt: UnixMillis,
}) {}

export const ThreadSummarySchema = ThreadSummary.check(
  Schema.makeFilter((thread) => {
    if (thread.messageCount < 1) {
      return "a thread must contain at least one message";
    }
    return thread.unreadCount <= thread.messageCount
      ? undefined
      : "unreadCount cannot exceed messageCount";
  })
);

export class ThreadDetail extends Schema.Class<ThreadDetail>(
  "cloudflare-inbox/ThreadDetail"
)({
  thread: ThreadSummarySchema,
  messages: Schema.Array(MessageDetailSchema),
  nextCursor: Schema.optional(Cursor),
}) {}

export const ThreadDetailSchema = ThreadDetail.check(
  Schema.makeFilter((detail) => {
    if (detail.messages.length === 0) {
      return "a thread detail must contain at least one message";
    }
    if (detail.messages.length > detail.thread.messageCount) {
      return "the page cannot contain more messages than the thread";
    }
    if (
      detail.messages.filter((message) => !message.read).length >
      detail.thread.unreadCount
    ) {
      return "the page cannot contain more unread messages than the thread";
    }
    return detail.messages.every(
      (message) =>
        message.mailboxId === detail.thread.mailboxId &&
        message.threadId === detail.thread.id
    )
      ? undefined
      : "every message must belong to the containing thread and mailbox";
  })
);

/**
 * Opaque keyset cursor bound to the original mailbox, filters, query, and sort.
 * Missing limit means 50; the accepted range is 1..100.
 */
export const PageRequest = Schema.Struct({
  cursor: Schema.optional(Cursor),
  limit: Schema.optional(PageSize),
});
export type PageRequest = Schema.Schema.Type<typeof PageRequest>;

/** Time filtering is half-open: after is inclusive and before is exclusive. */
export const MessageFilters = Schema.Struct({
  folderId: Schema.optional(FolderId),
  // Multiple labels use AND semantics: every listed label must be present.
  labelIds: Schema.optional(Schema.Array(LabelId)),
  from: Schema.optional(EmailAddress),
  to: Schema.optional(EmailAddress),
  cc: Schema.optional(EmailAddress),
  after: Schema.optional(UnixMillis),
  before: Schema.optional(UnixMillis),
  read: Schema.optional(Schema.Boolean),
  starred: Schema.optional(Schema.Boolean),
  hasAttachment: Schema.optional(Schema.Boolean),
  direction: Schema.optional(MessageDirection),
  deliveryStatus: Schema.optional(OutboundDeliveryStatus),
  needsReply: Schema.optional(Schema.Boolean),
}).check(
  Schema.makeFilter((filters) =>
    filters.after === undefined ||
    filters.before === undefined ||
    filters.after < filters.before
      ? undefined
      : "after must be earlier than before"
  )
);
export type MessageFilters = Schema.Schema.Type<typeof MessageFilters>;

export const MessagePage = Schema.Struct({
  items: Schema.Array(MessageSummarySchema),
  nextCursor: Schema.optional(Cursor),
});
export type MessagePage = Schema.Schema.Type<typeof MessagePage>;

/** Lists by activityAt DESC, id DESC. */
export const ListMessagesInput = Schema.Struct({
  mailboxId: MailboxId,
  filters: Schema.optional(MessageFilters),
  page: Schema.optional(PageRequest),
});
export type ListMessagesInput = Schema.Schema.Type<typeof ListMessagesInput>;

/** Searches by FTS rank ASC, activityAt DESC, id DESC. */
export const SearchMessagesInput = Schema.Struct({
  mailboxId: MailboxId,
  query: SearchQuery,
  filters: Schema.optional(MessageFilters),
  page: Schema.optional(PageRequest),
});
export type SearchMessagesInput = Schema.Schema.Type<
  typeof SearchMessagesInput
>;

export const GetMessageInput = Schema.Struct({
  mailboxId: MailboxId,
  messageId: MessageId,
});
export type GetMessageInput = Schema.Schema.Type<typeof GetMessageInput>;

export const GetMessageResult = MessageDetailSchema;
export type GetMessageResult = Schema.Schema.Type<typeof GetMessageResult>;

/** Returns messages in chronological order: activityAt ASC, id ASC. */
export const GetThreadInput = Schema.Struct({
  mailboxId: MailboxId,
  threadId: ThreadId,
  page: Schema.optional(PageRequest),
});
export type GetThreadInput = Schema.Schema.Type<typeof GetThreadInput>;

export const GetThreadResult = ThreadDetailSchema;
export type GetThreadResult = Schema.Schema.Type<typeof GetThreadResult>;

export const SetMessageReadInput = Schema.Struct({
  mailboxId: MailboxId,
  messageId: MessageId,
  expectedVersion: Version,
  read: Schema.Boolean,
});
export type SetMessageReadInput = Schema.Schema.Type<
  typeof SetMessageReadInput
>;

export const SetMessageStarredInput = Schema.Struct({
  mailboxId: MailboxId,
  messageId: MessageId,
  expectedVersion: Version,
  starred: Schema.Boolean,
});
export type SetMessageStarredInput = Schema.Schema.Type<
  typeof SetMessageStarredInput
>;

export const MoveMessageInput = Schema.Struct({
  mailboxId: MailboxId,
  messageId: MessageId,
  expectedVersion: Version,
  folderId: FolderId,
});
export type MoveMessageInput = Schema.Schema.Type<typeof MoveMessageInput>;

export const AddMessageLabelInput = Schema.Struct({
  mailboxId: MailboxId,
  messageId: MessageId,
  expectedVersion: Version,
  labelId: LabelId,
});
export type AddMessageLabelInput = Schema.Schema.Type<
  typeof AddMessageLabelInput
>;

export const RemoveMessageLabelInput = AddMessageLabelInput;
export type RemoveMessageLabelInput = Schema.Schema.Type<
  typeof RemoveMessageLabelInput
>;

export const MessageMutationResult = MessageSummarySchema;
export type MessageMutationResult = Schema.Schema.Type<
  typeof MessageMutationResult
>;

export const RecipientList = Schema.Array(MailAddress);
export type RecipientList = Schema.Schema.Type<typeof RecipientList>;
