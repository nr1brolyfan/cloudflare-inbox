/* oxlint-disable max-classes-per-file -- Focused client and runtime services belong to this adapter. */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { InboundRawMessageStore } from "#/modules/mailbox/ports/InboundRawMessageStore";
import { BlobStoreError } from "#/modules/mailbox/ports/MailboxBlobStore";

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

export interface InboundRawMessageR2WriteClientService {
  readonly put: (
    key: string,
    value: ReadableStream<Uint8Array>,
    options: RawMessagePutOptions
  ) => Effect.Effect<{ readonly size: number } | null, unknown>;
}

/** Focused R2 binding used by the inbound storage adapter. */
export class InboundRawMessageR2WriteClient extends Context.Service<
  InboundRawMessageR2WriteClient,
  InboundRawMessageR2WriteClientService
>()("cloudflare-inbox/RawMessagesR2Client") {}

export interface InboundRawMessageStoreRuntimeService {
  readonly enforceLength: (
    raw: ReadableStream<Uint8Array>,
    expectedLength: number
  ) => ReadableStream<Uint8Array>;
}

export class InboundRawMessageStoreRuntime extends Context.Service<
  InboundRawMessageStoreRuntime,
  InboundRawMessageStoreRuntimeService
>()("cloudflare-inbox/InboundRawMessageStoreRuntime") {}

export const InboundRawMessageStoreRuntimeCloudflareLayer = Layer.succeed(
  InboundRawMessageStoreRuntime,
  InboundRawMessageStoreRuntime.of({
    enforceLength: (raw, expectedLength) => {
      // DOM and Workers publish structurally incompatible stream declarations.
      const fixedLength = new FixedLengthStream(
        expectedLength
      ) as unknown as TransformStream<Uint8Array, Uint8Array>;
      return raw.pipeThrough(fixedLength);
    },
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

/** Streams the original MIME bytes to private R2 before downstream processing. */
export const InboundRawMessageStoreR2Layer = Layer.effect(
  InboundRawMessageStore,
  Effect.gen(function* () {
    const rawMessages = yield* InboundRawMessageR2WriteClient;
    const runtime = yield* InboundRawMessageStoreRuntime;

    return InboundRawMessageStore.of({
      store: (input) =>
        Effect.gen(function* () {
          const key = `inbound/${input.inboundIngestId}/raw.eml`;
          const customMetadata = {
            "format-version": "1",
            "inbound-ingest-id": input.inboundIngestId,
            "mailbox-id": input.mailboxId,
            "object-type": "raw-message",
            "raw-size": String(input.envelope.rawSize),
            "received-at": String(input.receivedAt),
            "envelope-to": input.envelope.envelopeTo,
            ...(input.envelope.envelopeFrom === undefined
              ? {}
              : { "envelope-from": input.envelope.envelopeFrom }),
          };
          const raw = yield* Effect.try({
            try: () => runtime.enforceLength(input.raw, input.envelope.rawSize),
            catch: storageError,
          });
          const stored = yield* rawMessages
            .put(key, raw, {
              contentLength: input.envelope.rawSize,
              customMetadata,
              httpMetadata: { contentType: "message/rfc822" },
              onlyIf: { etagDoesNotMatch: "*" },
            })
            .pipe(
              Effect.mapError(storageError),
              Effect.catchDefect((cause) => Effect.fail(storageError(cause)))
            );

          if (stored === null || stored.size !== input.envelope.rawSize) {
            return yield* Effect.fail(
              storageError(
                stored === null
                  ? new Error("Inbound ingest object already exists")
                  : new Error("Stored raw message size does not match envelope")
              )
            );
          }
        }),
    });
  })
);
