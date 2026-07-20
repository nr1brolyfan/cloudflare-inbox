/* oxlint-disable max-classes-per-file -- Async rule contracts are intentionally consolidated. */
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import {
  AsyncRuleJobId,
  InboundIngestId,
  MailboxId,
  MessageId,
  RuleId,
  UnixMillis,
  Version,
} from "./core";
import type { WorkflowStartError } from "./errors";
import { AiRuleInstruction, RuleActions } from "./rules";

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

export const AsyncRuleWorkflowParams = Schema.Struct({
  formatVersion: Schema.Literal(1),
  jobId: AsyncRuleJobId,
  mailboxId: MailboxId,
});
export type AsyncRuleWorkflowParams = Schema.Schema.Type<
  typeof AsyncRuleWorkflowParams
>;

export interface AsyncRuleWorkflowStarter {
  readonly start: (
    params: AsyncRuleWorkflowParams
  ) => Effect.Effect<void, WorkflowStartError>;
}

export const AsyncRuleWorkflowStarter =
  Context.Service<AsyncRuleWorkflowStarter>(
    "cloudflare-inbox/AsyncRuleWorkflowStarter"
  );

export class AiRuleEvaluatorError extends Data.TaggedError(
  "AiRuleEvaluatorError"
)<{
  readonly message: string;
  readonly cause?: unknown;
  readonly retryable: boolean;
}> {}

export interface AiRuleEvaluator {
  readonly evaluate: (
    params: AsyncRuleWorkflowParams
  ) => Effect.Effect<void, AiRuleEvaluatorError>;
}

export const AiRuleEvaluator = Context.Service<AiRuleEvaluator>(
  "cloudflare-inbox/AiRuleEvaluator"
);

/** Stage 10 replaces this explicit unavailable adapter with Workers AI. */
export const AiRuleEvaluatorUnavailableLive = Layer.succeed(
  AiRuleEvaluator,
  AiRuleEvaluator.of({
    evaluate: () =>
      Effect.fail(
        new AiRuleEvaluatorError({
          message: "AI rule evaluation is not configured",
          retryable: true,
        })
      ),
  })
);
