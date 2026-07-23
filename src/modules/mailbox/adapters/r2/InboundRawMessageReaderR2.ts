import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { InboundRawMessageReader } from "#/modules/mailbox/ports/InboundRawMessageReader";
import { BlobStoreError } from "#/modules/mailbox/ports/MailboxBlobStore";

export interface InboundRawMessageR2Object {
  readonly size: number;
  readonly customMetadata: Readonly<Record<string, string>>;
  readonly arrayBuffer: () => Effect.Effect<ArrayBuffer, unknown>;
}

export interface InboundRawMessageR2Client {
  readonly get: (
    key: string
  ) => Effect.Effect<InboundRawMessageR2Object | null, unknown>;
}

/** Focused R2 read binding used by the inbound Workflow. */
export const InboundRawMessageR2Client =
  Context.Service<InboundRawMessageR2Client>(
    "cloudflare-inbox/InboundRawMessageR2Client"
  );

const readError = (cause: unknown, retryable: boolean) =>
  new BlobStoreError({
    cause,
    message: "Failed to read inbound raw message",
    objectType: "raw-message",
    operation: "read",
    retryable,
  });

/** Reads and verifies the immutable raw object selected by a trusted ingest ID. */
export const InboundRawMessageReaderR2Layer = Layer.effect(
  InboundRawMessageReader,
  Effect.gen(function* () {
    const client = yield* InboundRawMessageR2Client;

    return InboundRawMessageReader.of({
      read: (input) =>
        Effect.gen(function* () {
          const object = yield* client
            .get(`inbound/${input.inboundIngestId}/raw.eml`)
            .pipe(
              Effect.mapError((cause) => readError(cause, true)),
              Effect.catchDefect((cause) => Effect.fail(readError(cause, true)))
            );
          if (object === null) {
            return yield* Effect.fail(
              readError(new Error("Inbound raw message was not found"), false)
            );
          }

          const expectedMetadata = {
            "format-version": "1",
            "inbound-ingest-id": input.inboundIngestId,
            "mailbox-id": input.mailboxId,
            "object-type": "raw-message",
            "raw-size": String(input.rawSize),
            "received-at": String(input.receivedAt),
          };
          const metadataMatches = Object.entries(expectedMetadata).every(
            ([key, value]) => object.customMetadata[key] === value
          );
          if (!metadataMatches || object.size !== input.rawSize) {
            return yield* Effect.fail(
              readError(
                new Error("Inbound raw message metadata is inconsistent"),
                false
              )
            );
          }

          const raw = yield* object.arrayBuffer().pipe(
            Effect.mapError((cause) => readError(cause, true)),
            Effect.catchDefect((cause) => Effect.fail(readError(cause, true)))
          );
          if (raw.byteLength !== input.rawSize) {
            return yield* Effect.fail(
              readError(
                new Error("Inbound raw message size is inconsistent"),
                false
              )
            );
          }
          return raw;
        }),
    });
  })
);
