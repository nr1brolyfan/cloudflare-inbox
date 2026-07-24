/* oxlint-disable max-classes-per-file -- R2 client and hashing runtime are cohesive adapter internals. */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { BlobStoreError } from "#/modules/mailbox/ports/MailboxBlobStore";
import { OutboundDraftAttachmentBlobReader } from "#/modules/mailbox/ports/OutboundDraftAttachmentBlobReader";

import {
  draftAttachmentObjectKey,
  draftAttachmentRequiredMetadata,
} from "./DraftAttachmentR2Object";

export interface OutboundDraftAttachmentR2ReadObject {
  readonly arrayBuffer: () => Effect.Effect<ArrayBuffer, unknown>;
  readonly contentType?: string;
  readonly customMetadata: Readonly<Record<string, string>>;
  readonly sha256?: string;
  readonly size: number;
}

export interface OutboundDraftAttachmentR2ReadClientService {
  readonly get: (
    key: string
  ) => Effect.Effect<OutboundDraftAttachmentR2ReadObject | null, unknown>;
}

export class OutboundDraftAttachmentR2ReadClient extends Context.Service<
  OutboundDraftAttachmentR2ReadClient,
  OutboundDraftAttachmentR2ReadClientService
>()("cloudflare-inbox/OutboundDraftAttachmentR2ReadClient") {}

interface OutboundDraftAttachmentReaderRuntimeService {
  readonly sha256: (value: Uint8Array) => Effect.Effect<string, unknown>;
}

class OutboundDraftAttachmentReaderRuntime extends Context.Service<
  OutboundDraftAttachmentReaderRuntime,
  OutboundDraftAttachmentReaderRuntimeService
>()("cloudflare-inbox/OutboundDraftAttachmentReaderRuntime") {}

const toHex = (value: ArrayBuffer) =>
  [...new Uint8Array(value)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

const OutboundDraftAttachmentReaderRuntimeWebCryptoLayer = Layer.succeed(
  OutboundDraftAttachmentReaderRuntime,
  OutboundDraftAttachmentReaderRuntime.of({
    sha256: (value) =>
      Effect.tryPromise({
        try: () =>
          crypto.subtle.digest("SHA-256", Uint8Array.from(value).buffer),
        catch: (cause) => cause,
      }).pipe(Effect.map(toHex)),
  })
);

const readError = (cause: unknown, retryable: boolean) =>
  new BlobStoreError({
    cause,
    message: "Failed to read outbound draft attachment",
    objectType: "attachment",
    operation: "read",
    retryable,
  });

/** Reads a frozen draft locator and fails closed on R2 bytes or metadata drift. */
export const OutboundDraftAttachmentBlobReaderR2Layer = Layer.effect(
  OutboundDraftAttachmentBlobReader,
  Effect.gen(function* () {
    const client = yield* OutboundDraftAttachmentR2ReadClient;
    const runtime = yield* OutboundDraftAttachmentReaderRuntime;

    return OutboundDraftAttachmentBlobReader.of({
      read: (location) =>
        Effect.gen(function* () {
          const object = yield* client
            .get(draftAttachmentObjectKey(location.draftAttachmentId))
            .pipe(
              Effect.mapError((cause) => readError(cause, true)),
              Effect.catchDefect((cause) => Effect.fail(readError(cause, true)))
            );
          if (object === null) {
            return yield* Effect.fail(
              readError(new Error("Outbound attachment was not found"), false)
            );
          }

          const expectedMetadata = draftAttachmentRequiredMetadata({
            attachmentId: location.draftAttachmentId,
            contentSha256: location.contentSha256,
            mailboxId: location.mailboxId,
            size: location.size,
          });
          const metadataMatches = Object.entries(expectedMetadata).every(
            ([key, value]) => object.customMetadata[key] === value
          );
          if (
            !metadataMatches ||
            object.contentType !== location.mimeType ||
            object.sha256 !== location.contentSha256 ||
            object.size !== location.size
          ) {
            return yield* Effect.fail(
              readError(
                new Error("Outbound attachment metadata is inconsistent"),
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
                new Error("Outbound attachment size is inconsistent"),
                false
              )
            );
          }
          const bytes = new Uint8Array(buffer);
          const actualSha256 = yield* runtime.sha256(bytes).pipe(
            Effect.mapError((cause) => readError(cause, true)),
            Effect.catchDefect((cause) => Effect.fail(readError(cause, true)))
          );
          if (actualSha256 !== location.contentSha256) {
            return yield* Effect.fail(
              readError(
                new Error("Outbound attachment checksum is inconsistent"),
                false
              )
            );
          }
          return bytes;
        }),
    });
  })
).pipe(Layer.provide(OutboundDraftAttachmentReaderRuntimeWebCryptoLayer));
