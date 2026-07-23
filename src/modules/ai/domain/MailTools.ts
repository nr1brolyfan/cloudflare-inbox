/* oxlint-disable max-classes-per-file -- The four static mail tool contracts are intentionally colocated. */
import * as Schema from "effect/Schema";

import {
  Cursor,
  DraftId,
  FolderId,
  LabelId,
  MessageDirection,
  MessageId,
  MessageSubject,
  PageSize,
  SearchQuery,
  ThreadId,
  Version,
} from "#/modules/mailbox/domain/Mailbox";
import { EmailAddress } from "#/shared/EmailAddress";
import { UnixMillis } from "#/shared/Temporal";

export const mailSearchDefaultLimit = Schema.decodeUnknownSync(PageSize)(10);
export const mailSearchMaxResults = 10;
export const mailThreadMaxMessages = 5;
export const mailPlainTextMaxLength = 2000;

const AiDisplayName = Schema.String.pipe(Schema.check(Schema.isMaxLength(100)));
const AiSubject = Schema.String.pipe(Schema.check(Schema.isMaxLength(300)));
const AiDraftSubject = MessageSubject.pipe(
  Schema.check(Schema.isMaxLength(300))
);
const AiSnippet = Schema.String.pipe(Schema.check(Schema.isMaxLength(300)));
const AiPlainText = Schema.String.pipe(
  Schema.check(Schema.isMaxLength(mailPlainTextMaxLength))
);
const AiAddress = Schema.Struct({
  address: EmailAddress,
  displayName: Schema.optional(AiDisplayName),
});
const AiAddressList = Schema.Array(AiAddress).pipe(
  Schema.check(Schema.isMaxLength(3))
);
const SearchLimit = PageSize.pipe(
  Schema.check(Schema.isLessThanOrEqualTo(mailSearchMaxResults))
);

const MailToolView = Schema.Union([
  Schema.Struct({
    folderId: FolderId.annotate({
      description: "Folder containing the message or search results",
    }),
  }),
  Schema.Struct({
    labelId: LabelId.annotate({
      description: "Label containing the message or search results",
    }),
  }),
]).annotate({
  description: "Exactly one authorized folder or label view",
});

export const MailReadArguments = Schema.Struct({
  messageId: MessageId.annotate({ description: "Message to read" }),
  view: MailToolView,
}).annotate({
  description: "Read one message from a folder or label view",
});
export type MailReadArguments = Schema.Schema.Type<typeof MailReadArguments>;

export const MailSearchArguments = Schema.Struct({
  cursor: Schema.optional(
    Cursor.annotate({ description: "Opaque cursor from a prior search" })
  ),
  hasAttachment: Schema.optional(Schema.Boolean),
  limit: Schema.optional(SearchLimit),
  query: SearchQuery.annotate({ description: "Mailbox search query" }),
  read: Schema.optional(Schema.Boolean),
  starred: Schema.optional(Schema.Boolean),
  view: MailToolView,
}).annotate({
  description: "Search for messages within one folder or label view",
});
export type MailSearchArguments = Schema.Schema.Type<
  typeof MailSearchArguments
>;

export const MailThreadArguments = Schema.Struct({
  anchorMessageId: MessageId.annotate({
    description: "Authorized message anchoring the requested thread and view",
  }),
  threadId: ThreadId.annotate({ description: "Thread to read" }),
  view: MailToolView,
}).annotate({
  description:
    "Read a thread using a message from the selected view as its anchor",
});
export type MailThreadArguments = Schema.Schema.Type<
  typeof MailThreadArguments
>;

export const MailCreateDraftArguments = Schema.Struct({
  bcc: AiAddressList,
  cc: AiAddressList,
  plainText: Schema.optional(AiPlainText),
  subject: AiDraftSubject,
  to: AiAddressList,
}).annotate({
  description: "Create a bounded plain-text draft in the authorized mailbox",
});
export type MailCreateDraftArguments = Schema.Schema.Type<
  typeof MailCreateDraftArguments
>;

const AiSearchItem = Schema.Struct({
  activityAt: UnixMillis,
  direction: MessageDirection,
  id: MessageId,
  recipients: AiAddressList,
  sender: Schema.optional(AiAddress),
  snippet: AiSnippet,
  subject: AiSubject,
  threadId: ThreadId,
});

export const MailSearchSuccess = Schema.Struct({
  items: Schema.Array(AiSearchItem).pipe(
    Schema.check(Schema.isMaxLength(mailSearchMaxResults))
  ),
  nextCursor: Schema.optional(Cursor),
});
export type MailSearchSuccess = Schema.Schema.Type<typeof MailSearchSuccess>;

const AiMessageContent = Schema.Struct({
  activityAt: UnixMillis,
  cc: AiAddressList,
  direction: MessageDirection,
  hasAttachments: Schema.Boolean,
  id: MessageId,
  plainText: Schema.optional(AiPlainText),
  sender: Schema.optional(AiAddress),
  textTruncated: Schema.Boolean,
  to: AiAddressList,
});

export const MailReadSuccess = Schema.Struct({
  message: Schema.Struct({
    ...AiMessageContent.fields,
    subject: AiSubject,
    threadId: ThreadId,
  }),
});
export type MailReadSuccess = Schema.Schema.Type<typeof MailReadSuccess>;

export const MailThreadSuccess = Schema.Struct({
  hasMore: Schema.Boolean,
  messages: Schema.Array(AiMessageContent).pipe(
    Schema.check(Schema.isMaxLength(mailThreadMaxMessages))
  ),
  thread: Schema.Struct({
    id: ThreadId,
    latestActivityAt: UnixMillis,
    messageCount: Schema.Int.pipe(
      Schema.check(Schema.isGreaterThanOrEqualTo(1))
    ),
    subject: AiSubject,
    unreadCount: Schema.Int.pipe(
      Schema.check(Schema.isGreaterThanOrEqualTo(0))
    ),
  }),
});
export type MailThreadSuccess = Schema.Schema.Type<typeof MailThreadSuccess>;

export const MailCreateDraftSuccess = Schema.Struct({
  draftId: DraftId,
  version: Version,
});
export type MailCreateDraftSuccess = Schema.Schema.Type<
  typeof MailCreateDraftSuccess
>;

export const MailCreateDraftTool = {
  arguments: MailCreateDraftArguments,
  description:
    "Create a bounded plain-text draft without scheduling or delivering it.",
  name: "mail_create_draft",
  success: MailCreateDraftSuccess,
} as const;

export const MailReadTool = {
  arguments: MailReadArguments,
  description: "Read the safe plain-text projection of one authorized message.",
  name: "mail_read",
  success: MailReadSuccess,
} as const;

export const MailSearchTool = {
  arguments: MailSearchArguments,
  description:
    "Search one authorized mailbox view and return safe message summaries.",
  name: "mail_search",
  success: MailSearchSuccess,
} as const;

export const MailThreadTool = {
  arguments: MailThreadArguments,
  description:
    "Read a bounded safe plain-text projection of an anchored thread.",
  name: "mail_thread",
  success: MailThreadSuccess,
} as const;
