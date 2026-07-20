import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import { OutboundDraftAttachmentLocation } from "#/mailboxes/outbound-dispatch-snapshot";
import {
  OutboundDraftAttachmentBlobReader,
  OutboundDraftAttachmentBlobReaderR2Live,
  OutboundDraftAttachmentR2ReadClient,
  OutboundDraftAttachmentReaderRuntimeLive,
} from "#/mailboxes/outbound-draft-attachment-reader-r2-live";

const bytes = new Uint8Array([1, 2, 3]);
const checksum = async (value: Uint8Array) => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    Uint8Array.from(value).buffer
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

const runRead = (
  location: OutboundDraftAttachmentLocation,
  get: OutboundDraftAttachmentR2ReadClient["get"]
) =>
  Effect.runPromise(
    OutboundDraftAttachmentBlobReader.pipe(
      Effect.flatMap((reader) => reader.read(location)),
      Effect.provide(
        OutboundDraftAttachmentBlobReaderR2Live.pipe(
          Layer.provide(
            Layer.merge(
              Layer.succeed(
                OutboundDraftAttachmentR2ReadClient,
                OutboundDraftAttachmentR2ReadClient.of({ get })
              ),
              OutboundDraftAttachmentReaderRuntimeLive
            )
          )
        )
      )
    )
  );

describe("outbound draft attachment R2 reader", () => {
  it("derives the immutable key and verifies bytes and storage metadata", async () => {
    const contentSha256 = await checksum(bytes);
    const location = Schema.decodeUnknownSync(OutboundDraftAttachmentLocation)({
      contentSha256,
      draftAttachmentId: "attachment-1",
      mailboxId: "mailbox-a",
      mimeType: "text/plain",
      size: 3,
    });
    let key: string | undefined;
    const result = await runRead(location, (value) => {
      key = value;
      return Effect.succeed({
        arrayBuffer: () => Effect.succeed(Uint8Array.from(bytes).buffer),
        contentType: "text/plain",
        customMetadata: {
          "attachment-id": "attachment-1",
          "attachment-size": "3",
          "content-sha256": contentSha256,
          "draft-id": "draft-1",
          "format-version": "1",
          "mailbox-id": "mailbox-a",
          "object-type": "draft-attachment",
        },
        sha256: contentSha256,
        size: 3,
      });
    });

    expect(key).toBe("draft-attachments/attachment-1.bin");
    expect(result).toStrictEqual(bytes);
  });

  it("rejects same-size bytes that do not match the frozen content digest", async () => {
    const contentSha256 = await checksum(bytes);
    const location = Schema.decodeUnknownSync(OutboundDraftAttachmentLocation)({
      contentSha256,
      draftAttachmentId: "attachment-1",
      mailboxId: "mailbox-a",
      mimeType: "text/plain",
      size: 3,
    });

    await expect(
      runRead(location, () =>
        Effect.succeed({
          arrayBuffer: () => Effect.succeed(new Uint8Array([3, 2, 1]).buffer),
          contentType: "text/plain",
          customMetadata: {
            "attachment-id": "attachment-1",
            "attachment-size": "3",
            "content-sha256": contentSha256,
            "format-version": "1",
            "mailbox-id": "mailbox-a",
            "object-type": "draft-attachment",
          },
          sha256: contentSha256,
          size: 3,
        })
      )
    ).rejects.toMatchObject({
      _tag: "BlobStoreError",
      operation: "read",
      retryable: false,
    });
  });

  it("rejects tampered mailbox metadata before returning bytes", async () => {
    const contentSha256 = await checksum(bytes);
    const location = Schema.decodeUnknownSync(OutboundDraftAttachmentLocation)({
      contentSha256,
      draftAttachmentId: "attachment-1",
      mailboxId: "mailbox-a",
      mimeType: "text/plain",
      size: 3,
    });

    await expect(
      runRead(location, () =>
        Effect.succeed({
          arrayBuffer: () => Effect.die("bytes must not be read"),
          contentType: "text/plain",
          customMetadata: {
            "attachment-id": "attachment-1",
            "attachment-size": "3",
            "content-sha256": contentSha256,
            "format-version": "1",
            "mailbox-id": "mailbox-b",
            "object-type": "draft-attachment",
          },
          sha256: contentSha256,
          size: 3,
        })
      )
    ).rejects.toMatchObject({
      _tag: "BlobStoreError",
      operation: "read",
      retryable: false,
    });
  });
});
