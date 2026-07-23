import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type {
  MailboxResourceLookup,
  MailboxResourceLookupResult,
} from "#/modules/mailbox/domain/MailboxResource";

export interface TrustedMailResourceTransportService {
  readonly resolve: (
    resource: MailboxResourceLookup
  ) => Effect.Effect<MailboxResourceLookupResult, unknown>;
}

/** Consumer-owned transport capability for trusted mailbox ancestry reads. */
export class TrustedMailResourceTransport extends Context.Service<
  TrustedMailResourceTransport,
  TrustedMailResourceTransportService
>()("cloudflare-inbox/TrustedMailResourceTransport") {}
