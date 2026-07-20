import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { Sha256Digest } from "./core";
import type { DraftAttachmentReservation } from "./draft-attachments";
import { DraftAttachmentBlobStore } from "./draft-attachments";
import { BlobStoreError } from "./errors";

interface DraftAttachmentPutOptions {
  readonly contentLength: number;
  readonly customMetadata: Readonly<Record<string, string>>;
  readonly httpMetadata: { readonly contentType: string };
  readonly onlyIf: { readonly etagDoesNotMatch: "*" };
  readonly sha256: string;
}

export interface DraftAttachmentR2Object {
  readonly contentType?: string;
  readonly customMetadata: Readonly<Record<string, string>>;
  readonly sha256?: string;
  readonly size: number;
}

export interface DraftAttachmentR2Client {
  readonly head: (
    key: string
  ) => Effect.Effect<DraftAttachmentR2Object | null, unknown>;
  readonly put: (
    key: string,
    content: Uint8Array,
    options: DraftAttachmentPutOptions
  ) => Effect.Effect<DraftAttachmentR2Object | null, unknown>;
}

export const DraftAttachmentR2Client = Context.Service<DraftAttachmentR2Client>(
  "cloudflare-inbox/DraftAttachmentR2Client"
);

export interface DraftAttachmentBlobRuntime {
  readonly sha256: (value: Uint8Array) => Effect.Effect<string, unknown>;
}

export const DraftAttachmentBlobRuntime =
  Context.Service<DraftAttachmentBlobRuntime>(
    "cloudflare-inbox/DraftAttachmentBlobRuntime"
  );

const toHex = (value: ArrayBuffer) =>
  [...new Uint8Array(value)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

export const DraftAttachmentBlobRuntimeLive = Layer.succeed(
  DraftAttachmentBlobRuntime,
  DraftAttachmentBlobRuntime.of({
    sha256: (value) =>
      Effect.tryPromise({
        try: () =>
          crypto.subtle.digest("SHA-256", Uint8Array.from(value).buffer),
        catch: (cause) => cause,
      }).pipe(Effect.map(toHex)),
  })
);

export const draftAttachmentObjectKey = (attachmentId: string) =>
  `draft-attachments/${attachmentId}.bin`;

const blobError = (
  operation: "head" | "write",
  cause: unknown,
  retryable = true
) =>
  new BlobStoreError({
    cause,
    message: "Failed to store draft attachment",
    objectType: "attachment",
    operation,
    retryable,
  });

const metadataFor = (
  reservation: DraftAttachmentReservation,
  contentSha256: string
) => ({
  "attachment-id": reservation.id,
  "attachment-size": String(reservation.size),
  "content-sha256": contentSha256,
  "draft-id": reservation.draftId,
  "format-version": "1",
  "mailbox-id": reservation.mailboxId,
  "object-type": "draft-attachment",
  "reservation-expires-at": String(reservation.expiresAt),
});

const objectMatches = (
  object: DraftAttachmentR2Object,
  reservation: DraftAttachmentReservation,
  contentSha256: string,
  customMetadata: Readonly<Record<string, string>>
) =>
  object.size === reservation.size &&
  object.contentType === reservation.mimeType &&
  object.sha256 === contentSha256 &&
  Object.keys(object.customMetadata).length ===
    Object.keys(customMetadata).length &&
  Object.entries(customMetadata).every(
    ([key, value]) => object.customMetadata[key] === value
  );

export const DraftAttachmentBlobStoreR2Live = Layer.effect(
  DraftAttachmentBlobStore,
  Effect.gen(function* () {
    const client = yield* DraftAttachmentR2Client;
    const runtime = yield* DraftAttachmentBlobRuntime;

    return DraftAttachmentBlobStore.of({
      store: ({ content, reservation }) =>
        Effect.gen(function* () {
          const encodedHash = yield* runtime.sha256(content).pipe(
            Effect.mapError((cause) => blobError("write", cause)),
            Effect.catchDefect((cause) =>
              Effect.fail(blobError("write", cause))
            )
          );
          const contentSha256 = yield* Schema.decodeUnknownEffect(Sha256Digest)(
            encodedHash
          ).pipe(Effect.mapError((cause) => blobError("write", cause, false)));
          const key = draftAttachmentObjectKey(reservation.id);
          const customMetadata = metadataFor(reservation, contentSha256);
          const stored = yield* client
            .put(key, content, {
              contentLength: reservation.size,
              customMetadata,
              httpMetadata: { contentType: reservation.mimeType },
              onlyIf: { etagDoesNotMatch: "*" },
              sha256: contentSha256,
            })
            .pipe(
              Effect.mapError((cause) => blobError("write", cause)),
              Effect.catchDefect((cause) =>
                Effect.fail(blobError("write", cause))
              )
            );
          if (stored !== null) {
            return objectMatches(
              stored,
              reservation,
              contentSha256,
              customMetadata
            )
              ? contentSha256
              : yield* Effect.fail(
                  blobError(
                    "write",
                    new Error("Stored draft attachment is inconsistent"),
                    false
                  )
                );
          }
          const existing = yield* client.head(key).pipe(
            Effect.mapError((cause) => blobError("head", cause)),
            Effect.catchDefect((cause) => Effect.fail(blobError("head", cause)))
          );
          if (
            existing === null ||
            !objectMatches(existing, reservation, contentSha256, customMetadata)
          ) {
            return yield* Effect.fail(
              blobError(
                "head",
                new Error("Existing draft attachment is inconsistent"),
                false
              )
            );
          }
          return contentSha256;
        }),
    });
  })
);

export const DraftAttachmentBlobStoreR2WithRuntimeLive =
  DraftAttachmentBlobStoreR2Live.pipe(
    Layer.provide(DraftAttachmentBlobRuntimeLive)
  );
