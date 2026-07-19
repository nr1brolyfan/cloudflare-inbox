import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import { BlobStoreError } from "#/mailboxes/errors";
import type {
  InboundAttachmentStore as InboundAttachmentStoreShape,
  InboundMessageCommitter as InboundMessageCommitterShape,
  InboundMimeAttachmentExtractor as InboundMimeAttachmentExtractorShape,
  InboundMimeParser as InboundMimeParserShape,
  InboundRawMessageReader as InboundRawMessageReaderShape,
} from "#/mailboxes/inbound";
import {
  InboundAttachmentStore,
  InboundMessageCommitter,
  InboundMimeAttachmentExtractor,
  InboundMimeParser,
  InboundRawMessageReader,
  ParsedInboundMessageV1,
  InboundProcessingSchema,
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
const committedProcessing = Schema.decodeUnknownSync(InboundProcessingSchema)({
  attemptCount: 1,
  createdAt: 2000,
  id: "ingest-1",
  mailboxId: "primary",
  messageId: "message-1",
  status: "ready",
  updatedAt: 2000,
  version: 1,
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
  parse: InboundMimeParserShape["parse"] = () => Effect.succeed(parsedManifest),
  extract: InboundMimeAttachmentExtractorShape["extract"] = () =>
    Effect.succeed({ attachments: [], manifest: parsedManifest }),
  store: InboundAttachmentStoreShape["store"] = () => Effect.void,
  commit: InboundMessageCommitterShape["commit"] = () =>
    Effect.succeed(committedProcessing)
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
          Layer.succeed(InboundMimeParser, InboundMimeParser.of({ parse })),
          Layer.succeed(
            InboundMimeAttachmentExtractor,
            InboundMimeAttachmentExtractor.of({ extract })
          ),
          Layer.succeed(
            InboundAttachmentStore,
            InboundAttachmentStore.of({ store })
          ),
          Layer.succeed(
            InboundMessageCommitter,
            InboundMessageCommitter.of({ commit })
          )
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
      messageId: "message-1",
      status: "ready",
    });
    expect(stepNames).toStrictEqual([
      "record-raw-stored",
      "parse-raw-mime",
      "store-inbound-attachments",
      "commit-inbound-message",
    ]);
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
      },
      () => Effect.succeed({ attachments: [], manifest: parsedManifest })
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

  it("does not store attachments when reparsing changes the manifest", async () => {
    let storeCalls = 0;
    const changedManifest = Schema.decodeUnknownSync(ParsedInboundMessageV1)({
      ...Schema.encodeSync(ParsedInboundMessageV1)(parsedManifest),
      subject: "Changed",
    });

    await expect(
      runWorkflow(
        validInput,
        "ingest-1",
        [],
        undefined,
        undefined,
        () =>
          Effect.succeed({
            attachments: [],
            manifest: changedManifest,
          }),
        () =>
          Effect.sync(() => {
            storeCalls += 1;
          })
      )
    ).rejects.toBeDefined();

    expect(storeCalls).toBe(0);
  });

  it("passes extracted attachment bytes and CID to the store", async () => {
    const manifest = Schema.decodeUnknownSync(ParsedInboundMessageV1)({
      ...Schema.encodeSync(ParsedInboundMessageV1)(parsedManifest),
      attachments: [
        {
          contentId: "image-1",
          disposition: "inline",
          fileName: "image.png",
          index: 0,
          mimeType: "image/png",
          size: 3,
        },
      ],
    });
    const [metadata] = manifest.attachments;
    if (metadata === undefined) {
      throw new TypeError("Expected attachment metadata");
    }
    const attachment = {
      content: new Uint8Array([1, 2, 3]),
      metadata,
    };
    let storeInput: unknown;
    let commitInput: unknown;

    await runWorkflow(
      validInput,
      "ingest-1",
      [],
      undefined,
      () => Effect.succeed(manifest),
      () =>
        Effect.succeed({
          attachments: [attachment],
          manifest,
        }),
      (input) =>
        Effect.sync(() => {
          storeInput = input;
        }),
      (input) =>
        Effect.sync(() => {
          commitInput = input;
          return committedProcessing;
        })
    );

    expect({ commitInput, storeInput }).toMatchObject({
      commitInput: {
        envelope: validInput.envelope,
        formatVersion: 1,
        inboundIngestId: "ingest-1",
        mailboxId: "primary",
        message: manifest,
        receivedAt: 2000,
      },
      storeInput: {
        attachments: [
          {
            content: new Uint8Array([1, 2, 3]),
            metadata: {
              contentId: "image-1",
              disposition: "inline",
              index: 0,
            },
          },
        ],
        inboundIngestId: "ingest-1",
        mailboxId: "primary",
        receivedAt: 2000,
      },
    });
  });

  it("does not commit when attachment storage fails", async () => {
    let commitCalls = 0;

    await expect(
      runWorkflow(
        validInput,
        "ingest-1",
        [],
        undefined,
        undefined,
        undefined,
        () =>
          Effect.fail(
            new BlobStoreError({
              cause: new Error("R2 unavailable"),
              message: "Failed to store inbound attachment",
              objectType: "attachment",
              operation: "write",
            })
          ),
        () =>
          Effect.sync(() => {
            commitCalls += 1;
            return committedProcessing;
          })
      )
    ).rejects.toBeDefined();

    expect(commitCalls).toBe(0);
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
