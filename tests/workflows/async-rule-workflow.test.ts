import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  AiRuleEvaluator,
  AsyncRuleWorkflowParams,
} from "#/mailboxes/async-rules";
import { asyncRuleWorkflowProgram } from "#/workflows/async-rule-workflow";

const params = Schema.decodeUnknownSync(AsyncRuleWorkflowParams)({
  formatVersion: 1,
  jobId: "job-1",
  mailboxId: "primary",
});

const run = (instanceId: string, evaluations: unknown[], configs: unknown[]) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const program = yield* asyncRuleWorkflowProgram;
      return yield* program(params);
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(
            AiRuleEvaluator,
            AiRuleEvaluator.of({
              evaluate: (input) => {
                evaluations.push(input);
                return Effect.void;
              },
            })
          ),
          Layer.succeed(
            Cloudflare.Workflows.WorkflowEvent,
            Cloudflare.Workflows.WorkflowEvent.of({
              instanceId,
              payload: params,
              timestamp: new Date(0),
              workflowName: "AsyncRuleWorkflow",
            })
          ),
          Layer.succeed(
            Cloudflare.Workflows.WorkflowStep,
            Cloudflare.Workflows.WorkflowStep.of({
              do: (options) => {
                configs.push({
                  name: options.name,
                  retries: options.retries,
                  timeout: options.timeout,
                });
                return options.effect as Effect.Effect<
                  Effect.Success<typeof options.effect>
                >;
              },
              sleep: () => Effect.void,
              sleepUntil: () => Effect.void,
              waitForEvent: () => Effect.die("waitForEvent must not run"),
            })
          )
        )
      )
    )
  );

describe("async rule Workflow", () => {
  it("runs AI evaluation in a retryable child Workflow task", async () => {
    const evaluations: unknown[] = [];
    const configs: unknown[] = [];

    await run("job-1", evaluations, configs);

    expect(evaluations).toStrictEqual([params]);
    expect(configs).toStrictEqual([
      {
        name: "evaluate-ai-rules-v1",
        retries: {
          backoff: "exponential",
          delay: "30 seconds",
          limit: 5,
        },
        timeout: "5 minutes",
      },
    ]);
  });

  it("rejects a mismatched Workflow instance ID before evaluation", async () => {
    await expect(run("wrong-job", [], [])).rejects.toThrow(
      "Async rule Workflow instance ID does not match its job ID"
    );
  });
});
