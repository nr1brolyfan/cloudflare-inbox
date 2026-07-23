import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type { StoreInboundAttachmentsInput } from "#/modules/mailbox/domain/MailboxInbound";
import type { BlobStoreError } from "#/modules/mailbox/ports/MailboxBlobStore";

export interface InboundAttachmentStoreService {
  readonly store: (
    input: StoreInboundAttachmentsInput
  ) => Effect.Effect<void, BlobStoreError>;
}

export class InboundAttachmentStore extends Context.Service<
  InboundAttachmentStore,
  InboundAttachmentStoreService
>()("cloudflare-inbox/InboundAttachmentStore") {}
