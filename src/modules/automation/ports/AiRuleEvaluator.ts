/* oxlint-disable max-classes-per-file -- The evaluator port and its typed error form one contract. */
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import type * as Effect from "effect/Effect";

import type { AsyncRuleWorkflowParams } from "./AsyncRuleWorkflowStarter";

export class AiRuleEvaluatorError extends Data.TaggedError(
  "AiRuleEvaluatorError"
)<{
  readonly message: string;
  readonly cause?: unknown;
  readonly retryable: boolean;
}> {}

export interface AiRuleEvaluatorService {
  readonly evaluate: (
    params: AsyncRuleWorkflowParams
  ) => Effect.Effect<void, AiRuleEvaluatorError>;
}

export class AiRuleEvaluator extends Context.Service<
  AiRuleEvaluator,
  AiRuleEvaluatorService
>()("cloudflare-inbox/AiRuleEvaluator") {}
