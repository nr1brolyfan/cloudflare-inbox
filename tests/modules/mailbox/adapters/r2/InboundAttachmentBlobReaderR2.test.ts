import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  InboundAttachmentBlobReaderR2Layer,
  InboundAttachmentR2ReadClient,
} from "#/modules/mailbox/adapters/r2/InboundAttachmentBlobReaderR2";
import { InboundAttachmentStoreRuntimeSystemLayer } from "#/modules/mailbox/adapters/r2/InboundAttachmentStoreR2";
import { ParsedInboundAttachmentV1 } from "#/modules/mailbox/domain/MailboxInbound";
import { AttachmentBlobLocation } from "#/modules/mailbox/domain/MailboxMessage";
import { InboundAttachmentBlobReader } from "#/modules/mailbox/ports/InboundAttachmentBlobReader";

const location = Schema.decodeUnknownSync(AttachmentBlobLocation)({
  attachmentId: "attachment-1",
  contentId: "image-1",
  disposition: "inline",
  fileName: "image.png",
  folderId: "inbox",
  inboundIngestId: "ingest-1",
  mailboxId: "primary",
  messageId: "message-1",
  mimeType: "image/png",
  receivedAt: 1000,
  size: 3,
  sourceIndex: 2,
});

const checksum = async (bytes: Uint8Array) => {
  const value = await crypto.subtle.digest(
    "SHA-256",
    new Uint8Array(bytes).buffer
  );
  return [...new Uint8Array(value)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

const runRead = (get: InboundAttachmentR2ReadClient["get"]) =>
  Effect.runPromise(
    InboundAttachmentBlobReader.pipe(
      Effect.flatMap((reader) => reader.read(location)),
      Effect.provide(
        InboundAttachmentBlobReaderR2Layer.pipe(
          Layer.provide(
            Layer.merge(
              Layer.succeed(
                InboundAttachmentR2ReadClient,
                InboundAttachmentR2ReadClient.of({ get })
              ),
              InboundAttachmentStoreRuntimeSystemLayer
            )
          )
        )
      )
    )
  );

describe("inbound attachment R2 reader", () => {
  it("derives the key and verifies metadata, size, MIME, and checksum", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const sha256 = await checksum(bytes);
    const metadataSha256 = await checksum(
      new TextEncoder().encode(
        JSON.stringify(
          Schema.encodeSync(ParsedInboundAttachmentV1)(
            Schema.decodeUnknownSync(ParsedInboundAttachmentV1)({
              contentId: "image-1",
              disposition: "inline",
              fileName: "image.png",
              index: 2,
              mimeType: "image/png",
              size: 3,
            })
          )
        )
      )
    );
    let key: string | undefined;
    const result = await runRead((value) => {
      key = value;
      return Effect.succeed({
        arrayBuffer: () => Effect.succeed(new Uint8Array(bytes).buffer),
        contentType: "image/png",
        customMetadata: {
          "attachment-index": "2",
          "attachment-metadata-sha256": metadataSha256,
          "attachment-size": "3",
          "content-sha256": sha256,
          "format-version": "1",
          "inbound-ingest-id": "ingest-1",
          "mailbox-id": "primary",
          "object-type": "attachment",
          "received-at": "1000",
        },
        sha256,
        size: 3,
      });
    });

    expect(key).toBe("inbound/ingest-1/attachments/000002.bin");
    expect(result).toStrictEqual(bytes);
  });

  it("fails closed for inconsistent object metadata", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const sha256 = await checksum(bytes);
    await expect(
      runRead(() =>
        Effect.succeed({
          arrayBuffer: () => Effect.succeed(new Uint8Array(bytes).buffer),
          contentType: "image/png",
          customMetadata: {
            "attachment-index": "2",
            "attachment-metadata-sha256": "a".repeat(64),
            "attachment-size": "3",
            "content-sha256": sha256,
            "format-version": "1",
            "inbound-ingest-id": "ingest-1",
            "mailbox-id": "primary",
            "object-type": "attachment",
            "received-at": "1000",
          },
          sha256,
          size: 3,
        })
      )
    ).rejects.toMatchObject({
      _tag: "BlobStoreError",
      objectType: "attachment",
      retryable: false,
    });
  });
});
