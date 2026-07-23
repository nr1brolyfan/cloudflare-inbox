import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import type {
  InboundAttachmentR2Client as InboundAttachmentR2ClientShape,
  InboundAttachmentStoreRuntime as InboundAttachmentStoreRuntimeShape,
} from "#/modules/mailbox/adapters/r2/InboundAttachmentStoreR2";
import {
  InboundAttachmentR2Client,
  InboundAttachmentStoreR2Layer,
  InboundAttachmentStoreRuntime,
} from "#/modules/mailbox/adapters/r2/InboundAttachmentStoreR2";
import { StoreInboundAttachmentsInput } from "#/modules/mailbox/domain/MailboxInbound";
import { InboundAttachmentStore } from "#/modules/mailbox/ports/InboundAttachmentStore";
import { BlobStoreError } from "#/modules/mailbox/ports/MailboxBlobStore";

type PutOptions = Parameters<InboundAttachmentR2ClientShape["put"]>[2];

const input = Schema.decodeUnknownSync(StoreInboundAttachmentsInput)({
  attachments: [
    {
      content: new Uint8Array([1, 2, 3]),
      metadata: {
        contentId: "image-1",
        disposition: "inline",
        fileName: "image.png",
        index: 0,
        mimeType: "image/png",
        size: 3,
      },
    },
    {
      content: new Uint8Array([4, 5]),
      metadata: {
        disposition: "attachment",
        fileName: "document.pdf",
        index: 1,
        mimeType: "application/pdf",
        size: 2,
      },
    },
  ],
  inboundIngestId: "ingest-1",
  mailboxId: "primary",
  receivedAt: 2000,
});

const hashRuntime: InboundAttachmentStoreRuntimeShape = {
  sha256: (value) => {
    const bytes =
      value instanceof ArrayBuffer
        ? new Uint8Array(value)
        : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    return Effect.succeed(`hash-${[...bytes].join("-")}`);
  },
};

const objectFrom = (options: PutOptions) => ({
  contentType: options.httpMetadata.contentType,
  customMetadata: options.customMetadata,
  sha256: options.sha256,
  size: options.contentLength,
});

const runStore = (client: InboundAttachmentR2ClientShape, storeInput = input) =>
  Effect.runPromise(
    InboundAttachmentStore.pipe(
      Effect.flatMap((store) => store.store(storeInput)),
      Effect.provide(
        InboundAttachmentStoreR2Layer.pipe(
          Layer.provide(
            Layer.merge(
              Layer.succeed(
                InboundAttachmentR2Client,
                InboundAttachmentR2Client.of(client)
              ),
              Layer.succeed(
                InboundAttachmentStoreRuntime,
                InboundAttachmentStoreRuntime.of(hashRuntime)
              )
            )
          )
        )
      )
    )
  );

describe("inbound attachment R2 store", () => {
  it("stores attachments sequentially under deterministic keys", async () => {
    const writes: {
      readonly bytes: number[];
      readonly key: string;
      readonly options: PutOptions;
    }[] = [];

    await runStore({
      put: (key, content, options) => {
        writes.push({ bytes: [...content], key, options });
        return Effect.succeed(objectFrom(options));
      },
      head: () => Effect.die("head must not run"),
    });

    expect(writes.map(({ bytes, key }) => ({ bytes, key }))).toStrictEqual([
      {
        bytes: [1, 2, 3],
        key: "inbound/ingest-1/attachments/000000.bin",
      },
      {
        bytes: [4, 5],
        key: "inbound/ingest-1/attachments/000001.bin",
      },
    ]);
    expect(writes[0]?.options).toMatchObject({
      contentLength: 3,
      customMetadata: {
        "attachment-index": "0",
        "attachment-size": "3",
        "format-version": "1",
        "inbound-ingest-id": "ingest-1",
        "mailbox-id": "primary",
        "object-type": "attachment",
        "received-at": "2000",
      },
      httpMetadata: { contentType: "image/png" },
      onlyIf: { etagDoesNotMatch: "*" },
      sha256: "hash-1-2-3",
    });
    expect(writes[0]?.options.customMetadata).not.toHaveProperty("content-id");
    expect(writes[0]?.options.customMetadata).not.toHaveProperty("file-name");
  });

  it("accepts a matching immutable object after a conditional collision", async () => {
    let pending: PutOptions | undefined;
    let headKey: string | undefined;

    await runStore(
      {
        put: (_, __, options) => {
          pending = options;
          return Effect.succeed(null);
        },
        head: (key) => {
          headKey = key;
          return Effect.succeed(
            pending === undefined ? null : objectFrom(pending)
          );
        },
      },
      Schema.decodeUnknownSync(StoreInboundAttachmentsInput)({
        ...input,
        attachments: [input.attachments[0]],
      })
    );

    expect(headKey).toBe("inbound/ingest-1/attachments/000000.bin");
  });

  it("resumes safely after a partial multi-attachment write", async () => {
    const objects = new Map<string, ReturnType<typeof objectFrom>>();
    const attempts: string[] = [];
    let failSecondWrite = true;
    const client: InboundAttachmentR2ClientShape = {
      put: (key, _, options) => {
        attempts.push(key);
        if (objects.has(key)) {
          return Effect.succeed(null);
        }
        if (key.endsWith("000001.bin") && failSecondWrite) {
          failSecondWrite = false;
          return Effect.fail(new Error("R2 unavailable"));
        }
        const object = objectFrom(options);
        objects.set(key, object);
        return Effect.succeed(object);
      },
      head: (key) => Effect.succeed(objects.get(key) ?? null),
    };

    const firstFailure = await runStore(client).catch(
      (error: unknown) => error
    );
    await runStore(client);

    expect({
      attempts,
      firstFailure,
      storedKeys: [...objects.keys()],
    }).toMatchObject({
      attempts: [
        "inbound/ingest-1/attachments/000000.bin",
        "inbound/ingest-1/attachments/000001.bin",
        "inbound/ingest-1/attachments/000000.bin",
        "inbound/ingest-1/attachments/000001.bin",
      ],
      firstFailure: { _tag: "BlobStoreError", operation: "write" },
      storedKeys: [
        "inbound/ingest-1/attachments/000000.bin",
        "inbound/ingest-1/attachments/000001.bin",
      ],
    });
  });

  it("fails closed when the colliding object does not match", async () => {
    const failure = await runStore(
      {
        put: () => Effect.succeed(null),
        head: () =>
          Effect.succeed({
            contentType: "image/png",
            customMetadata: {},
            sha256: "wrong",
            size: 3,
          }),
      },
      Schema.decodeUnknownSync(StoreInboundAttachmentsInput)({
        ...input,
        attachments: [input.attachments[0]],
      })
    ).catch((error: unknown) => error);

    expect(failure).toMatchObject({
      _tag: "BlobStoreError",
      objectType: "attachment",
      operation: "head",
    });
    expect(failure).toBeInstanceOf(BlobStoreError);
  });

  it("performs no R2 calls for a message without attachments", async () => {
    let calls = 0;

    await runStore(
      {
        put: () => {
          calls += 1;
          return Effect.die("put must not run");
        },
        head: () => {
          calls += 1;
          return Effect.die("head must not run");
        },
      },
      Schema.decodeUnknownSync(StoreInboundAttachmentsInput)({
        ...input,
        attachments: [],
      })
    );

    expect(calls).toBe(0);
  });

  it.each([
    ["typed failure", Effect.fail(new Error("R2 unavailable"))],
    ["defect", Effect.die(new Error("R2 defect"))],
  ] as const)("maps an R2 PUT %s", async (_, put) => {
    const failure = await runStore(
      {
        put: () => put,
        head: () => Effect.die("head must not run"),
      },
      Schema.decodeUnknownSync(StoreInboundAttachmentsInput)({
        ...input,
        attachments: [input.attachments[0]],
      })
    ).catch((error: unknown) => error);

    expect(failure).toMatchObject({
      _tag: "BlobStoreError",
      objectType: "attachment",
      operation: "write",
    });
  });
});
