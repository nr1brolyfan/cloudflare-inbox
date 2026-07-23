import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { AsyncRuleJobId, MailboxId } from "#/modules/mailbox/domain/Mailbox";
import type { WorkflowStartError } from "#/modules/mailbox/ports/MailboxWorkflowStarter";

export const AsyncRuleWorkflowParams = Schema.Struct({
  formatVersion: Schema.Literal(1),
  jobId: AsyncRuleJobId,
  mailboxId: MailboxId,
});
export type AsyncRuleWorkflowParams = Schema.Schema.Type<
  typeof AsyncRuleWorkflowParams
>;

export interface AsyncRuleWorkflowStarterService {
  readonly start: (
    params: AsyncRuleWorkflowParams
  ) => Effect.Effect<void, WorkflowStartError>;
}

export class AsyncRuleWorkflowStarter extends Context.Service<
  AsyncRuleWorkflowStarter,
  AsyncRuleWorkflowStarterService
>()("cloudflare-inbox/AsyncRuleWorkflowStarter") {}
