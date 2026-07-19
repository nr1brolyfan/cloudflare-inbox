import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { describe, expect, it } from "vitest";

import { inboundWorkflowImplementation } from "#/workflows/inbound-workflow";

const validInput = {
  envelope: {
    envelopeFrom: "sender@example.test",
    envelopeTo: "owner@example.test",
    rawSize: 3,
  },
  formatVersion: 1,
  inboundIngestId: "ingest-1",
  mailboxId: "primary",
  receivedAt: 2000,
};

const runStep = <T>(
  options: Cloudflare.Workflows.WorkflowTaskOptions<T, unknown, unknown>,
  stepNames: string[]
): Effect.Effect<T> => {
  stepNames.push(options.name);
  // Alchemy provides the captured Workflow context before calling step.do.
  return options.effect as Effect.Effect<T>;
};

const runWorkflow = (
  input: unknown,
  instanceId = "ingest-1",
  stepNames: string[] = []
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const implementation = yield* inboundWorkflowImplementation;
      return yield* implementation(input);
    }).pipe(
      Effect.provide(
        Layer.merge(
          Layer.succeed(
            Cloudflare.Workflows.WorkflowEvent,
            Cloudflare.Workflows.WorkflowEvent.of({
              instanceId,
              payload: input,
              timestamp: new Date(2000),
              workflowName: "InboundWorkflow",
            })
          ),
          Layer.succeed(
            Cloudflare.Workflows.WorkflowStep,
            Cloudflare.Workflows.WorkflowStep.of({
              do: (options) => runStep(options, stepNames),
              sleep: () => Effect.void,
              sleepUntil: () => Effect.void,
              waitForEvent: () => Effect.die("waitForEvent must not run"),
            })
          )
        )
      )
    )
  );

describe("inbound Workflow", () => {
  it("records the raw_stored checkpoint in one durable step", async () => {
    const stepNames: string[] = [];

    const result = await runWorkflow(validInput, "ingest-1", stepNames);

    expect(result).toStrictEqual({
      formatVersion: 1,
      inboundIngestId: "ingest-1",
      mailboxId: "primary",
      status: "raw_stored",
    });
    expect(stepNames).toStrictEqual(["record-raw-stored"]);
  });

  it("rejects an instance ID that differs from the ingest ID", async () => {
    await expect(
      runWorkflow(validInput, "wrong-instance")
    ).rejects.toBeDefined();
  });

  it.each([
    ["missing mailbox", { ...validInput, mailboxId: undefined }],
    ["invalid envelope", { ...validInput, envelope: { rawSize: -1 } }],
    ["invalid timestamp", { ...validInput, receivedAt: -1 }],
    ["unsupported version", { ...validInput, formatVersion: 2 }],
  ])("rejects %s input", async (_, input) => {
    await expect(runWorkflow(input)).rejects.toBeDefined();
  });
});
