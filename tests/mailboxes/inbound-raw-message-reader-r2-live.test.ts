import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import { BlobStoreError } from "#/mailboxes/errors";
import {
  InboundRawMessageReader,
  ReadInboundRawMessageInput,
} from "#/mailboxes/inbound";
import type { InboundRawMessageR2Client as InboundRawMessageR2ClientShape } from "#/mailboxes/inbound-raw-message-reader-r2-live";
import {
  InboundRawMessageR2Client,
  InboundRawMessageReaderR2Live,
} from "#/mailboxes/inbound-raw-message-reader-r2-live";

const input = Schema.decodeUnknownSync(ReadInboundRawMessageInput)({
  inboundIngestId: "ingest-1",
  mailboxId: "primary",
  rawSize: 3,
  receivedAt: 2000,
});

const metadata = {
  "format-version": "1",
  "inbound-ingest-id": "ingest-1",
  "mailbox-id": "primary",
  "object-type": "raw-message",
  "raw-size": "3",
  "received-at": "2000",
};

const runRead = (client: InboundRawMessageR2ClientShape) =>
  Effect.runPromise(
    InboundRawMessageReader.pipe(
      Effect.flatMap((reader) => reader.read(input)),
      Effect.provide(
        InboundRawMessageReaderR2Live.pipe(
          Layer.provide(
            Layer.succeed(
              InboundRawMessageR2Client,
              InboundRawMessageR2Client.of(client)
            )
          )
        )
      )
    )
  );

describe("inbound raw message R2 reader", () => {
  it("reads the canonical object after verifying metadata and size", async () => {
    let key: string | undefined;
    const raw = new Uint8Array([1, 2, 3]).buffer;

    const result = await runRead({
      get: (objectKey) => {
        key = objectKey;
        return Effect.succeed({
          arrayBuffer: () => Effect.succeed(raw),
          customMetadata: metadata,
          size: 3,
        });
      },
    });

    expect({ key, sameBuffer: result === raw }).toStrictEqual({
      key: "inbound/ingest-1/raw.eml",
      sameBuffer: true,
    });
  });

  it.each([
    ["missing object", null],
    [
      "metadata mismatch",
      {
        arrayBuffer: () => Effect.succeed(new Uint8Array(3).buffer),
        customMetadata: { ...metadata, "mailbox-id": "wrong" },
        size: 3,
      },
    ],
    [
      "object size mismatch",
      {
        arrayBuffer: () => Effect.succeed(new Uint8Array(3).buffer),
        customMetadata: metadata,
        size: 4,
      },
    ],
    [
      "body size mismatch",
      {
        arrayBuffer: () => Effect.succeed(new Uint8Array(2).buffer),
        customMetadata: metadata,
        size: 3,
      },
    ],
  ] as const)("fails on %s", async (_, object) => {
    const failure = await runRead({
      get: () => Effect.succeed(object),
    }).catch((error: unknown) => error);

    expect(failure).toMatchObject({
      _tag: "BlobStoreError",
      objectType: "raw-message",
      operation: "read",
    });
    expect(failure).toBeInstanceOf(BlobStoreError);
  });

  it.each([
    ["typed failure", Effect.fail(new Error("R2 unavailable"))],
    ["defect", Effect.die(new Error("R2 defect"))],
  ] as const)("maps an R2 get %s", async (_, get) => {
    const failure = await runRead({ get: () => get }).catch(
      (error: unknown) => error
    );

    expect(failure).toMatchObject({
      _tag: "BlobStoreError",
      message: "Failed to read inbound raw message",
      operation: "read",
    });
  });

  it("maps a body read failure", async () => {
    const failure = await runRead({
      get: () =>
        Effect.succeed({
          arrayBuffer: () => Effect.fail(new Error("body unavailable")),
          customMetadata: metadata,
          size: 3,
        }),
    }).catch((error: unknown) => error);

    expect(failure).toMatchObject({
      _tag: "BlobStoreError",
      objectType: "raw-message",
      operation: "read",
    });
  });
});
