import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  InboundAttachmentBlobReaderR2Layer,
  InboundAttachmentR2ReadClient,
} from "#/modules/mailbox/adapters/r2/InboundAttachmentBlobReaderR2";
import type { InboundAttachmentR2ReadObject } from "#/modules/mailbox/adapters/r2/InboundAttachmentBlobReaderR2";
import { InboundAttachmentStoreRuntimeSystemLayer } from "#/modules/mailbox/adapters/r2/InboundAttachmentStoreR2";
import { ParsedInboundAttachmentV1 } from "#/modules/mailbox/domain/MailboxInbound";
import { InboundAttachmentBlobLocation } from "#/modules/mailbox/domain/MailboxMessage";
import { InboundAttachmentBlobReader } from "#/modules/mailbox/ports/InboundAttachmentBlobReader";

const location = Schema.decodeUnknownSync(InboundAttachmentBlobLocation)({
  attachmentId: "attachment-1",
  disposition: "attachment",
  fileName: "brief.pdf",
  folderId: "inbox",
  inboundIngestId: "ingest-1",
  mailboxId: "primary",
  messageId: "message-1",
  mimeType: "application/pdf",
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

const validObject = async (): Promise<InboundAttachmentR2ReadObject> => {
  const bytes = new Uint8Array([1, 2, 3]);
  const sha256 = await checksum(bytes);
  const metadataSha256 = await checksum(
    new TextEncoder().encode(
      JSON.stringify(
        Schema.encodeSync(ParsedInboundAttachmentV1)(
          Schema.decodeUnknownSync(ParsedInboundAttachmentV1)({
            disposition: "attachment",
            fileName: "brief.pdf",
            index: 2,
            mimeType: "application/pdf",
            size: 3,
          })
        )
      )
    )
  );
  return {
    arrayBuffer: () => Effect.succeed(new Uint8Array(bytes).buffer),
    contentType: "application/pdf",
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
  };
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

const expectStorageMismatch = (object: InboundAttachmentR2ReadObject | null) =>
  expect(runRead(() => Effect.succeed(object))).rejects.toMatchObject({
    _tag: "BlobStoreError",
    objectType: "attachment",
    retryable: false,
  });

describe("inbound attachment R2 reader", () => {
  it("reads exact ordinary attachment bytes without a content ID", async () => {
    let key: string | undefined;
    const object = await validObject();
    const result = await runRead((value) => {
      key = value;
      return Effect.succeed(object);
    });

    expect(key).toBe("inbound/ingest-1/attachments/000002.bin");
    expect(result).toStrictEqual(new Uint8Array([1, 2, 3]));
  });

  it("fails closed when the exact object is missing", async () => {
    expect.assertions(1);
    await expectStorageMismatch(null);
  });

  it("fails closed for mismatched custom metadata", async () => {
    expect.assertions(1);
    const object = await validObject();
    await expectStorageMismatch({
      ...object,
      customMetadata: {
        ...object.customMetadata,
        "attachment-index": "3",
      },
    });
  });

  it("fails closed for a MIME mismatch", async () => {
    expect.assertions(1);
    const object = await validObject();
    await expectStorageMismatch({ ...object, contentType: "text/plain" });
  });

  it("fails closed for an object size mismatch", async () => {
    expect.assertions(1);
    const object = await validObject();
    await expectStorageMismatch({ ...object, size: 4 });
  });

  it("fails closed for an object hash mismatch", async () => {
    expect.assertions(1);
    const object = await validObject();
    await expectStorageMismatch({ ...object, sha256: "a".repeat(64) });
  });

  it("fails closed for a downloaded content hash mismatch", async () => {
    expect.assertions(1);
    const object = await validObject();
    await expectStorageMismatch({
      ...object,
      arrayBuffer: () => Effect.succeed(new Uint8Array([1, 2, 4]).buffer),
    });
  });
});
