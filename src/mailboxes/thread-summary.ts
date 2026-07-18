import * as Schema from "effect/Schema";

import { MailboxId, ThreadId } from "./identifiers";
import { MailAddress } from "./mail-address";
import { MessageSubject, UnixMillis } from "./primitives";

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
