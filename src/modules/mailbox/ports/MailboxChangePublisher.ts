import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type { MailboxChangeScopes } from "#/modules/mailbox/domain/MailboxRealtime";

export interface MailboxChangePublisherService {
  readonly publish: (scopes: MailboxChangeScopes) => Effect.Effect<void>;
}

export class MailboxChangePublisher extends Context.Service<
  MailboxChangePublisher,
  MailboxChangePublisherService
>()("cloudflare-inbox/MailboxChangePublisher") {}
