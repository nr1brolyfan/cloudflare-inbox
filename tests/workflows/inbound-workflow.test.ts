import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import { BlobStoreError } from "#/mailboxes/errors";
import type {
  InboundMimeParser as InboundMimeParserShape,
  InboundRawMessageReader as InboundRawMessageReaderShape,
} from "#/mailboxes/inbound";
import {
  InboundMimeParser,
  InboundRawMessageReader,
  ParsedInboundMessageV1,
} from "#/mailboxes/inbound";
import { inboundWorkflowProgram } from "#/workflows/inbound-workflow";

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
const parsedManifest = Schema.decodeUnknownSync(ParsedInboundMessageV1)({
  attachments: [],
  bcc: [],
  cc: [],
  formatVersion: 1,
  references: [],
  subject: "Hello",
  to: [{ address: "owner@example.test" }],
});

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
  stepNames: string[] = [],
  read: InboundRawMessageReaderShape["read"] = () =>
    Effect.succeed(new Uint8Array([1, 2, 3]).buffer),
  parse: InboundMimeParserShape["parse"] = () => Effect.succeed(parsedManifest)
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const implementation = yield* inboundWorkflowProgram;
      return yield* implementation(input);
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
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
          ),
          Layer.succeed(
            InboundRawMessageReader,
            InboundRawMessageReader.of({ read })
          ),
          Layer.succeed(InboundMimeParser, InboundMimeParser.of({ parse }))
        )
      )
    )
  );

describe("inbound Workflow", () => {
  it("parses raw MIME after the raw_stored checkpoint", async () => {
    const stepNames: string[] = [];

    const result = await runWorkflow(validInput, "ingest-1", stepNames);

    expect(result).toStrictEqual({
      formatVersion: 1,
      inboundIngestId: "ingest-1",
      mailboxId: "primary",
      status: "parsing",
    });
    expect(stepNames).toStrictEqual(["record-raw-stored", "parse-raw-mime"]);
  });

  it("passes trusted ingest metadata and the exact raw buffer to parsing", async () => {
    const raw = new Uint8Array([4, 5, 6]).buffer;
    let readInput: unknown;
    let parsedRaw: ArrayBuffer | undefined;

    await runWorkflow(
      validInput,
      "ingest-1",
      [],
      (input) => {
        readInput = input;
        return Effect.succeed(raw);
      },
      (input) => {
        parsedRaw = input;
        return Effect.succeed(parsedManifest);
      }
    );

    expect({ parsedRawIsExact: parsedRaw === raw, readInput }).toStrictEqual({
      parsedRawIsExact: true,
      readInput: {
        inboundIngestId: "ingest-1",
        mailboxId: "primary",
        rawSize: 3,
        receivedAt: 2000,
      },
    });
  });

  it("does not parse when the durable raw read fails", async () => {
    let parserCalls = 0;

    await expect(
      runWorkflow(
        validInput,
        "ingest-1",
        [],
        () =>
          Effect.fail(
            new BlobStoreError({
              cause: new Error("R2 unavailable"),
              message: "Failed to read inbound raw message",
              objectType: "raw-message",
              operation: "read",
            })
          ),
        () =>
          Effect.sync(() => {
            parserCalls += 1;
            return parsedManifest;
          })
      )
    ).rejects.toBeDefined();

    expect(parserCalls).toBe(0);
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
