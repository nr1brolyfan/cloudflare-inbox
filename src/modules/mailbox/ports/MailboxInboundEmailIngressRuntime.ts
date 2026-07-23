import * as Context from "effect/Context";

export interface MailboxInboundEmailIngressRuntimeService {
  readonly now: () => number;
  readonly randomId: () => string;
}

export class MailboxInboundEmailIngressRuntime extends Context.Service<
  MailboxInboundEmailIngressRuntime,
  MailboxInboundEmailIngressRuntimeService
>()("cloudflare-inbox/InboundEmailIngressRuntime") {}
