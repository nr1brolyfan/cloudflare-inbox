import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  InboundProcessingSchema,
  InboundReplay,
  InboundReplayPreparer,
  InboundWorkflowParamsV2,
  InboundWorkflowStarter,
  PreparedInboundReplayV1,
  ReplayInboundInput,
} from "#/mailboxes/inbound";
import { InboundReplayLive } from "#/mailboxes/inbound-replay-do-live";

const workflow = Schema.decodeUnknownSync(InboundWorkflowParamsV2)({
  envelope: { envelopeTo: "owner@example.test", rawSize: 3 },
  executionAttempt: 2,
  formatVersion: 2,
  inboundIngestId: "ingest-1",
  mailboxId: "primary",
  receivedAt: 2000,
  workflowInstanceId: "replay-instance-1",
});
const processing = Schema.decodeUnknownSync(InboundProcessingSchema)({
  attemptCount: 2,
  createdAt: 2000,
  id: "ingest-1",
  mailboxId: "primary",
  status: "received",
  updatedAt: 3000,
  version: 3,
});
const prepared = Schema.decodeUnknownSync(PreparedInboundReplayV1)({
  formatVersion: 1,
  processing,
  workflow,
});
const replayInput = Schema.decodeUnknownSync(ReplayInboundInput)({
  inboundIngestId: "ingest-1",
  mailboxId: "primary",
  operationId: "operation-1",
});

describe("inbound replay coordinator", () => {
  it("prepares before starting the exact fenced Workflow", async () => {
    const calls: unknown[] = [];

    const result = await Effect.runPromise(
      InboundReplay.pipe(
        Effect.flatMap((replay) => replay.replay(replayInput)),
        Effect.provide(
          InboundReplayLive.pipe(
            Layer.provide(
              Layer.merge(
                Layer.succeed(
                  InboundReplayPreparer,
                  InboundReplayPreparer.of({
                    claim: (input) =>
                      Effect.sync(() => {
                        calls.push({ _tag: "prepare", input });
                        return prepared;
                      }),
                  })
                ),
                Layer.succeed(
                  InboundWorkflowStarter,
                  InboundWorkflowStarter.of({
                    start: (params) =>
                      Effect.sync(() => {
                        calls.push({ _tag: "start", params });
                      }),
                  })
                )
              )
            )
          )
        )
      )
    );

    expect({ calls, result }).toMatchObject({
      calls: [
        { _tag: "prepare", input: { operationId: "operation-1" } },
        { _tag: "start", params: workflow },
      ],
      result: { attemptCount: 2, status: "received" },
    });
  });
});
