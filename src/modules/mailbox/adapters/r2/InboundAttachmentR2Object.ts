import * as Schema from "effect/Schema";

import { ParsedInboundAttachmentV1 } from "#/modules/mailbox/domain/MailboxInbound";
import type { ParsedInboundAttachmentV1 as ParsedInboundAttachment } from "#/modules/mailbox/domain/MailboxInbound";

export const inboundAttachmentObjectKey = (
  inboundIngestId: string,
  sourceIndex: number
) =>
  `inbound/${inboundIngestId}/attachments/${String(sourceIndex).padStart(6, "0")}.bin`;

export const inboundAttachmentMetadataBytes = (
  metadata: ParsedInboundAttachment
) =>
  new TextEncoder().encode(
    JSON.stringify(Schema.encodeSync(ParsedInboundAttachmentV1)(metadata))
  );

export const inboundAttachmentCustomMetadata = (input: {
  readonly contentSha256: string;
  readonly inboundIngestId: string;
  readonly mailboxId: string;
  readonly metadataSha256: string;
  readonly receivedAt: number;
  readonly size: number;
  readonly sourceIndex: number;
}) => ({
  "attachment-index": String(input.sourceIndex),
  "attachment-metadata-sha256": input.metadataSha256,
  "attachment-size": String(input.size),
  "content-sha256": input.contentSha256,
  "format-version": "1",
  "inbound-ingest-id": input.inboundIngestId,
  "mailbox-id": input.mailboxId,
  "object-type": "attachment",
  "received-at": String(input.receivedAt),
});
