import * as Schema from "effect/Schema";

import {
  FolderId,
  LabelId,
  MailboxId,
  MessageId,
  ThreadId,
} from "./identifiers";
import { MailAddress } from "./mail-address";
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
