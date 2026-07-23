import * as Context from "effect/Context";

import type { MailboxId } from "#/modules/mailbox/domain/Mailbox";

export interface MailboxIdentity {
  readonly mailboxId: MailboxId;
}

/** Canonical identity of the addressed mailbox runtime. */
export const MailboxIdentity = Context.Service<MailboxIdentity>(
  "cloudflare-inbox/MailboxIdentity"
);
