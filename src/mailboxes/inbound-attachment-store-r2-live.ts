/* oxlint-disable unicorn/no-array-for-each -- Effect.forEach is not Array#forEach. */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { BlobStoreError } from "./errors";
import { InboundAttachmentStore, ParsedInboundAttachmentV1 } from "./inbound";
import type {
  ExtractedInboundAttachmentV1,
  StoreInboundAttachmentsInput,
} from "./inbound";

interface AttachmentPutOptions {
  readonly contentLength: number;
  readonly customMetadata: Readonly<Record<string, string>>;
  readonly httpMetadata: {
    readonly contentType: string;
  };
  readonly onlyIf: {
    readonly etagDoesNotMatch: "*";
  };
  readonly sha256: string;
}

export interface InboundAttachmentR2Object {
  readonly size: number;
  readonly customMetadata: Readonly<Record<string, string>>;
  readonly contentType?: string;
  readonly sha256?: string;
}

export interface InboundAttachmentR2Client {
  readonly put: (
    key: string,
    content: Uint8Array,
    options: AttachmentPutOptions
  ) => Effect.Effect<InboundAttachmentR2Object | null, unknown>;
  readonly head: (
    key: string
  ) => Effect.Effect<InboundAttachmentR2Object | null, unknown>;
}

export const InboundAttachmentR2Client =
  Context.Service<InboundAttachmentR2Client>(
    "cloudflare-inbox/InboundAttachmentR2Client"
  );

export interface InboundAttachmentStoreRuntime {
  readonly sha256: (
    value: ArrayBuffer | ArrayBufferView
  ) => Effect.Effect<string, unknown>;
}

export const InboundAttachmentStoreRuntime =
  Context.Service<InboundAttachmentStoreRuntime>(
    "cloudflare-inbox/InboundAttachmentStoreRuntime"
  );

const toHex = (value: ArrayBuffer) =>
  [...new Uint8Array(value)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

export const InboundAttachmentStoreRuntimeLive = Layer.succeed(
  InboundAttachmentStoreRuntime,
  InboundAttachmentStoreRuntime.of({
    sha256: (value) =>
      Effect.tryPromise({
        try: () => {
          const bytes =
            value instanceof ArrayBuffer
              ? value
              : new Uint8Array(
                  value.buffer,
                  value.byteOffset,
                  value.byteLength
                ).slice().buffer;
          return crypto.subtle.digest("SHA-256", bytes);
        },
        catch: (cause) => cause,
      }).pipe(Effect.map(toHex)),
  })
);

const storeError = (operation: "head" | "write", cause: unknown) =>
  new BlobStoreError({
    cause,
    message: "Failed to store inbound attachment",
    objectType: "attachment",
    operation,
  });

const metadataBytes = (attachment: ExtractedInboundAttachmentV1) =>
  new TextEncoder().encode(
    JSON.stringify(
      Schema.encodeSync(ParsedInboundAttachmentV1)(attachment.metadata)
    )
  );

const objectMatches = (
  object: InboundAttachmentR2Object,
  attachment: ExtractedInboundAttachmentV1,
  customMetadata: Readonly<Record<string, string>>,
  contentSha256: string
) =>
  object.size === attachment.metadata.size &&
  object.contentType === attachment.metadata.mimeType &&
  object.sha256 === contentSha256 &&
  Object.keys(object.customMetadata).length ===
    Object.keys(customMetadata).length &&
  Object.entries(customMetadata).every(
    ([key, value]) => object.customMetadata[key] === value
  );

const storeAttachment = (
  client: InboundAttachmentR2Client,
  runtime: InboundAttachmentStoreRuntime,
  input: StoreInboundAttachmentsInput,
  attachment: ExtractedInboundAttachmentV1
) =>
  Effect.gen(function* () {
    const contentSha256 = yield* runtime.sha256(attachment.content).pipe(
      Effect.mapError((cause) => storeError("write", cause)),
      Effect.catchDefect((cause) => Effect.fail(storeError("write", cause)))
    );
    const metadataSha256 = yield* runtime
      .sha256(metadataBytes(attachment))
      .pipe(
        Effect.mapError((cause) => storeError("write", cause)),
        Effect.catchDefect((cause) => Effect.fail(storeError("write", cause)))
      );
    const key = `inbound/${input.inboundIngestId}/attachments/${String(
      attachment.metadata.index
    ).padStart(6, "0")}.bin`;
    const customMetadata = {
      "attachment-index": String(attachment.metadata.index),
      "attachment-metadata-sha256": metadataSha256,
      "attachment-size": String(attachment.metadata.size),
      "content-sha256": contentSha256,
      "format-version": "1",
      "inbound-ingest-id": input.inboundIngestId,
      "mailbox-id": input.mailboxId,
      "object-type": "attachment",
      "received-at": String(input.receivedAt),
    };
    const stored = yield* client
      .put(key, attachment.content, {
        contentLength: attachment.metadata.size,
        customMetadata,
        httpMetadata: { contentType: attachment.metadata.mimeType },
        onlyIf: { etagDoesNotMatch: "*" },
        sha256: contentSha256,
      })
      .pipe(
        Effect.mapError((cause) => storeError("write", cause)),
        Effect.catchDefect((cause) => Effect.fail(storeError("write", cause)))
      );

    if (stored !== null) {
      if (!objectMatches(stored, attachment, customMetadata, contentSha256)) {
        return yield* Effect.fail(
          storeError("write", new Error("Stored attachment is inconsistent"))
        );
      }
      return;
    }

    const existing = yield* client.head(key).pipe(
      Effect.mapError((cause) => storeError("head", cause)),
      Effect.catchDefect((cause) => Effect.fail(storeError("head", cause)))
    );
    if (
      existing === null ||
      !objectMatches(existing, attachment, customMetadata, contentSha256)
    ) {
      return yield* Effect.fail(
        storeError("head", new Error("Existing attachment is inconsistent"))
      );
    }
  });

/** Sequential append-only attachment writes with retry verification. */
export const InboundAttachmentStoreR2Live = Layer.effect(
  InboundAttachmentStore,
  Effect.gen(function* () {
    const client = yield* InboundAttachmentR2Client;
    const runtime = yield* InboundAttachmentStoreRuntime;

    return InboundAttachmentStore.of({
      store: (input) =>
        Effect.forEach(
          input.attachments,
          (attachment) => storeAttachment(client, runtime, input, attachment),
          { concurrency: 1, discard: true }
        ),
    });
  })
);
