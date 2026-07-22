import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type { BlobStoreError } from "#/mailboxes/errors";
import type { AttachmentBlobLocation } from "#/mailboxes/messages";

export interface InboundAttachmentBlobReaderService {
  readonly read: (
    location: AttachmentBlobLocation
  ) => Effect.Effect<Uint8Array, BlobStoreError>;
}

/** Immutable inbound attachment content required by mailbox use cases. */
export class InboundAttachmentBlobReader extends Context.Service<
  InboundAttachmentBlobReader,
  InboundAttachmentBlobReaderService
>()("cloudflare-inbox/InboundAttachmentBlobReader") {}
