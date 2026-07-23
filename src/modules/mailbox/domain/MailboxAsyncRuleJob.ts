/* oxlint-disable max-classes-per-file -- Persisted async rule job contracts form one mailbox domain topic. */
import * as Schema from "effect/Schema";

import {
  AsyncRuleJobId,
  InboundIngestId,
  MailboxId,
  MessageId,
  RuleId,
  UnixMillis,
  Version,
} from "./Mailbox";
import { AiRuleInstruction, RuleActions } from "./MailboxRule";

export const AsyncRuleCandidate = Schema.Struct({
  ruleId: RuleId,
  ruleVersion: Version,
  instruction: AiRuleInstruction,
  actions: RuleActions,
});
export type AsyncRuleCandidate = Schema.Schema.Type<typeof AsyncRuleCandidate>;

export const AsyncRulePlanV1 = Schema.Struct({
  formatVersion: Schema.Literal(1),
  baseMessageVersion: Version,
  candidates: Schema.Array(AsyncRuleCandidate),
}).check(
  Schema.makeFilter((plan) =>
    plan.candidates.length > 0
      ? undefined
      : "an async rule plan must contain at least one candidate"
  )
);
export type AsyncRulePlanV1 = Schema.Schema.Type<typeof AsyncRulePlanV1>;

export const AsyncRuleJobStatus = Schema.Literals([
  "pending",
  "running",
  "completed",
  "failed",
]);
export type AsyncRuleJobStatus = Schema.Schema.Type<typeof AsyncRuleJobStatus>;

export class AsyncRuleJob extends Schema.Class<AsyncRuleJob>(
  "cloudflare-inbox/AsyncRuleJob"
)({
  id: AsyncRuleJobId,
  inboundIngestId: InboundIngestId,
  mailboxId: MailboxId,
  messageId: MessageId,
  plan: AsyncRulePlanV1,
  status: AsyncRuleJobStatus,
  createdAt: UnixMillis,
  updatedAt: UnixMillis,
  version: Version,
}) {}
