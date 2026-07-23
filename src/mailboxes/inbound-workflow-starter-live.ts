import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";

import { WorkflowStartError } from "#/modules/mailbox/ports/MailboxWorkflowStarter";

import type { InboundWorkflowParams } from "./inbound";
import { InboundWorkflowStarter } from "./inbound";

export interface InboundWorkflowClient {
  readonly create: (options: {
    readonly id: string;
    readonly params: InboundWorkflowParams;
  }) => Effect.Effect<{ readonly id: string }, unknown>;
  readonly get: (
    instanceId: string
  ) => Effect.Effect<{ readonly id: string }, unknown>;
}

/** Focused Cloudflare Workflow binding used by the starter adapter. */
export const InboundWorkflowClient = Context.Service<InboundWorkflowClient>(
  "cloudflare-inbox/InboundWorkflowClient"
);

const instanceId = (params: InboundWorkflowParams) =>
  params.formatVersion === 1
    ? params.inboundIngestId
    : params.workflowInstanceId;

const startError = (params: InboundWorkflowParams, cause: unknown) =>
  new WorkflowStartError({
    cause,
    instanceId: instanceId(params),
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
          const expectedInstanceId = instanceId(params);
          const created = yield* Effect.exit(
            client.create({ id: expectedInstanceId, params })
          );

          if (Exit.isSuccess(created)) {
            if (created.value.id !== expectedInstanceId) {
              return yield* Effect.fail(
                startError(
                  params,
                  new Error("Workflow returned the wrong instance ID")
                )
              );
            }
            return;
          }

          const existing = yield* Effect.exit(client.get(expectedInstanceId));
          if (
            Exit.isSuccess(existing) &&
            existing.value.id === expectedInstanceId
          ) {
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
