import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { AiRuleEvaluatorUnavailableLayer } from "#/modules/automation/adapters/ai/AiRuleEvaluatorUnavailable";
import { AiRuleEvaluator } from "#/modules/automation/ports/AiRuleEvaluator";
import { AsyncRuleWorkflowParams } from "#/modules/automation/ports/AsyncRuleWorkflowStarter";

const evaluationTaskConfig = {
  retries: { limit: 5, delay: "30 seconds", backoff: "exponential" },
  timeout: "5 minutes",
} as const;

/** Application graph built separately for each Workflow instance. */
export const AsyncRuleWorkflowApplicationLayer =
  AiRuleEvaluatorUnavailableLayer;

export const asyncRuleWorkflowProgram = Effect.succeed((input: unknown) =>
  Effect.gen(function* () {
    const params = yield* Schema.decodeUnknownEffect(AsyncRuleWorkflowParams)(
      input
    ).pipe(Effect.orDie);
    const event = yield* Cloudflare.Workflows.WorkflowEvent;
    if (event.instanceId !== params.jobId) {
      return yield* Effect.die(
        new Error("Async rule Workflow instance ID does not match its job ID")
      );
    }
    yield* Cloudflare.Workflows.task(
      "evaluate-ai-rules-v1",
      AiRuleEvaluator.pipe(
        Effect.flatMap((evaluator) => evaluator.evaluate(params)),
        Effect.orDie
      ),
      evaluationTaskConfig
    );
  })
);

const asyncRuleWorkflowImplementation = Effect.gen(function* () {
  const program = yield* asyncRuleWorkflowProgram;
  return (input: unknown) =>
    program(input).pipe(Effect.provide(AsyncRuleWorkflowApplicationLayer));
});

export default class AsyncRuleWorkflow extends Cloudflare.Workflow<AsyncRuleWorkflow>()(
  "AsyncRuleWorkflow",
  asyncRuleWorkflowImplementation
) {}
