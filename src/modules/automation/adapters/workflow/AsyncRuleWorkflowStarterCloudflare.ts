import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";

import type { AsyncRuleWorkflowParams } from "#/modules/automation/ports/AsyncRuleWorkflowStarter";
import { AsyncRuleWorkflowStarter } from "#/modules/automation/ports/AsyncRuleWorkflowStarter";
import { WorkflowStartError } from "#/modules/mailbox/ports/MailboxWorkflowStarter";

export interface AsyncRuleWorkflowClientService {
  readonly create: (options: {
    readonly id: string;
    readonly params: AsyncRuleWorkflowParams;
  }) => Effect.Effect<{ readonly id: string }, unknown>;
  readonly get: (
    instanceId: string
  ) => Effect.Effect<{ readonly id: string }, unknown>;
}

/** Focused Cloudflare Workflow binding used by the starter adapter. */
export class AsyncRuleWorkflowClient extends Context.Service<
  AsyncRuleWorkflowClient,
  AsyncRuleWorkflowClientService
>()("cloudflare-inbox/AsyncRuleWorkflowClient") {}

export const AsyncRuleWorkflowStarterCloudflareLayer = Layer.effect(
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
