import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import { WorkflowStartError } from "#/mailboxes/errors";
import {
  InboundWorkflowParamsV1,
  InboundWorkflowStarter,
} from "#/mailboxes/inbound";
import type { InboundWorkflowClient as InboundWorkflowClientShape } from "#/mailboxes/inbound-workflow-starter-live";
import {
  InboundWorkflowClient,
  InboundWorkflowStarterLive,
} from "#/mailboxes/inbound-workflow-starter-live";

const params = Schema.decodeUnknownSync(InboundWorkflowParamsV1)({
  envelope: {
    envelopeFrom: "sender@example.test",
    envelopeTo: "owner@example.test",
    rawSize: 3,
  },
  formatVersion: 1,
  inboundIngestId: "ingest-1",
  mailboxId: "primary",
  receivedAt: 2000,
});

const runStart = (client: InboundWorkflowClientShape) =>
  Effect.runPromise(
    InboundWorkflowStarter.pipe(
      Effect.flatMap((starter) => starter.start(params)),
      Effect.provide(
        InboundWorkflowStarterLive.pipe(
          Layer.provide(
            Layer.succeed(
              InboundWorkflowClient,
              InboundWorkflowClient.of(client)
            )
          )
        )
      )
    )
  );

describe("inbound Workflow starter", () => {
  it("uses the ingest ID as the deterministic Workflow instance ID", async () => {
    let createOptions: unknown;

    await runStart({
      create: (options) => {
        createOptions = options;
        return Effect.succeed({ id: options.id });
      },
      get: () => Effect.die("get must not run"),
    });

    expect(createOptions).toStrictEqual({ id: "ingest-1", params });
  });

  it("confirms an existing instance after an ambiguous create failure", async () => {
    const calls: string[] = [];

    await runStart({
      create: () =>
        Effect.sync(() => {
          calls.push("create");
        }).pipe(Effect.andThen(Effect.fail(new Error("response lost")))),
      get: (instanceId) =>
        Effect.sync(() => {
          calls.push(`get:${instanceId}`);
          return { id: instanceId };
        }),
    });

    expect(calls).toStrictEqual(["create", "get:ingest-1"]);
  });

  it.each([
    ["typed failures", Effect.fail(new Error("unavailable"))],
    ["defects", Effect.die(new Error("binding defect"))],
  ] as const)(
    "maps create and get %s to WorkflowStartError",
    async (_, failure) => {
      const startFailure = await runStart({
        create: () => failure,
        get: () => failure,
      }).catch((error: unknown) => error);

      expect(startFailure).toMatchObject({
        _tag: "WorkflowStartError",
        instanceId: "ingest-1",
        message: "Failed to start inbound workflow",
        workflow: "inbound",
      });
      expect(startFailure).toBeInstanceOf(WorkflowStartError);
    }
  );

  it("rejects a mismatched created instance", async () => {
    const startFailure = await runStart({
      create: () => Effect.succeed({ id: "wrong-instance" }),
      get: () => Effect.die("get must not run"),
    }).catch((error: unknown) => error);

    expect(startFailure).toMatchObject({
      _tag: "WorkflowStartError",
      instanceId: "ingest-1",
      workflow: "inbound",
    });
  });
});
