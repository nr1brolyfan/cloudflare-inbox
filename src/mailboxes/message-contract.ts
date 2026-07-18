import * as Schema from "effect/Schema";

import {
  Cursor,
  FolderId,
  LabelId,
  MailboxId,
  MessageId,
  ThreadId,
} from "./identifiers";
import { MailAddress } from "./mail-address";
import { MessageDetailSchema } from "./message-detail";
import { MessageSummarySchema } from "./message-summary";
import { OutboundDeliveryStatus } from "./outbound-delivery-status";
import {
  EmailAddress,
  MessageDirection,
  PageSize,
  SearchQuery,
  UnixMillis,
  Version,
} from "./primitives";
import { ThreadDetailSchema } from "./thread-detail";

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
