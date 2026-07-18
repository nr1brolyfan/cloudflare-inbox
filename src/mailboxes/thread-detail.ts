import * as Schema from "effect/Schema";

import { Cursor } from "./identifiers";
import { MessageDetailSchema } from "./message-detail";
import { ThreadSummarySchema } from "./thread-summary";

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
