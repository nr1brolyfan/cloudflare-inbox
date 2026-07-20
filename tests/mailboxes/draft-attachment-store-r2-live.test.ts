import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import type {
  DraftAttachmentBlobRuntime as DraftAttachmentBlobRuntimeShape,
  DraftAttachmentR2Client as DraftAttachmentR2ClientShape,
} from "#/mailboxes/draft-attachment-store-r2-live";
import {
  DraftAttachmentBlobRuntime,
  DraftAttachmentBlobStoreR2Live,
  DraftAttachmentR2Client,
} from "#/mailboxes/draft-attachment-store-r2-live";
import {
  DraftAttachmentBlobStore,
  DraftAttachmentReservationSchema,
} from "#/mailboxes/draft-attachments";

type PutOptions = Parameters<DraftAttachmentR2ClientShape["put"]>[2];

const reservation = Schema.decodeUnknownSync(DraftAttachmentReservationSchema)({
  createdAt: 1000,
  draftId: "draft-1",
  expiresAt: 901_000,
  fileName: "brief.pdf",
  id: "attachment-1",
  mailboxId: "primary",
  mimeType: "application/pdf",
  size: 3,
  status: "reserved",
});
const digest = "a".repeat(64);
const runtime: DraftAttachmentBlobRuntimeShape = {
  sha256: () => Effect.succeed(digest),
};
const objectFrom = (options: PutOptions) => ({
  contentType: options.httpMetadata.contentType,
  customMetadata: options.customMetadata,
  sha256: options.sha256,
  size: options.contentLength,
});
const runStore = (client: DraftAttachmentR2ClientShape) =>
  Effect.runPromise(
    DraftAttachmentBlobStore.pipe(
      Effect.flatMap((store) =>
        store.store({ content: new Uint8Array([1, 2, 3]), reservation })
      ),
      Effect.provide(
        DraftAttachmentBlobStoreR2Live.pipe(
          Layer.provide(
            Layer.merge(
              Layer.succeed(
                DraftAttachmentR2Client,
                DraftAttachmentR2Client.of(client)
              ),
              Layer.succeed(
                DraftAttachmentBlobRuntime,
                DraftAttachmentBlobRuntime.of(runtime)
              )
            )
          )
        )
      )
    )
  );

describe("draft attachment R2 store", () => {
  it("writes immutable bytes under an opaque attachment key", async () => {
    let write:
      | {
          readonly bytes: readonly number[];
          readonly key: string;
          readonly options: PutOptions;
        }
      | undefined;
    const result = await runStore({
      head: () => Effect.die("head must not run"),
      put: (key, content, options) => {
        write = { bytes: [...content], key, options };
        return Effect.succeed(objectFrom(options));
      },
    });

    expect(result).toBe(digest);
    expect(write).toMatchObject({
      bytes: [1, 2, 3],
      key: "draft-attachments/attachment-1.bin",
      options: {
        contentLength: 3,
        customMetadata: {
          "attachment-id": "attachment-1",
          "attachment-size": "3",
          "content-sha256": digest,
          "draft-id": "draft-1",
          "format-version": "1",
          "mailbox-id": "primary",
          "object-type": "draft-attachment",
          "reservation-expires-at": "901000",
        },
        httpMetadata: { contentType: "application/pdf" },
        onlyIf: { etagDoesNotMatch: "*" },
        sha256: digest,
      },
    });
    expect(write?.options.customMetadata).not.toHaveProperty("file-name");
  });

  it("accepts only an exactly matching object after a write collision", async () => {
    let options: PutOptions | undefined;
    await runStore({
      put: (_, __, value) => {
        options = value;
        return Effect.succeed(null);
      },
      head: () =>
        Effect.succeed(options === undefined ? null : objectFrom(options)),
    });

    const failure = await runStore({
      put: () => Effect.succeed(null),
      head: () =>
        Effect.succeed({
          contentType: "application/pdf",
          customMetadata: {},
          sha256: digest,
          size: 3,
        }),
    }).catch((error: unknown) => error);
    expect(failure).toMatchObject({
      _tag: "BlobStoreError",
      operation: "head",
      retryable: false,
    });
  });
});
