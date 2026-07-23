import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type {
  InboundIngestId,
  MailboxId,
} from "#/modules/mailbox/domain/Mailbox";
import type { ReceiveInboundEmailInput } from "#/modules/mailbox/domain/MailboxInbound";
import type { BlobStoreError } from "#/modules/mailbox/ports/MailboxBlobStore";
import type { UnixMillis } from "#/shared/Temporal";

export interface StoreInboundRawMessageInput {
  readonly envelope: ReceiveInboundEmailInput;
  readonly inboundIngestId: InboundIngestId;
  readonly mailboxId: MailboxId;
  readonly raw: ReadableStream<Uint8Array>;
  readonly receivedAt: UnixMillis;
}

export interface InboundRawMessageStoreService {
  readonly store: (
    input: StoreInboundRawMessageInput
  ) => Effect.Effect<void, BlobStoreError>;
}

export class InboundRawMessageStore extends Context.Service<
  InboundRawMessageStore,
  InboundRawMessageStoreService
>()("cloudflare-inbox/InboundRawMessageStore") {}
