import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { ParsedInboundAttachmentV1 } from "#/modules/mailbox/domain/MailboxInbound";
import { InboundAttachmentBlobReader } from "#/modules/mailbox/ports/InboundAttachmentBlobReader";
import { BlobStoreError } from "#/modules/mailbox/ports/MailboxBlobStore";

import {
  InboundAttachmentStoreRuntime,
  InboundAttachmentStoreRuntimeSystemLayer,
  inboundAttachmentObjectKey,
} from "./InboundAttachmentStoreR2";

export interface InboundAttachmentR2ReadObject {
  readonly arrayBuffer: () => Effect.Effect<ArrayBuffer, unknown>;
  readonly contentType?: string;
  readonly customMetadata: Readonly<Record<string, string>>;
  readonly sha256?: string;
  readonly size: number;
}

export interface InboundAttachmentR2ReadClient {
  readonly get: (
    key: string
  ) => Effect.Effect<InboundAttachmentR2ReadObject | null, unknown>;
}

export const InboundAttachmentR2ReadClient =
  Context.Service<InboundAttachmentR2ReadClient>(
    "cloudflare-inbox/InboundAttachmentR2ReadClient"
  );

const readError = (cause: unknown, retryable: boolean) =>
  new BlobStoreError({
    cause,
    message: "Failed to read inbound attachment",
    objectType: "attachment",
    operation: "read",
    retryable,
  });

/** Reads immutable attachment bytes and verifies the trusted SQLite locator. */
export const InboundAttachmentBlobReaderR2Layer = Layer.effect(
  InboundAttachmentBlobReader,
  Effect.gen(function* () {
    const client = yield* InboundAttachmentR2ReadClient;
    const runtime = yield* InboundAttachmentStoreRuntime;

    return InboundAttachmentBlobReader.of({
      read: (location) =>
        Effect.gen(function* () {
          const object = yield* client
            .get(
              inboundAttachmentObjectKey(
                location.inboundIngestId,
                location.sourceIndex
              )
            )
            .pipe(
              Effect.mapError((cause) => readError(cause, true)),
              Effect.catchDefect((cause) => Effect.fail(readError(cause, true)))
            );
          if (object === null) {
            return yield* Effect.fail(
              readError(new Error("Inbound attachment was not found"), false)
            );
          }

          const contentSha256 = object.customMetadata["content-sha256"];
          const metadataSha256 = yield* runtime
            .sha256(
              new TextEncoder().encode(
                JSON.stringify(
                  Schema.encodeSync(ParsedInboundAttachmentV1)({
                    contentId: location.contentId,
                    disposition: location.disposition,
                    fileName: location.fileName,
                    index: location.sourceIndex,
                    mimeType: location.mimeType,
                    size: location.size,
                  })
                )
              )
            )
            .pipe(
              Effect.mapError((cause) => readError(cause, true)),
              Effect.catchDefect((cause) => Effect.fail(readError(cause, true)))
            );
          const expectedMetadata = {
            "attachment-index": String(location.sourceIndex),
            "attachment-metadata-sha256": metadataSha256,
            "attachment-size": String(location.size),
            "format-version": "1",
            "inbound-ingest-id": location.inboundIngestId,
            "mailbox-id": location.mailboxId,
            "object-type": "attachment",
            "received-at": String(location.receivedAt),
          };
          const metadataMatches = Object.entries(expectedMetadata).every(
            ([key, value]) => object.customMetadata[key] === value
          );
          const hashesPresent = /^[a-f0-9]{64}$/u.test(contentSha256 ?? "");
          if (
            !metadataMatches ||
            !hashesPresent ||
            object.contentType !== location.mimeType ||
            object.sha256 !== contentSha256 ||
            object.size !== location.size
          ) {
            return yield* Effect.fail(
              readError(
                new Error("Inbound attachment metadata is inconsistent"),
                false
              )
            );
          }

          const buffer = yield* object.arrayBuffer().pipe(
            Effect.mapError((cause) => readError(cause, true)),
            Effect.catchDefect((cause) => Effect.fail(readError(cause, true)))
          );
          if (buffer.byteLength !== location.size) {
            return yield* Effect.fail(
              readError(
                new Error("Inbound attachment size is inconsistent"),
                false
              )
            );
          }
          const actualSha256 = yield* runtime.sha256(buffer).pipe(
            Effect.mapError((cause) => readError(cause, true)),
            Effect.catchDefect((cause) => Effect.fail(readError(cause, true)))
          );
          if (actualSha256 !== contentSha256) {
            return yield* Effect.fail(
              readError(
                new Error("Inbound attachment checksum is inconsistent"),
                false
              )
            );
          }
          return new Uint8Array(buffer);
        }),
    });
  })
);

export const InboundAttachmentBlobReaderR2WithRuntimeLayer =
  InboundAttachmentBlobReaderR2Layer.pipe(
    Layer.provide(InboundAttachmentStoreRuntimeSystemLayer)
  );
