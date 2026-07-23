import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";

import { WorkflowStartError } from "#/modules/mailbox/ports/MailboxWorkflowStarter";

import type { AsyncRuleWorkflowParams } from "./async-rules";
import { AsyncRuleWorkflowStarter } from "./async-rules";

export interface AsyncRuleWorkflowClient {
  readonly create: (options: {
    readonly id: string;
    readonly params: AsyncRuleWorkflowParams;
  }) => Effect.Effect<{ readonly id: string }, unknown>;
  readonly get: (
    instanceId: string
  ) => Effect.Effect<{ readonly id: string }, unknown>;
}

export const AsyncRuleWorkflowClient = Context.Service<AsyncRuleWorkflowClient>(
  "cloudflare-inbox/AsyncRuleWorkflowClient"
);

export const AsyncRuleWorkflowStarterLive = Layer.effect(
  AsyncRuleWorkflowStarter,
  Effect.gen(function* () {
    const client = yield* AsyncRuleWorkflowClient;

    return AsyncRuleWorkflowStarter.of({
      start: (params) =>
        Effect.gen(function* () {
          const created = yield* Effect.exit(
            client.create({ id: params.jobId, params })
          );
          if (Exit.isSuccess(created) && created.value.id === params.jobId) {
            return;
          }
          const existing = yield* Effect.exit(client.get(params.jobId));
          if (Exit.isSuccess(existing) && existing.value.id === params.jobId) {
            return;
          }
          return yield* new WorkflowStartError({
            cause: {
              create: Exit.isFailure(created)
                ? Cause.squash(created.cause)
                : new Error("Workflow returned the wrong instance ID"),
              get: Exit.isFailure(existing)
                ? Cause.squash(existing.cause)
                : new Error("Workflow returned the wrong existing instance ID"),
            },
            instanceId: params.jobId,
            message: "Failed to start async rule workflow",
            workflow: "async-rules",
          });
        }),
    });
  })
);
