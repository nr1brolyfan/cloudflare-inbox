import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";

import { WorkflowStartError } from "./errors";
import type { InboundWorkflowParamsV1 } from "./inbound";
import { InboundWorkflowStarter } from "./inbound";

export interface InboundWorkflowClient {
  readonly create: (options: {
    readonly id: string;
    readonly params: InboundWorkflowParamsV1;
  }) => Effect.Effect<{ readonly id: string }, unknown>;
  readonly get: (
    instanceId: string
  ) => Effect.Effect<{ readonly id: string }, unknown>;
}

/** Focused Cloudflare Workflow binding used by the starter adapter. */
export const InboundWorkflowClient = Context.Service<InboundWorkflowClient>(
  "cloudflare-inbox/InboundWorkflowClient"
);

const startError = (params: InboundWorkflowParamsV1, cause: unknown) =>
  new WorkflowStartError({
    cause,
    instanceId: params.inboundIngestId,
    message: "Failed to start inbound workflow",
    workflow: "inbound",
  });

/** Idempotently starts or confirms one Workflow instance per inbound ingest. */
export const InboundWorkflowStarterLive = Layer.effect(
  InboundWorkflowStarter,
  Effect.gen(function* () {
    const client = yield* InboundWorkflowClient;

    return InboundWorkflowStarter.of({
      start: (params) =>
        Effect.gen(function* () {
          const instanceId = params.inboundIngestId;
          const created = yield* Effect.exit(
            client.create({ id: instanceId, params })
          );

          if (Exit.isSuccess(created)) {
            if (created.value.id !== instanceId) {
              return yield* Effect.fail(
                startError(
                  params,
                  new Error("Workflow returned the wrong instance ID")
                )
              );
            }
            return;
          }

          const existing = yield* Effect.exit(client.get(instanceId));
          if (Exit.isSuccess(existing) && existing.value.id === instanceId) {
            return;
          }

          return yield* Effect.fail(
            startError(params, {
              create: Cause.squash(created.cause),
              get: Exit.isFailure(existing)
                ? Cause.squash(existing.cause)
                : new Error("Workflow returned the wrong existing instance ID"),
            })
          );
        }),
    });
  })
);
