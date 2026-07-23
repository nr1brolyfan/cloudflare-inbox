import * as Layer from "effect/Layer";

import { MailboxInboundEmailIngressRuntime } from "#/modules/mailbox/ports/MailboxInboundEmailIngressRuntime";

export const MailboxInboundEmailIngressRuntimeSystemLayer = Layer.succeed(
  MailboxInboundEmailIngressRuntime,
  MailboxInboundEmailIngressRuntime.of({
    now: Date.now,
    randomId: () => crypto.randomUUID(),
  })
);
