import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type {
  AttachmentId,
  ByteSize,
  DraftId,
  MailboxId,
  MimeType,
  Sha256Digest,
  UnixMillis,
} from "#/mailboxes/core";
import type { BlobStoreError } from "#/mailboxes/errors";

export interface DraftAttachmentBlobReservation {
  readonly id: AttachmentId;
  readonly mailboxId: MailboxId;
  readonly draftId: DraftId;
  readonly mimeType: MimeType;
  readonly size: ByteSize;
  readonly expiresAt: UnixMillis;
}

export interface DraftAttachmentBlobStoreService {
  readonly store: (input: {
    readonly reservation: DraftAttachmentBlobReservation;
    readonly content: Uint8Array;
  }) => Effect.Effect<Sha256Digest, BlobStoreError>;
}

/** Immutable draft attachment content required by mailbox use cases. */
export class DraftAttachmentBlobStore extends Context.Service<
  DraftAttachmentBlobStore,
  DraftAttachmentBlobStoreService
>()("cloudflare-inbox/DraftAttachmentBlobStore") {}
