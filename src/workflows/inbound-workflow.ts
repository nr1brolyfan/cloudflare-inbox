import { RuntimeContext } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { RawMessagesBucket } from "../infra/resources";
import { InboundManifestMismatchError } from "../mailboxes/errors";
import type { ParsedInboundMessageV1 as ParsedInboundMessageV1Type } from "../mailboxes/inbound";
import {
  InboundAttachmentStore,
  InboundAttachmentsStoredCheckpointV1,
  InboundMimeAttachmentExtractor,
  InboundMimeParser,
  InboundRawMessageReader,
  InboundRawStoredCheckpointV1,
  InboundWorkflowParamsV1,
  InboundWorkflowResultV1,
  ParsedInboundMessageV1,
} from "../mailboxes/inbound";
import {
  InboundAttachmentR2Client,
  InboundAttachmentStoreR2Live,
  InboundAttachmentStoreRuntimeLive,
} from "../mailboxes/inbound-attachment-store-r2-live";
import {
  InboundMimeAttachmentExtractorPostalMimeLive,
  InboundMimeParserConfigLive,
  InboundMimeParserPostalMimeLive,
} from "../mailboxes/inbound-mime-parser-postal-live";
import {
  InboundRawMessageR2Client,
  InboundRawMessageReaderR2Live,
} from "../mailboxes/inbound-raw-message-reader-r2-live";

const encodedManifest = (manifest: ParsedInboundMessageV1Type) =>
  JSON.stringify(Schema.encodeSync(ParsedInboundMessageV1)(manifest));

const checksumHex = (value: ArrayBuffer) =>
  [...new Uint8Array(value)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

const attachmentObject = (object: {
  readonly checksums: { readonly sha256?: ArrayBuffer };
  readonly customMetadata?: Record<string, string>;
  readonly httpMetadata?: { readonly contentType?: string };
  readonly size: number;
}) => ({
  contentType: object.httpMetadata?.contentType,
  customMetadata: object.customMetadata ?? {},
  sha256:
    object.checksums.sha256 === undefined
      ? undefined
      : checksumHex(object.checksums.sha256),
  size: object.size,
});

export const inboundWorkflowProgram = Effect.succeed((input: unknown) =>
  Effect.gen(function* () {
    const params = yield* Schema.decodeUnknownEffect(InboundWorkflowParamsV1)(
      input
    ).pipe(Effect.orDie);
    const event = yield* Cloudflare.Workflows.WorkflowEvent;

    if (event.instanceId !== params.inboundIngestId) {
      return yield* Effect.die(
        new Error("Inbound Workflow instance ID does not match its ingest ID")
      );
    }

    const rawStored = yield* Schema.decodeUnknownEffect(
      InboundRawStoredCheckpointV1
    )({
      formatVersion: 1,
      inboundIngestId: params.inboundIngestId,
      mailboxId: params.mailboxId,
      status: "raw_stored",
    }).pipe(Effect.orDie);

    yield* Cloudflare.Workflows.task(
      "record-raw-stored",
      Effect.succeed(rawStored)
    );

    const parsed = yield* Cloudflare.Workflows.task(
      "parse-raw-mime",
      Effect.gen(function* () {
        const reader = yield* InboundRawMessageReader;
        const parser = yield* InboundMimeParser;
        const raw = yield* reader.read({
          inboundIngestId: params.inboundIngestId,
          mailboxId: params.mailboxId,
          rawSize: params.envelope.rawSize,
          receivedAt: params.receivedAt,
        });
        return yield* parser.parse(raw);
      }).pipe(Effect.orDie)
    );

    yield* Cloudflare.Workflows.task(
      "store-inbound-attachments",
      Effect.gen(function* () {
        const reader = yield* InboundRawMessageReader;
        const extractor = yield* InboundMimeAttachmentExtractor;
        const store = yield* InboundAttachmentStore;
        const raw = yield* reader.read({
          inboundIngestId: params.inboundIngestId,
          mailboxId: params.mailboxId,
          rawSize: params.envelope.rawSize,
          receivedAt: params.receivedAt,
        });
        const extracted = yield* extractor.extract(raw);
        if (encodedManifest(parsed) !== encodedManifest(extracted.manifest)) {
          return yield* Effect.fail(
            new InboundManifestMismatchError({
              message: "Reparsed inbound MIME manifest does not match",
            })
          );
        }
        yield* store.store({
          attachments: extracted.attachments,
          inboundIngestId: params.inboundIngestId,
          mailboxId: params.mailboxId,
          receivedAt: params.receivedAt,
        });
        return yield* Schema.decodeUnknownEffect(
          InboundAttachmentsStoredCheckpointV1
        )({
          attachmentCount: extracted.attachments.length,
          formatVersion: 1,
          inboundIngestId: params.inboundIngestId,
          mailboxId: params.mailboxId,
          status: "attachments_stored",
        });
      }).pipe(Effect.orDie)
    );

    return yield* Schema.decodeUnknownEffect(InboundWorkflowResultV1)({
      formatVersion: 1,
      inboundIngestId: params.inboundIngestId,
      mailboxId: params.mailboxId,
      status: "attachments_stored",
    }).pipe(Effect.orDie);
  })
);

export const inboundWorkflowImplementation = Effect.gen(function* () {
  const rawMessages = yield* Cloudflare.R2.ReadWriteBucket(RawMessagesBucket);
  const rawMessageClientLive = Layer.succeed(
    InboundRawMessageR2Client,
    InboundRawMessageR2Client.of({
      get: (key) =>
        rawMessages.get(key).pipe(
          Effect.provide(RuntimeContext.phantom),
          Effect.map((object) =>
            object === null
              ? null
              : {
                  arrayBuffer: object.arrayBuffer,
                  customMetadata: object.customMetadata ?? {},
                  size: object.size,
                }
          )
        ),
    })
  );
  const rawMessageReaderLive = InboundRawMessageReaderR2Live.pipe(
    Layer.provide(rawMessageClientLive)
  );
  const attachmentClientLive = Layer.succeed(
    InboundAttachmentR2Client,
    InboundAttachmentR2Client.of({
      put: (key, content, options) =>
        rawMessages.put(key, content, options).pipe(
          Effect.provide(RuntimeContext.phantom),
          Effect.map((object) =>
            object === null ? null : attachmentObject(object)
          )
        ),
      head: (key) =>
        rawMessages.head(key).pipe(
          Effect.provide(RuntimeContext.phantom),
          Effect.map((object) =>
            object === null ? null : attachmentObject(object)
          )
        ),
    })
  );
  const attachmentStoreLive = InboundAttachmentStoreR2Live.pipe(
    Layer.provide(
      Layer.merge(attachmentClientLive, InboundAttachmentStoreRuntimeLive)
    )
  );
  const mimeParserLive = InboundMimeParserPostalMimeLive.pipe(
    Layer.provide(InboundMimeParserConfigLive)
  );
  const attachmentExtractorLive =
    InboundMimeAttachmentExtractorPostalMimeLive.pipe(
      Layer.provide(InboundMimeParserConfigLive)
    );
  const processingLive = Layer.mergeAll(
    rawMessageReaderLive,
    mimeParserLive,
    attachmentExtractorLive,
    attachmentStoreLive
  );
  const program = yield* inboundWorkflowProgram;

  return (input: unknown) =>
    program(input).pipe(Effect.provide(processingLive));
});

export default class InboundWorkflow extends Cloudflare.Workflow<InboundWorkflow>()(
  "InboundWorkflow",
  inboundWorkflowImplementation
) {}
