import { RuntimeContext } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { RawMessagesBucket } from "../infra/resources";
import {
  InboundMimeParser,
  InboundRawMessageReader,
  InboundRawStoredCheckpointV1,
  InboundWorkflowParamsV1,
  InboundWorkflowResultV1,
} from "../mailboxes/inbound";
import {
  InboundMimeParserConfigLive,
  InboundMimeParserPostalMimeLive,
} from "../mailboxes/inbound-mime-parser-postal-live";
import {
  InboundRawMessageR2Client,
  InboundRawMessageReaderR2Live,
} from "../mailboxes/inbound-raw-message-reader-r2-live";

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

    yield* Cloudflare.Workflows.task(
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

    return yield* Schema.decodeUnknownEffect(InboundWorkflowResultV1)({
      formatVersion: 1,
      inboundIngestId: params.inboundIngestId,
      mailboxId: params.mailboxId,
      status: "parsing",
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
  const mimeParserLive = InboundMimeParserPostalMimeLive.pipe(
    Layer.provide(InboundMimeParserConfigLive)
  );
  const processingLive = Layer.merge(rawMessageReaderLive, mimeParserLive);
  const program = yield* inboundWorkflowProgram;

  return (input: unknown) =>
    program(input).pipe(Effect.provide(processingLive));
});

export default class InboundWorkflow extends Cloudflare.Workflow<InboundWorkflow>()(
  "InboundWorkflow",
  inboundWorkflowImplementation
) {}
