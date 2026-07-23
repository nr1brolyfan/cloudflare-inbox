import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import type {
  InboundRawMessageR2WriteClientService,
  InboundRawMessageStoreRuntimeService,
} from "#/modules/mailbox/adapters/r2/InboundRawMessageStoreR2";
import {
  InboundRawMessageR2WriteClient,
  InboundRawMessageStoreR2Layer,
  InboundRawMessageStoreRuntime,
} from "#/modules/mailbox/adapters/r2/InboundRawMessageStoreR2";
import type { InboundEmailRoutingMessage } from "#/modules/mailbox/application/MailboxInboundEmailIngress";
import { MailboxInboundEmailIngress } from "#/modules/mailbox/application/MailboxInboundEmailIngress";
import { MailboxId } from "#/modules/mailbox/domain/Mailbox";
import {
  MAXIMUM_INBOUND_RAW_BYTES,
  ReceiveInboundEmailInput,
} from "#/modules/mailbox/domain/MailboxInbound";
import { InboundEmailRejected } from "#/modules/mailbox/ports/InboundEmailIngress";
import { InboundWorkflowStarter } from "#/modules/mailbox/ports/InboundWorkflowStarter";
import type { InboundWorkflowStarterService } from "#/modules/mailbox/ports/InboundWorkflowStarter";
import { BlobStoreError } from "#/modules/mailbox/ports/MailboxBlobStore";
import { MailboxInboundEmailIngressRuntime } from "#/modules/mailbox/ports/MailboxInboundEmailIngressRuntime";
import { WorkflowStartError } from "#/modules/mailbox/ports/MailboxWorkflowStarter";

type PutOptions = Parameters<InboundRawMessageR2WriteClientService["put"]>[2];

const bytes = new Uint8Array([82, 97, 119]);
const rawStream = () =>
  new ReadableStream<Uint8Array>({
    start: (controller) => {
      controller.enqueue(bytes);
      controller.close();
    },
  });

const chunkedRawStream = () =>
  new ReadableStream<Uint8Array>({
    start: (controller) => {
      controller.enqueue(bytes.subarray(0, 1));
      controller.enqueue(bytes.subarray(1));
      controller.close();
    },
  });

const enforceExactLength = (
  raw: ReadableStream<Uint8Array>,
  expectedLength: number
) => {
  let observedLength = 0;
  return raw.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      flush: () => {
        if (observedLength !== expectedLength) {
          throw new Error("Raw stream ended before its declared length");
        }
      },
      transform: (chunk, controller) => {
        observedLength += chunk.byteLength;
        if (observedLength > expectedLength) {
          throw new Error("Raw stream exceeded its declared length");
        }
        controller.enqueue(chunk);
      },
    })
  );
};

const message = (
  envelopeFrom: string | null = "sender@example.test",
  rawSize = bytes.length,
  raw: ReadableStream<Uint8Array> = rawStream()
): InboundEmailRoutingMessage => ({
  envelope: Schema.decodeUnknownSync(ReceiveInboundEmailInput)({
    envelopeFrom: envelopeFrom ?? undefined,
    envelopeTo: "owner@example.test",
    rawSize,
  }),
  headers: new Headers({ subject: "must not become metadata" }),
  mailboxId: Schema.decodeUnknownSync(MailboxId)("primary"),
  raw,
});

const ingressRuntime = (
  now: () => number = () => 2000,
  randomId: () => string = () => "ingest-1"
) =>
  Layer.succeed(
    MailboxInboundEmailIngressRuntime,
    MailboxInboundEmailIngressRuntime.of({
      now,
      randomId,
    })
  );

const storeRuntime = (
  enforceLength: InboundRawMessageStoreRuntimeService["enforceLength"] = (
    raw
  ) => raw
) =>
  Layer.succeed(
    InboundRawMessageStoreRuntime,
    InboundRawMessageStoreRuntime.of({ enforceLength })
  );

const runIngress = (
  input: InboundEmailRoutingMessage,
  put: InboundRawMessageR2WriteClientService["put"],
  enforceLength?: InboundRawMessageStoreRuntimeService["enforceLength"],
  start: InboundWorkflowStarterService["start"] = () => Effect.void,
  runtime = ingressRuntime()
) =>
  Effect.runPromise(
    MailboxInboundEmailIngress.pipe(
      Effect.flatMap((ingress) => ingress.receive(input)),
      Effect.provide(
        MailboxInboundEmailIngress.layerNoDeps.pipe(
          Layer.provide(
            Layer.mergeAll(
              InboundRawMessageStoreR2Layer.pipe(
                Layer.provide(
                  Layer.merge(
                    Layer.succeed(
                      InboundRawMessageR2WriteClient,
                      InboundRawMessageR2WriteClient.of({ put })
                    ),
                    storeRuntime(enforceLength)
                  )
                )
              ),
              runtime,
              Layer.succeed(
                InboundWorkflowStarter,
                InboundWorkflowStarter.of({ start })
              )
            )
          )
        )
      )
    )
  );

describe("inbound raw MIME R2 ingress", () => {
  it("rejects above the raw limit before identity, time, R2, or Workflow", async () => {
    const calls = {
      enforceLength: 0,
      now: 0,
      put: 0,
      randomId: 0,
      workflow: 0,
    };
    const failure = await runIngress(
      message("sender@example.test", MAXIMUM_INBOUND_RAW_BYTES + 1),
      () =>
        Effect.sync(() => {
          calls.put += 1;
          return { size: MAXIMUM_INBOUND_RAW_BYTES + 1 };
        }),
      (raw) => {
        calls.enforceLength += 1;
        return raw;
      },
      () =>
        Effect.sync(() => {
          calls.workflow += 1;
        }),
      ingressRuntime(
        () => {
          calls.now += 1;
          return 2000;
        },
        () => {
          calls.randomId += 1;
          return "ingest-1";
        }
      )
    ).catch((error: unknown) => error);

    expect({ calls, failure }).toMatchObject({
      calls: {
        enforceLength: 0,
        now: 0,
        put: 0,
        randomId: 0,
        workflow: 0,
      },
      failure: {
        message: "Message too large",
        reason: "message-too-large",
      },
    });
  });

  it("allows the exact raw limit to reach storage", async () => {
    let enforcedLength: number | undefined;
    let putCalls = 0;
    let workflowStarts = 0;

    await runIngress(
      message("sender@example.test", MAXIMUM_INBOUND_RAW_BYTES),
      (_, __, options) =>
        Effect.sync(() => {
          putCalls += 1;
          expect(options.contentLength).toBe(MAXIMUM_INBOUND_RAW_BYTES);
          return { size: MAXIMUM_INBOUND_RAW_BYTES };
        }),
      (raw, expectedLength) => {
        enforcedLength = expectedLength;
        return raw;
      },
      () =>
        Effect.sync(() => {
          workflowStarts += 1;
        })
    );

    expect({ enforcedLength, putCalls, workflowStarts }).toStrictEqual({
      enforcedLength: MAXIMUM_INBOUND_RAW_BYTES,
      putCalls: 1,
      workflowStarts: 1,
    });
  });

  it("streams exact declared length across multiple chunks before Workflow", async () => {
    const events: string[] = [];

    await runIngress(
      message("sender@example.test", bytes.length, chunkedRawStream()),
      (_, raw) =>
        Effect.promise(async () => {
          const stored = await new Response(
            raw as unknown as BodyInit
          ).arrayBuffer();
          events.push("r2-put");
          return { size: stored.byteLength };
        }),
      enforceExactLength,
      () =>
        Effect.sync(() => {
          events.push("workflow-start");
        })
    );

    expect(events).toStrictEqual(["r2-put", "workflow-start"]);
  });

  it.each([
    ["longer", bytes.length - 1],
    ["shorter", bytes.length + 1],
  ] as const)(
    "rejects an actual stream %s than its declared length before Workflow",
    async (_name, rawSize) => {
      let workflowStarts = 0;
      const failure = await runIngress(
        message("sender@example.test", rawSize, chunkedRawStream()),
        (_, raw) =>
          Effect.promise(async () => {
            const stored = await new Response(
              raw as unknown as BodyInit
            ).arrayBuffer();
            return { size: stored.byteLength };
          }),
        enforceExactLength,
        () =>
          Effect.sync(() => {
            workflowStarts += 1;
          })
      ).catch((error: unknown) => error);

      expect(failure).toMatchObject({
        cause: { _tag: "BlobStoreError" },
        reason: "processing-unavailable",
      });
      expect(workflowStarts).toBe(0);
    }
  );

  it("streams raw bytes to an append-only ingest key with bounded metadata", async () => {
    let captured:
      | {
          readonly bytes: number[];
          readonly key: string;
          readonly options: PutOptions;
        }
      | undefined;
    let enforcedLength: number | undefined;
    const events: string[] = [];
    let workflowParams: unknown;
    const input = message();

    await runIngress(
      input,
      (key, raw, options) =>
        Effect.promise(async () => {
          events.push("r2-put");
          const stored = new Uint8Array(
            await new Response(raw as unknown as BodyInit).arrayBuffer()
          );
          captured = { bytes: [...stored], key, options };
          return { size: stored.length };
        }),
      (raw, expectedLength) => {
        enforcedLength = expectedLength;
        return raw;
      },
      (params) =>
        Effect.sync(() => {
          events.push("workflow-start");
          workflowParams = params;
        })
    );

    expect({ captured, enforcedLength, events, workflowParams }).toStrictEqual({
      captured: {
        bytes: [...bytes],
        key: "inbound/ingest-1/raw.eml",
        options: {
          contentLength: bytes.length,
          customMetadata: {
            "envelope-from": "sender@example.test",
            "envelope-to": "owner@example.test",
            "format-version": "1",
            "inbound-ingest-id": "ingest-1",
            "mailbox-id": "primary",
            "object-type": "raw-message",
            "raw-size": String(bytes.length),
            "received-at": "2000",
          },
          httpMetadata: { contentType: "message/rfc822" },
          onlyIf: { etagDoesNotMatch: "*" },
        },
      },
      enforcedLength: bytes.length,
      events: ["r2-put", "workflow-start"],
      workflowParams: {
        envelope: input.envelope,
        formatVersion: 1,
        inboundIngestId: "ingest-1",
        mailboxId: "primary",
        receivedAt: 2000,
      },
    });
  });

  it("omits envelope-from metadata for a null reverse-path", async () => {
    let metadata: Readonly<Record<string, string>> | undefined;

    await runIngress(message(null), (_, __, options) => {
      metadata = options.customMetadata;
      return Effect.succeed({ size: bytes.length });
    });

    expect(metadata).not.toHaveProperty("envelope-from");
  });

  it.each([
    ["collision", null],
    ["size mismatch", { size: bytes.length + 1 }],
  ] as const)("fails closed on an R2 %s", async (_, result) => {
    let workflowStarts = 0;
    const failure = await runIngress(
      message(),
      () => Effect.succeed(result),
      undefined,
      () =>
        Effect.sync(() => {
          workflowStarts += 1;
        })
    ).catch((error: unknown) => error);

    expect(failure).toMatchObject({
      cause: {
        _tag: "BlobStoreError",
        objectType: "raw-message",
        operation: "write",
      },
      reason: "processing-unavailable",
    });
    expect(workflowStarts).toBe(0);
  });

  it.each([
    ["typed failure", Effect.fail(new Error("R2 unavailable"))],
    ["defect", Effect.die(new Error("stream failed"))],
  ] as const)("maps an R2 %s to a private blob-store cause", async (_, put) => {
    const failure = await runIngress(message(), () => put).catch(
      (error: unknown) => error
    );

    expect(failure).toMatchObject({
      cause: {
        _tag: "BlobStoreError",
        message: "Failed to store inbound raw message",
      },
      message: "Inbound email processing is not available",
      reason: "processing-unavailable",
    });
    if (!(failure instanceof InboundEmailRejected)) {
      throw new TypeError("Expected InboundEmailRejected");
    }
    expect(failure.cause).toBeInstanceOf(BlobStoreError);
  });

  it("maps fixed-length stream construction failures", async () => {
    const failure = await runIngress(
      message(),
      () => Effect.succeed({ size: bytes.length }),
      () => {
        throw new Error("FixedLengthStream unavailable");
      }
    ).catch((error: unknown) => error);

    expect(failure).toMatchObject({
      cause: { _tag: "BlobStoreError" },
      reason: "processing-unavailable",
    });
  });

  it("retains stored raw MIME when Workflow start fails", async () => {
    const events: string[] = [];

    const failure = await runIngress(
      message(),
      () =>
        Effect.sync(() => {
          events.push("r2-put");
          return { size: bytes.length };
        }),
      undefined,
      (params) =>
        Effect.sync(() => {
          events.push("workflow-start");
        }).pipe(
          Effect.andThen(
            Effect.fail(
              new WorkflowStartError({
                cause: new Error("Workflow unavailable"),
                instanceId: params.inboundIngestId,
                message: "Failed to start inbound workflow",
                workflow: "inbound",
              })
            )
          )
        )
    ).catch((error: unknown) => error);

    expect({ events, failure }).toMatchObject({
      events: ["r2-put", "workflow-start"],
      failure: {
        cause: {
          _tag: "WorkflowStartError",
          instanceId: "ingest-1",
          workflow: "inbound",
        },
        reason: "processing-unavailable",
      },
    });
  });
});
