import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type { ReadInboundRawMessageInput } from "#/modules/mailbox/domain/MailboxInbound";
import type { BlobStoreError } from "#/modules/mailbox/ports/MailboxBlobStore";

export interface InboundRawMessageReaderService {
  readonly read: (
    input: ReadInboundRawMessageInput
  ) => Effect.Effect<ArrayBuffer, BlobStoreError>;
}

export class InboundRawMessageReader extends Context.Service<
  InboundRawMessageReader,
  InboundRawMessageReaderService
>()("cloudflare-inbox/InboundRawMessageReader") {}
