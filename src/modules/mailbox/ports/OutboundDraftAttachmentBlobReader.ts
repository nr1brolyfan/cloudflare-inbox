import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type { BlobStoreError } from "#/modules/mailbox/ports/MailboxBlobStore";
import type { OutboundDraftAttachmentLocation } from "#/modules/mailbox/ports/MailboxOutboundDispatchStore";

export interface OutboundDraftAttachmentBlobReaderService {
  readonly read: (
    location: OutboundDraftAttachmentLocation
  ) => Effect.Effect<Uint8Array, BlobStoreError>;
}

export class OutboundDraftAttachmentBlobReader extends Context.Service<
  OutboundDraftAttachmentBlobReader,
  OutboundDraftAttachmentBlobReaderService
>()("cloudflare-inbox/OutboundDraftAttachmentBlobReader") {}
