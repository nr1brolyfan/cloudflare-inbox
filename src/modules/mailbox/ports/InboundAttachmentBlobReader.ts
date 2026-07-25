import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type {
  AttachmentBlobLocation,
  InboundAttachmentBlobLocation,
} from "#/modules/mailbox/domain/MailboxMessage";
import type { BlobStoreError } from "#/modules/mailbox/ports/MailboxBlobStore";

export interface InboundAttachmentBlobReaderService {
  readonly read: (
    location: AttachmentBlobLocation | InboundAttachmentBlobLocation
  ) => Effect.Effect<Uint8Array, BlobStoreError>;
}

/** Immutable inbound attachment content required by mailbox use cases. */
export class InboundAttachmentBlobReader extends Context.Service<
  InboundAttachmentBlobReader,
  InboundAttachmentBlobReaderService
>()("cloudflare-inbox/InboundAttachmentBlobReader") {}
