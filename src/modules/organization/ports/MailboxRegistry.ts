import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type { MailboxId } from "#/modules/mailbox/domain/Mailbox";

export interface MailboxRegistryService {
  readonly exists: (mailboxId: MailboxId) => Effect.Effect<boolean, unknown>;
}

/** Active mailbox existence required before a data-plane object is addressed. */
export class MailboxRegistry extends Context.Service<
  MailboxRegistry,
  MailboxRegistryService
>()("cloudflare-inbox/MailboxRegistry") {}
