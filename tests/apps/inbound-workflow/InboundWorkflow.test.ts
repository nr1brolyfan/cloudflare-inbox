import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import { inboundWorkflowProgram } from "#/apps/inbound-workflow/InboundWorkflow";
import { AsyncRuleWorkflowStarter } from "#/modules/automation/ports/AsyncRuleWorkflowStarter";
import type { AsyncRuleWorkflowStarterService } from "#/modules/automation/ports/AsyncRuleWorkflowStarter";
import { MailboxDomainError } from "#/modules/mailbox/domain/MailboxError";
import {
  ParsedInboundMessageV1,
  InboundProcessingSchema,
} from "#/modules/mailbox/domain/MailboxInbound";
import type { InboundAttachmentStoreService } from "#/modules/mailbox/ports/InboundAttachmentStore";
import { InboundAttachmentStore } from "#/modules/mailbox/ports/InboundAttachmentStore";
import type {
  InboundMimeAttachmentExtractorService,
  InboundMimeParserService,
} from "#/modules/mailbox/ports/InboundMimeParser";
import {
  InboundMimeAttachmentExtractor,
  InboundMimeParser,
  MimeParseError,
} from "#/modules/mailbox/ports/InboundMimeParser";
import type { InboundRawMessageReaderService } from "#/modules/mailbox/ports/InboundRawMessageReader";
import { InboundRawMessageReader } from "#/modules/mailbox/ports/InboundRawMessageReader";
import { BlobStoreError } from "#/modules/mailbox/ports/MailboxBlobStore";
import type {
  InboundMessageCommitterService,
  InboundProcessingRecorderService,
} from "#/modules/mailbox/ports/MailboxInboundRepository";
import {
  InboundMessageCommitter,
  InboundProcessingRecorder,
} from "#/modules/mailbox/ports/MailboxInboundRepository";
import { MailboxRepositoryError } from "#/modules/mailbox/ports/MailboxRepositoryError";
import { WorkflowStartError } from "#/modules/mailbox/ports/MailboxWorkflowStarter";

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
const committedProcessingWithAsyncRules = Schema.decodeUnknownSync(
  InboundProcessingSchema
)({
  ...Schema.encodeSync(InboundProcessingSchema)(committedProcessing),
  asyncRuleJobId: "ingest-1",
});

const recordProcessing: InboundProcessingRecorderService["record"] = (input) =>
  Effect.succeed(
    Schema.decodeUnknownSync(InboundProcessingSchema)({
      attemptCount: 1,
      createdAt: input.receivedAt,
      failure:
        input._tag === "Failure"
          ? {
              code: input.failure.code,
              failedAt: input.receivedAt,
              replayable: input.failure.replayable,
            }
          : undefined,
      id: input.inboundIngestId,
      mailboxId: input.mailboxId,
      status: input._tag === "Failure" ? "failed" : input.status,
      updatedAt: input.receivedAt,
      version: 1,
    })
  );

const runStep = <T>(
  options: Cloudflare.Workflows.WorkflowTaskOptions<T, unknown, unknown>,
  stepNames: string[],
  taskConfigs: unknown[]
): Effect.Effect<T> => {
  stepNames.push(options.name);
  taskConfigs.push({
    name: options.name,
    retries: options.retries,
    timeout: options.timeout,
  });
  // Alchemy provides the captured Workflow context before calling step.do.
  return options.effect as Effect.Effect<T>;
};

const runWorkflow = (
  input: unknown,
  instanceId = "ingest-1",
  stepNames: string[] = [],
  read: InboundRawMessageReaderService["read"] = () =>
    Effect.succeed(new Uint8Array([1, 2, 3]).buffer),
  parse: InboundMimeParserService["parse"] = () =>
    Effect.succeed(parsedManifest),
  extract: InboundMimeAttachmentExtractorService["extract"] = () =>
    Effect.succeed({ attachments: [], manifest: parsedManifest }),
  store: InboundAttachmentStoreService["store"] = () => Effect.void,
  commit: InboundMessageCommitterService["commit"] = () =>
    Effect.succeed(committedProcessing),
  record: InboundProcessingRecorderService["record"] = recordProcessing,
  taskConfigs: unknown[] = [],
  startAsyncRules: AsyncRuleWorkflowStarterService["start"] = () => Effect.void
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
              do: (options) => runStep(options, stepNames, taskConfigs),
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
          ),
          Layer.succeed(
            InboundProcessingRecorder,
            InboundProcessingRecorder.of({ record })
          ),
          Layer.succeed(
            AsyncRuleWorkflowStarter,
            AsyncRuleWorkflowStarter.of({ start: startAsyncRules })
          )
        )
      )
    )
  );

describe("inbound Workflow", () => {
  it("parses raw MIME after the raw_stored checkpoint", async () => {
    const stepNames: string[] = [];
    const taskConfigs: unknown[] = [];

    const result = await runWorkflow(
      validInput,
      "ingest-1",
      stepNames,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      taskConfigs
    );

    expect(result).toStrictEqual({
      formatVersion: 1,
      inboundIngestId: "ingest-1",
      mailboxId: "primary",
      messageId: "message-1",
      status: "ready",
    });
    expect(stepNames).toStrictEqual([
      "record-raw-stored-v2",
      "record-parsing-v2",
      "parse-raw-mime-v2",
      "store-inbound-attachments-v2",
      "record-attachments-stored-v2",
      "commit-inbound-message-v2",
    ]);
    expect(taskConfigs).toStrictEqual(
      expect.arrayContaining([
        {
          name: "parse-raw-mime-v2",
          retries: {
            backoff: "exponential",
            delay: "5 seconds",
            limit: 5,
          },
          timeout: "5 minutes",
        },
        {
          name: "record-raw-stored-v2",
          retries: {
            backoff: "exponential",
            delay: "2 seconds",
            limit: 5,
          },
          timeout: "1 minute",
        },
      ])
    );
  });

  it("dispatches AI rules after ready without failing inbound", async () => {
    const stepNames: string[] = [];
    const starts: unknown[] = [];

    const result = await runWorkflow(
      validInput,
      "ingest-1",
      stepNames,
      undefined,
      undefined,
      undefined,
      undefined,
      () => Effect.succeed(committedProcessingWithAsyncRules),
      undefined,
      [],
      (params) => {
        starts.push(params);
        return Effect.fail(
          new WorkflowStartError({
            cause: "unavailable",
            instanceId: params.jobId,
            message: "Unavailable",
            workflow: "async-rules",
          })
        );
      }
    );

    expect(result).toMatchObject({ messageId: "message-1", status: "ready" });
    expect(starts).toStrictEqual([
      { formatVersion: 1, jobId: "ingest-1", mailboxId: "primary" },
    ]);
    expect(stepNames.at(-1)).toBe("start-async-rule-workflow-v1");
  });

  it("fences replay checkpoints and commit with the prepared attempt", async () => {
    const replayInput = {
      ...validInput,
      executionAttempt: 2,
      formatVersion: 2,
      workflowInstanceId: "replay-instance-1",
    };
    const records: unknown[] = [];
    let commitInput: unknown;

    const result = await runWorkflow(
      replayInput,
      "replay-instance-1",
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      (input) => {
        commitInput = input;
        return Effect.succeed(
          Schema.decodeUnknownSync(InboundProcessingSchema)({
            ...committedProcessing,
            attemptCount: 2,
            version: 5,
          })
        );
      },
      (input) => {
        records.push(input);
        return recordProcessing(input);
      }
    );

    expect({ commitInput, records, result }).toMatchObject({
      commitInput: { executionAttempt: 2, formatVersion: 2 },
      records: [
        { executionAttempt: 2, formatVersion: 2, status: "raw_stored" },
        { executionAttempt: 2, formatVersion: 2, status: "parsing" },
        {
          executionAttempt: 2,
          formatVersion: 2,
          status: "attachments_stored",
        },
      ],
      result: { messageId: "message-1", status: "ready" },
    });
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
              retryable: false,
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

  it("records a permanent MIME failure without running later steps", async () => {
    const stepNames: string[] = [];
    let failureInput: unknown;

    await expect(
      runWorkflow(
        validInput,
        "ingest-1",
        stepNames,
        undefined,
        () =>
          Effect.fail(
            new MimeParseError({
              message: "Malformed MIME",
              reason: "malformed-message",
            })
          ),
        undefined,
        undefined,
        undefined,
        (input) => {
          if (input._tag === "Failure") {
            failureInput = input;
          }
          return recordProcessing(input);
        }
      )
    ).rejects.toBeDefined();

    expect({ failureInput, stepNames }).toMatchObject({
      failureInput: {
        _tag: "Failure",
        failure: { code: "malformed_message", replayable: false },
      },
      stepNames: [
        "record-raw-stored-v2",
        "record-parsing-v2",
        "parse-raw-mime-v2",
        "record-inbound-failure-v2",
      ],
    });
  });

  it("does not persist unclassified programming defects as business failures", async () => {
    let failureRecords = 0;

    await expect(
      runWorkflow(
        validInput,
        "ingest-1",
        [],
        undefined,
        () => Effect.die(new Error("parser defect")),
        undefined,
        undefined,
        undefined,
        (input) => {
          if (input._tag === "Failure") {
            failureRecords += 1;
          }
          return recordProcessing(input);
        }
      )
    ).rejects.toBeDefined();

    expect(failureRecords).toBe(0);
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
              retryable: false,
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

  it("returns ready when failure recording resolves an ambiguous commit", async () => {
    let failureRecorded = false;

    const result = await runWorkflow(
      validInput,
      "ingest-1",
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      () =>
        Effect.fail(
          new MailboxRepositoryError({
            cause: new Error("response lost"),
            commitState: "unknown",
            message: "Inbound commit RPC failed",
            operation: "write",
            transient: true,
          })
        ),
      (input) => {
        if (input._tag === "Failure") {
          failureRecorded = true;
          return Effect.succeed(committedProcessing);
        }
        return recordProcessing(input);
      }
    );

    expect({ failureRecorded, result }).toMatchObject({
      failureRecorded: true,
      result: { messageId: "message-1", status: "ready" },
    });
  });

  it("does not mask an idempotency conflict with the existing ready row", async () => {
    let failureRecords = 0;

    await expect(
      runWorkflow(
        validInput,
        "ingest-1",
        [],
        undefined,
        undefined,
        undefined,
        undefined,
        () =>
          Effect.fail(
            new MailboxDomainError({
              message: "Conflicting commit",
              operation: "commit-inbound",
              reason: "idempotency-conflict",
              resourceId: "ingest-1",
              resourceType: "inbound",
            })
          ),
        (input) => {
          if (input._tag === "Failure") {
            failureRecords += 1;
          }
          return recordProcessing(input);
        }
      )
    ).rejects.toBeDefined();

    expect(failureRecords).toBe(0);
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
