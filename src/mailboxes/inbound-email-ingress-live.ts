import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { InboundIngestId, UnixMillis } from "#/modules/mailbox/domain/Mailbox";
import { BlobStoreError } from "#/modules/mailbox/ports/MailboxBlobStore";

import { InboundEmailRejected, InboundWorkflowStarter } from "./inbound";
import type { InboundEmailRoutingMessage } from "./inbound-email-routing";
import { InboundEmailIngress } from "./inbound-email-routing";

interface RawMessagePutOptions {
  readonly contentLength: number;
  readonly customMetadata: Readonly<Record<string, string>>;
  readonly httpMetadata: {
    readonly contentType: "message/rfc822";
  };
  readonly onlyIf: {
    readonly etagDoesNotMatch: "*";
  };
}

export interface RawMessagesR2Client {
  readonly put: (
    key: string,
    value: InboundEmailRoutingMessage["raw"],
    options: RawMessagePutOptions
  ) => Effect.Effect<{ readonly size: number } | null, unknown>;
}

/** Focused R2 binding used by the inbound storage adapter. */
export const RawMessagesR2Client = Context.Service<RawMessagesR2Client>(
  "cloudflare-inbox/RawMessagesR2Client"
);

export interface InboundEmailIngressRuntime {
  readonly enforceLength: (
    raw: InboundEmailRoutingMessage["raw"],
    expectedLength: number
  ) => InboundEmailRoutingMessage["raw"];
  readonly now: () => number;
  readonly randomId: () => string;
}

/** Clock, identity source, and Cloudflare stream primitive used during ingress. */
export const InboundEmailIngressRuntime =
  Context.Service<InboundEmailIngressRuntime>(
    "cloudflare-inbox/InboundEmailIngressRuntime"
  );

export const InboundEmailIngressRuntimeLive = Layer.succeed(
  InboundEmailIngressRuntime,
  InboundEmailIngressRuntime.of({
    enforceLength: (raw, expectedLength) => {
      // DOM and Workers publish structurally incompatible stream declarations.
      const source = raw as unknown as ReadableStream<Uint8Array>;
      const fixedLength = new FixedLengthStream(
        expectedLength
      ) as unknown as TransformStream<Uint8Array, Uint8Array>;
      return source.pipeThrough(fixedLength) as unknown as typeof raw;
    },
    now: Date.now,
    randomId: () => crypto.randomUUID(),
  })
);

const storageError = (cause: unknown) =>
  new BlobStoreError({
    cause,
    message: "Failed to store inbound raw message",
    objectType: "raw-message",
    operation: "write",
    retryable: true,
  });

const rejectStorageFailure = (cause: unknown) =>
  new InboundEmailRejected({
    cause: storageError(cause),
    message: "Inbound email processing is not available",
    reason: "processing-unavailable",
  });

const rejectWorkflowFailure = (cause: unknown) =>
  new InboundEmailRejected({
    cause,
    message: "Inbound email processing is not available",
    reason: "processing-unavailable",
  });

/** Streams the original MIME bytes to private R2 before downstream processing. */
export const InboundEmailIngressLive = Layer.effect(
  InboundEmailIngress,
  Effect.gen(function* () {
    const rawMessages = yield* RawMessagesR2Client;
    const runtime = yield* InboundEmailIngressRuntime;
    const workflow = yield* InboundWorkflowStarter;

    return InboundEmailIngress.of({
      receive: (message) =>
        Effect.gen(function* () {
          const inboundIngestId = yield* Schema.decodeUnknownEffect(
            InboundIngestId
          )(runtime.randomId()).pipe(Effect.mapError(rejectStorageFailure));
          const receivedAt = yield* Schema.decodeUnknownEffect(UnixMillis)(
            runtime.now()
          ).pipe(Effect.mapError(rejectStorageFailure));
          const key = `inbound/${inboundIngestId}/raw.eml`;
          const customMetadata = {
            "format-version": "1",
            "inbound-ingest-id": inboundIngestId,
            "mailbox-id": message.mailboxId,
            "object-type": "raw-message",
            "raw-size": String(message.envelope.rawSize),
            "received-at": String(receivedAt),
            "envelope-to": message.envelope.envelopeTo,
            ...(message.envelope.envelopeFrom === undefined
              ? {}
              : { "envelope-from": message.envelope.envelopeFrom }),
          };
          const raw = yield* Effect.try({
            try: () =>
              runtime.enforceLength(message.raw, message.envelope.rawSize),
            catch: rejectStorageFailure,
          });
          const stored = yield* rawMessages
            .put(key, raw, {
              contentLength: message.envelope.rawSize,
              customMetadata,
              httpMetadata: { contentType: "message/rfc822" },
              onlyIf: { etagDoesNotMatch: "*" },
            })
            .pipe(
              Effect.mapError(rejectStorageFailure),
              Effect.catchDefect((cause) =>
                Effect.fail(rejectStorageFailure(cause))
              )
            );

          if (stored === null || stored.size !== message.envelope.rawSize) {
            return yield* Effect.fail(
              rejectStorageFailure(
                stored === null
                  ? new Error("Inbound ingest object already exists")
                  : new Error("Stored raw message size does not match envelope")
              )
            );
          }

          yield* workflow
            .start({
              envelope: message.envelope,
              formatVersion: 1,
              inboundIngestId,
              mailboxId: message.mailboxId,
              receivedAt,
            })
            .pipe(Effect.mapError(rejectWorkflowFailure));
        }),
    });
  })
);
