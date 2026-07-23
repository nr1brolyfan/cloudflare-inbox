import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type { MailboxId } from "#/modules/mailbox/domain/Mailbox";
import type { InboundEmailRejected } from "#/modules/mailbox/ports/InboundEmailIngress";
import type { EmailAddress } from "#/shared/EmailAddress";

export interface InboundMailboxResolverService {
  readonly resolve: (
    recipient: EmailAddress
  ) => Effect.Effect<MailboxId, InboundEmailRejected>;
}

/** Resolves a validated SMTP envelope recipient before selecting a MailboxDO. */
export class InboundMailboxResolver extends Context.Service<
  InboundMailboxResolver,
  InboundMailboxResolverService
>()("cloudflare-inbox/InboundMailboxResolver") {}
