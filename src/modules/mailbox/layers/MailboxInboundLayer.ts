import * as Layer from "effect/Layer";

import {
  InboundMessageCommitterDoLayer,
  InboundProcessingRecorderDoLayer,
} from "#/modules/mailbox/adapters/durable-object/MailboxInboundRepositoryDo";
import {
  InboundMimeAttachmentExtractorPostalLayer,
  InboundMimeParserConfigLayer,
  InboundMimeParserPostalLayer,
} from "#/modules/mailbox/adapters/mime/InboundMimeParserPostal";
import {
  InboundAttachmentStoreR2Layer,
  InboundAttachmentStoreRuntimeSystemLayer,
} from "#/modules/mailbox/adapters/r2/InboundAttachmentStoreR2";
import { InboundRawMessageReaderR2Layer } from "#/modules/mailbox/adapters/r2/InboundRawMessageReaderR2";

const InboundMimeLayer = Layer.merge(
  InboundMimeParserPostalLayer,
  InboundMimeAttachmentExtractorPostalLayer
).pipe(Layer.provide(InboundMimeParserConfigLayer));

const InboundAttachmentPersistenceLayer = InboundAttachmentStoreR2Layer.pipe(
  Layer.provide(InboundAttachmentStoreRuntimeSystemLayer)
);

/** Closed inbound processing graph; only concrete runtime binding clients remain. */
export const MailboxInboundLayer = Layer.mergeAll(
  InboundRawMessageReaderR2Layer,
  InboundMimeLayer,
  InboundAttachmentPersistenceLayer,
  InboundMessageCommitterDoLayer,
  InboundProcessingRecorderDoLayer
);
