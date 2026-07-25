/* oxlint-disable max-classes-per-file -- Dispatch snapshot schemas form one internal contract. */
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  AttachmentId,
  ByteSize,
  ContentId,
  FileName,
  MailboxId,
  MessageId,
  MessageSubject,
  MimeType,
  OutboundDeliveryId,
  Sha256Digest,
} from "#/modules/mailbox/domain/Mailbox";
import {
  effectiveOutboundBcc,
  outboundMaxRecipientCount,
} from "#/modules/mailbox/domain/MailboxOutbound";
import { OutboundThreadingMetadata } from "#/modules/mailbox/domain/MailboxThreading";
import { NormalizedEmailAddress } from "#/shared/EmailAddress";
import { MailAddress } from "#/shared/MailAddress";

export class OutboundDraftAttachmentLocation extends Schema.Class<OutboundDraftAttachmentLocation>(
  "cloudflare-inbox/OutboundDraftAttachmentLocation"
)({
  contentSha256: Sha256Digest,
  draftAttachmentId: AttachmentId,
  mailboxId: MailboxId,
  mimeType: MimeType,
  size: ByteSize,
}) {}

export const OutboundDispatchAttachmentSnapshot = Schema.Struct({
  attachmentId: AttachmentId,
  contentId: Schema.optional(ContentId),
  disposition: Schema.Literals(["attachment", "inline"]),
  fileName: FileName,
  location: OutboundDraftAttachmentLocation,
}).check(
  Schema.makeFilter((attachment) =>
    (attachment.disposition === "inline") ===
    (attachment.contentId !== undefined)
      ? undefined
      : "contentId must be present exactly for inline attachments"
  )
);
export type OutboundDispatchAttachmentSnapshot = Schema.Schema.Type<
  typeof OutboundDispatchAttachmentSnapshot
>;

export class OutboundDispatchSnapshot extends Schema.Class<OutboundDispatchSnapshot>(
  "cloudflare-inbox/OutboundDispatchSnapshot"
)({
  attachments: Schema.Array(OutboundDispatchAttachmentSnapshot),
  archiveRecipient: Schema.optional(NormalizedEmailAddress),
  bcc: Schema.Array(MailAddress),
  cc: Schema.Array(MailAddress),
  html: Schema.optional(Schema.String),
  mailboxId: MailboxId,
  messageId: MessageId,
  outboundDeliveryId: OutboundDeliveryId,
  sender: MailAddress,
  subject: MessageSubject,
  text: Schema.optional(Schema.String),
  threading: Schema.optional(OutboundThreadingMetadata),
  to: Schema.Array(MailAddress),
}) {}

export const OutboundDispatchSnapshotSchema = OutboundDispatchSnapshot.check(
  Schema.makeFilter((snapshot) => {
    const recipientCount =
      snapshot.to.length +
      snapshot.cc.length +
      effectiveOutboundBcc(
        snapshot.to,
        snapshot.cc,
        snapshot.bcc,
        snapshot.archiveRecipient
      ).length;
    if (recipientCount === 0) {
      return "an outbound dispatch snapshot requires at least one recipient";
    }
    return recipientCount <= outboundMaxRecipientCount
      ? undefined
      : `an outbound dispatch snapshot cannot contain more than ${outboundMaxRecipientCount} recipients`;
  })
);

export class OutboundDispatchSnapshotError extends Data.TaggedError(
  "OutboundDispatchSnapshotError"
)<{
  readonly cause?: unknown;
  readonly message: string;
  readonly outboundDeliveryId: OutboundDeliveryId;
  readonly reason: "invalid-snapshot" | "not-found" | "storage";
}> {}

export interface MailboxOutboundDispatchStoreService {
  readonly load: (
    outboundDeliveryId: OutboundDeliveryId
  ) => Effect.Effect<OutboundDispatchSnapshot, OutboundDispatchSnapshotError>;
}

/** Internal-only snapshot access; it is intentionally absent from repository and RPC contracts. */
export class MailboxOutboundDispatchStore extends Context.Service<
  MailboxOutboundDispatchStore,
  MailboxOutboundDispatchStoreService
>()("cloudflare-inbox/MailboxOutboundDispatchStore") {}
