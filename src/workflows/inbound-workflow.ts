import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type {
  InboundWorkflowParamsV1 as InboundWorkflowParamsV1Type,
  InboundWorkflowResultV1 as InboundWorkflowResultV1Type,
} from "../mailboxes/inbound";
import {
  InboundWorkflowParamsV1,
  InboundWorkflowResultV1,
} from "../mailboxes/inbound";

export const inboundWorkflowImplementation = Effect.succeed((input: unknown) =>
  Effect.gen(function* () {
    const params = yield* Schema.decodeUnknownEffect(InboundWorkflowParamsV1)(
      input
    ).pipe(Effect.orDie);
    const event = yield* Cloudflare.Workflows.WorkflowEvent;

    if (event.instanceId !== params.inboundIngestId) {
      return yield* Effect.die(
        new Error("Inbound Workflow instance ID does not match its ingest ID")
      );
    }

    const result = yield* Schema.decodeUnknownEffect(InboundWorkflowResultV1)({
      formatVersion: 1,
      inboundIngestId: params.inboundIngestId,
      mailboxId: params.mailboxId,
      status: "raw_stored",
    }).pipe(Effect.orDie);

    return yield* Cloudflare.Workflows.task(
      "record-raw-stored",
      Effect.succeed(result)
    );
  })
);

export default class InboundWorkflow extends Cloudflare.Workflow<InboundWorkflow>()<
  InboundWorkflowParamsV1Type,
  InboundWorkflowResultV1Type
>("InboundWorkflow", inboundWorkflowImplementation) {}
