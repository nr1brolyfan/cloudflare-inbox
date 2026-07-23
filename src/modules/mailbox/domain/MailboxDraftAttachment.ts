/* oxlint-disable max-classes-per-file -- Reservation and completion form one attachment lifecycle contract. */
import * as Schema from "effect/Schema";

import {
  AttachmentId,
  ByteSize,
  DraftId,
  FileName,
  MailboxId,
  MimeType,
  OperationId,
  Sha256Digest,
  UnixMillis,
  Version,
} from "#/mailboxes/core";

export const draftAttachmentMaxBytes = 10 * 1024 * 1024;
export const draftAttachmentMaxCount = 10;
export const draftAttachmentMaxTotalBytes = 20 * 1024 * 1024;
export const draftAttachmentReservationTtlMillis = 15 * 60 * 1000;

export const DraftAttachmentSize = ByteSize.pipe(
  Schema.check(
    Schema.isGreaterThan(0),
    Schema.isLessThanOrEqualTo(draftAttachmentMaxBytes)
  )
);
export type DraftAttachmentSize = Schema.Schema.Type<
  typeof DraftAttachmentSize
>;

export const DraftAttachmentContent = Schema.Uint8Array.check(
  Schema.makeFilter((content) =>
    content.byteLength >= 1 && content.byteLength <= draftAttachmentMaxBytes
      ? undefined
      : `attachment content must contain between 1 and ${draftAttachmentMaxBytes} bytes`
  )
);

export const DraftAttachmentStatus = Schema.Literals(["reserved", "stored"]);
export type DraftAttachmentStatus = Schema.Schema.Type<
  typeof DraftAttachmentStatus
>;

export class DraftAttachmentReservation extends Schema.Class<DraftAttachmentReservation>(
  "cloudflare-inbox/DraftAttachmentReservation"
)({
  id: AttachmentId,
  mailboxId: MailboxId,
  draftId: DraftId,
  fileName: FileName,
  mimeType: MimeType,
  size: DraftAttachmentSize,
  status: DraftAttachmentStatus,
  contentSha256: Schema.optional(Sha256Digest),
  createdAt: UnixMillis,
  expiresAt: UnixMillis,
  storedAt: Schema.optional(UnixMillis),
}) {}

export const DraftAttachmentReservationSchema =
  DraftAttachmentReservation.check(
    Schema.makeFilter((reservation) => {
      if (reservation.expiresAt <= reservation.createdAt) {
        return "expiresAt must be later than createdAt";
      }
      const storedFieldsPresent =
        reservation.contentSha256 !== undefined &&
        reservation.storedAt !== undefined &&
        reservation.storedAt >= reservation.createdAt;
      return reservation.status === "stored"
        ? storedFieldsPresent
          ? undefined
          : "stored reservations require valid storage metadata"
        : reservation.contentSha256 === undefined &&
            reservation.storedAt === undefined
          ? undefined
          : "reserved attachments cannot contain storage metadata";
    })
  );

export const StoredDraftAttachment = DraftAttachmentReservationSchema.check(
  Schema.makeFilter((attachment) =>
    attachment.status === "stored" ? undefined : "attachment must be stored"
  )
);

export const ReservedDraftAttachment = DraftAttachmentReservationSchema.check(
  Schema.makeFilter((attachment) =>
    attachment.status === "reserved" ? undefined : "attachment must be reserved"
  )
);

export class DraftAttachmentUploadResult extends Schema.Class<DraftAttachmentUploadResult>(
  "cloudflare-inbox/DraftAttachmentUploadResult"
)({
  attachment: StoredDraftAttachment,
  draftVersion: Version,
}) {}

export const ReserveDraftAttachmentCommand = Schema.Struct({
  mailboxId: MailboxId,
  draftId: DraftId,
  operationId: OperationId,
  fileName: FileName,
  mimeType: MimeType,
  size: DraftAttachmentSize,
});
export type ReserveDraftAttachmentCommand = Schema.Schema.Type<
  typeof ReserveDraftAttachmentCommand
>;

export const GetDraftAttachmentInput = Schema.Struct({
  mailboxId: MailboxId,
  draftId: DraftId,
  attachmentId: AttachmentId,
});
export type GetDraftAttachmentInput = Schema.Schema.Type<
  typeof GetDraftAttachmentInput
>;

export const ListDraftAttachmentsInput = Schema.Struct({
  mailboxId: MailboxId,
  draftId: DraftId,
});
export type ListDraftAttachmentsInput = Schema.Schema.Type<
  typeof ListDraftAttachmentsInput
>;

export const DraftAttachmentList = Schema.Struct({
  items: Schema.Array(DraftAttachmentReservationSchema),
});
export type DraftAttachmentList = Schema.Schema.Type<
  typeof DraftAttachmentList
>;

export const CompleteDraftAttachmentInput = Schema.Struct({
  mailboxId: MailboxId,
  draftId: DraftId,
  attachmentId: AttachmentId,
  contentSha256: Sha256Digest,
});
export type CompleteDraftAttachmentInput = Schema.Schema.Type<
  typeof CompleteDraftAttachmentInput
>;

export const UploadDraftAttachmentCommand = Schema.Struct({
  mailboxId: MailboxId,
  draftId: DraftId,
  attachmentId: AttachmentId,
  content: DraftAttachmentContent,
});
export type UploadDraftAttachmentCommand = Schema.Schema.Type<
  typeof UploadDraftAttachmentCommand
>;
