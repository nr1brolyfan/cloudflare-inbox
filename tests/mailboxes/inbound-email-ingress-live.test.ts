import type * as CloudflareWorkers from "@cloudflare/workers-types";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import type { InboundWorkflowStarter as InboundWorkflowStarterShape } from "#/mailboxes/inbound";
import {
  InboundEmailRejected,
  InboundWorkflowStarter,
  ReceiveInboundEmailInput,
} from "#/mailboxes/inbound";
import type {
  InboundEmailIngressRuntime as InboundEmailIngressRuntimeShape,
  RawMessagesR2Client as RawMessagesR2ClientShape,
} from "#/mailboxes/inbound-email-ingress-live";
import {
  InboundEmailIngressLive,
  InboundEmailIngressRuntime,
  RawMessagesR2Client,
} from "#/mailboxes/inbound-email-ingress-live";
import type { InboundEmailRoutingMessage } from "#/mailboxes/inbound-email-routing";
import { InboundEmailIngress } from "#/mailboxes/inbound-email-routing";
import { MailboxId } from "#/modules/mailbox/domain/Mailbox";
import { BlobStoreError } from "#/modules/mailbox/ports/MailboxBlobStore";
import { WorkflowStartError } from "#/modules/mailbox/ports/MailboxWorkflowStarter";

type ForwardableEmailMessage = CloudflareWorkers.ForwardableEmailMessage;
type PutOptions = Parameters<RawMessagesR2ClientShape["put"]>[2];

const bytes = new Uint8Array([82, 97, 119]);
const rawStream = () =>
  new ReadableStream<Uint8Array>({
    start: (controller) => {
      controller.enqueue(bytes);
      controller.close();
    },
  }) as unknown as ForwardableEmailMessage["raw"];

const message = (
  envelopeFrom: string | null = "sender@example.test"
): InboundEmailRoutingMessage => ({
  envelope: Schema.decodeUnknownSync(ReceiveInboundEmailInput)({
    envelopeFrom: envelopeFrom ?? undefined,
    envelopeTo: "owner@example.test",
    rawSize: bytes.length,
  }),
  headers: new Headers({
    subject: "must not become metadata",
  }) as unknown as ForwardableEmailMessage["headers"],
  mailboxId: Schema.decodeUnknownSync(MailboxId)("primary"),
  raw: rawStream(),
});

const runtime = (
  enforceLength: InboundEmailIngressRuntimeShape["enforceLength"] = (raw) => raw
) =>
  Layer.succeed(
    InboundEmailIngressRuntime,
    InboundEmailIngressRuntime.of({
      enforceLength,
      now: () => 2000,
      randomId: () => "ingest-1",
    })
  );

const runIngress = (
  input: InboundEmailRoutingMessage,
  put: RawMessagesR2ClientShape["put"],
  enforceLength?: InboundEmailIngressRuntimeShape["enforceLength"],
  start: InboundWorkflowStarterShape["start"] = () => Effect.void
) =>
  Effect.runPromise(
    InboundEmailIngress.pipe(
      Effect.flatMap((ingress) => ingress.receive(input)),
      Effect.provide(
        InboundEmailIngressLive.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(
                RawMessagesR2Client,
                RawMessagesR2Client.of({ put })
              ),
              runtime(enforceLength),
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
