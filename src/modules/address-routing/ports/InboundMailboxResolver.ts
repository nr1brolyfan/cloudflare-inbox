/* oxlint-disable max-classes-per-file -- Rejection and resolver form one routing use case. */
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import type * as Effect from "effect/Effect";

import type { EmailAddress } from "#/modules/address-routing/domain/EmailAddress";
import type { MailboxId } from "#/modules/mailbox/domain/Mailbox";

export class InboundEmailRejected extends Data.TaggedError(
  "InboundEmailRejected"
)<{
  readonly reason:
    | "invalid-envelope"
    | "processing-unavailable"
    | "unknown-recipient";
  readonly message: string;
  readonly cause?: unknown;
}> {}

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
