export const draftAttachmentObjectKey = (attachmentId: string) =>
  `draft-attachments/${attachmentId}.bin`;

export const draftAttachmentRequiredMetadata = (input: {
  readonly attachmentId: string;
  readonly contentSha256: string;
  readonly mailboxId: string;
  readonly size: number;
}) => ({
  "attachment-id": input.attachmentId,
  "attachment-size": String(input.size),
  "content-sha256": input.contentSha256,
  "format-version": "1",
  "mailbox-id": input.mailboxId,
  "object-type": "draft-attachment",
});

export const draftAttachmentCustomMetadata = (input: {
  readonly attachmentId: string;
  readonly contentSha256: string;
  readonly draftId: string;
  readonly expiresAt: number;
  readonly mailboxId: string;
  readonly size: number;
}) => ({
  ...draftAttachmentRequiredMetadata(input),
  "draft-id": input.draftId,
  "reservation-expires-at": String(input.expiresAt),
});
