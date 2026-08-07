/* oxlint-disable max-classes-per-file -- Message domain schemas are intentionally consolidated. */
import * as Schema from "effect/Schema";

import { EmailAddress } from "#/shared/EmailAddress";
import { MailAddress } from "#/shared/MailAddress";
import { OperationId } from "#/shared/Operation";
import { UnixMillis, Version } from "#/shared/Temporal";

import {
  AttachmentId,
  ByteSize,
  ContentId,
  Cursor,
  FileName,
  FolderId,
  InboundIngestId,
  LabelId,
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
} from "./Mailbox";
import { OutboundDeliveryStatus } from "./MailboxOutbound";

export class AttachmentMetadata extends Schema.Class<AttachmentMetadata>(
  "cloudflare-inbox/AttachmentMetadata"
)({
  id: AttachmentId,
  messageId: MessageId,
  fileName: FileName,
  mimeType: MimeType,
  size: ByteSize,
  contentId: Schema.optional(ContentId),
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
  threadMessageCount: Schema.optional(
    Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(1)))
  ),
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
  replyTo: Schema.optional(
    Schema.Array(MailAddress).pipe(Schema.check(Schema.isLengthBetween(1, 256)))
  ),
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
  groupByThread: Schema.optional(Schema.Boolean),
  page: Schema.optional(PageRequest),
});
export type ListMessagesInput = Schema.Schema.Type<typeof ListMessagesInput>;

/** Searches by FTS rank ASC, activityAt DESC, id DESC. */
export const SearchMessagesInput = Schema.Struct({
  mailboxId: MailboxId,
  query: SearchQuery,
  filters: Schema.optional(MessageFilters),
  groupByThread: Schema.optional(Schema.Boolean),
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

export const GetAttachmentBlobInput = Schema.Struct({
  attachmentId: AttachmentId,
  mailboxId: MailboxId,
  messageId: MessageId,
});
export type GetAttachmentBlobInput = Schema.Schema.Type<
  typeof GetAttachmentBlobInput
>;

/** Private storage locator returned only across the MailboxDO boundary. */
export const AttachmentBlobLocation = Schema.Struct({
  attachmentId: AttachmentId,
  contentId: ContentId,
  disposition: Schema.Literal("inline"),
  fileName: FileName,
  folderId: FolderId,
  inboundIngestId: InboundIngestId,
  mailboxId: MailboxId,
  messageId: MessageId,
  mimeType: MimeType,
  receivedAt: UnixMillis,
  size: ByteSize,
  sourceIndex: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
});
export type AttachmentBlobLocation = Schema.Schema.Type<
  typeof AttachmentBlobLocation
>;

/** Private ordinary inbound attachment locator returned only across MailboxDO RPC. */
export const InboundAttachmentBlobLocation = Schema.Struct({
  attachmentId: AttachmentId,
  contentId: Schema.optional(ContentId),
  disposition: Schema.Literal("attachment"),
  fileName: FileName,
  folderId: FolderId,
  inboundIngestId: InboundIngestId,
  mailboxId: MailboxId,
  messageId: MessageId,
  mimeType: MimeType,
  receivedAt: UnixMillis,
  size: ByteSize,
  sourceIndex: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
});
export type InboundAttachmentBlobLocation = Schema.Schema.Type<
  typeof InboundAttachmentBlobLocation
>;

/**
 * Returns messages in chronological order: activityAt ASC, id ASC.
 * Omitting page returns the latest 50; an explicit page traverses from oldest.
 */
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
  operationId: OperationId,
  messageId: MessageId,
  expectedVersion: Version,
  read: Schema.Boolean,
});
export type SetMessageReadInput = Schema.Schema.Type<
  typeof SetMessageReadInput
>;

export const SetThreadReadInput = Schema.Struct({
  mailboxId: MailboxId,
  operationId: OperationId,
  threadId: ThreadId,
});
export type SetThreadReadInput = Schema.Schema.Type<typeof SetThreadReadInput>;

export const ThreadReadMessageProjection = Schema.Struct({
  folderId: FolderId,
  id: MessageId,
  read: Schema.Boolean,
  starred: Schema.Boolean,
  version: Version,
});
export type ThreadReadMessageProjection = Schema.Schema.Type<
  typeof ThreadReadMessageProjection
>;

export const SetThreadReadResult = Schema.Struct({
  changed: Schema.Array(ThreadReadMessageProjection),
  operationId: OperationId,
  threadId: ThreadId,
});
export type SetThreadReadResult = Schema.Schema.Type<
  typeof SetThreadReadResult
>;

export const SetMessageStarredInput = Schema.Struct({
  mailboxId: MailboxId,
  operationId: OperationId,
  messageId: MessageId,
  expectedVersion: Version,
  starred: Schema.Boolean,
});
export type SetMessageStarredInput = Schema.Schema.Type<
  typeof SetMessageStarredInput
>;

export const MoveMessageInput = Schema.Struct({
  mailboxId: MailboxId,
  operationId: OperationId,
  messageId: MessageId,
  expectedVersion: Version,
  folderId: FolderId,
});
export type MoveMessageInput = Schema.Schema.Type<typeof MoveMessageInput>;

const BatchMessageMutationFields = {
  expectedVersion: Version,
  messageId: MessageId,
  operationId: OperationId,
};

export const BatchMessageMutationIntent = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("SetRead"),
    ...BatchMessageMutationFields,
    read: Schema.Boolean,
  }),
  Schema.Struct({
    _tag: Schema.Literal("SetStarred"),
    ...BatchMessageMutationFields,
    starred: Schema.Boolean,
  }),
  Schema.Struct({
    _tag: Schema.Literal("Archive"),
    ...BatchMessageMutationFields,
  }),
  Schema.Struct({
    _tag: Schema.Literal("Trash"),
    ...BatchMessageMutationFields,
  }),
]);
export type BatchMessageMutationIntent = Schema.Schema.Type<
  typeof BatchMessageMutationIntent
>;

export const BatchMessageMutation = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("Read"),
    ...BatchMessageMutationFields,
    read: Schema.Boolean,
  }),
  Schema.Struct({
    _tag: Schema.Literal("Starred"),
    ...BatchMessageMutationFields,
    starred: Schema.Boolean,
  }),
  Schema.Struct({
    _tag: Schema.Literal("Move"),
    ...BatchMessageMutationFields,
    folderId: FolderId,
    folderKind: Schema.Literals(["archive", "trash"]),
  }),
  Schema.Struct({
    _tag: Schema.Literal("Rejected"),
    messageId: MessageId,
    operationId: OperationId,
    reason: Schema.Literals(["forbidden", "not-found"]),
  }),
]);
export type BatchMessageMutation = Schema.Schema.Type<
  typeof BatchMessageMutation
>;

export const BatchMessageMutationsInput = Schema.Struct({
  batchOperationId: OperationId,
  intents: Schema.Array(BatchMessageMutationIntent).pipe(
    Schema.check(Schema.isLengthBetween(1, 100))
  ),
  mailboxId: MailboxId,
  mutations: Schema.Array(BatchMessageMutation).pipe(
    Schema.check(Schema.isLengthBetween(1, 100))
  ),
});
export type BatchMessageMutationsInput = Schema.Schema.Type<
  typeof BatchMessageMutationsInput
>;

export const AddMessageLabelInput = Schema.Struct({
  mailboxId: MailboxId,
  operationId: OperationId,
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

export const BatchMessageMutationResultItem = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("Succeeded"),
    messageId: MessageId,
    operationId: OperationId,
    value: MessageMutationResult,
  }),
  Schema.Struct({
    _tag: Schema.Literal("Failed"),
    messageId: MessageId,
    operationId: OperationId,
    reason: Schema.Literals([
      "conflict",
      "forbidden",
      "invalid-input",
      "not-found",
    ]),
  }),
]);
export type BatchMessageMutationResultItem = Schema.Schema.Type<
  typeof BatchMessageMutationResultItem
>;

export const BatchMessageMutationsResult = Schema.Struct({
  batchOperationId: OperationId,
  results: Schema.Array(BatchMessageMutationResultItem),
});
export type BatchMessageMutationsResult = Schema.Schema.Type<
  typeof BatchMessageMutationsResult
>;

export const RecipientList = Schema.Array(MailAddress);
export type RecipientList = Schema.Schema.Type<typeof RecipientList>;
