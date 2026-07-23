import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type { InboundWorkflowParams } from "#/modules/mailbox/domain/MailboxInbound";
import type { WorkflowStartError } from "#/modules/mailbox/ports/MailboxWorkflowStarter";

export interface InboundWorkflowStarterService {
  readonly start: (
    params: InboundWorkflowParams
  ) => Effect.Effect<void, WorkflowStartError>;
}

/** Starts the durable processor using the ingest ID as its instance identity. */
export class InboundWorkflowStarter extends Context.Service<
  InboundWorkflowStarter,
  InboundWorkflowStarterService
>()("cloudflare-inbox/InboundWorkflowStarter") {}
