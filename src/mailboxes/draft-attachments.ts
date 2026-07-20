/* oxlint-disable max-classes-per-file -- Reservation and completion are one attachment lifecycle contract. */
import type { CurrentPrincipal } from "@effect-auth/core/Permission";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import type { MailAuthorizationError } from "../authorization/mail-authorization";
import { MailAuthorization } from "../authorization/mail-authorization";
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
} from "./core";
import type { BlobStoreError, MailboxRepositoryError } from "./errors";
import { MailboxDomainError } from "./errors";
import { MailboxRepository } from "./repository";

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

export interface DraftAttachmentBlobStore {
  readonly store: (input: {
    readonly reservation: DraftAttachmentReservation;
    readonly content: Uint8Array;
  }) => Effect.Effect<Sha256Digest, BlobStoreError>;
}

export const DraftAttachmentBlobStore =
  Context.Service<DraftAttachmentBlobStore>(
    "cloudflare-inbox/DraftAttachmentBlobStore"
  );

export class MailboxDraftAttachmentError extends Data.TaggedError(
  "MailboxDraftAttachmentError"
)<{
  readonly cause?: unknown;
  readonly message: string;
  readonly reason:
    | "conflict"
    | "expired"
    | "invalid-input"
    | "not-found"
    | "storage";
}> {}

export interface MailboxDraftAttachments {
  readonly reserve: (
    command: ReserveDraftAttachmentCommand
  ) => Effect.Effect<
    DraftAttachmentReservation,
    MailAuthorizationError | MailboxDraftAttachmentError,
    CurrentPrincipal
  >;
  readonly upload: (
    command: UploadDraftAttachmentCommand
  ) => Effect.Effect<
    DraftAttachmentUploadResult,
    MailAuthorizationError | MailboxDraftAttachmentError,
    CurrentPrincipal
  >;
}

export const MailboxDraftAttachments = Context.Service<MailboxDraftAttachments>(
  "cloudflare-inbox/MailboxDraftAttachments"
);

const attachmentError = (
  reason: MailboxDraftAttachmentError["reason"],
  cause?: unknown
) =>
  new MailboxDraftAttachmentError({
    cause,
    message:
      reason === "conflict"
        ? "Attachment upload conflicts with existing data"
        : reason === "expired"
          ? "Attachment reservation expired"
          : reason === "invalid-input"
            ? "Attachment upload is invalid"
            : reason === "not-found"
              ? "Attachment reservation was not found"
              : "Attachment could not be stored",
    reason,
  });

const mapRepositoryError = (
  error: MailboxDomainError | MailboxRepositoryError
) => {
  if (!(error instanceof MailboxDomainError)) {
    return attachmentError("storage", error);
  }
  if (error.reason === "not-found") {
    return attachmentError("not-found");
  }
  if (error.reason === "validation") {
    return attachmentError("invalid-input");
  }
  if (error.reason === "invalid-state") {
    return error.message === "Attachment reservation expired"
      ? attachmentError("expired")
      : attachmentError("conflict", error);
  }
  return error.reason === "version-conflict" ||
    error.reason === "idempotency-conflict"
    ? attachmentError("conflict", error)
    : attachmentError("storage", error);
};

const verifyReservationIdentity = (
  reservation: DraftAttachmentReservation,
  mailboxId: MailboxId,
  draftId: DraftId,
  attachmentId?: AttachmentId
) =>
  reservation.mailboxId === mailboxId &&
  reservation.draftId === draftId &&
  (attachmentId === undefined || reservation.id === attachmentId)
    ? Effect.succeed(reservation)
    : Effect.fail(
        attachmentError(
          "storage",
          new Error("Draft attachment identity invariant failed")
        )
      );

export const MailboxDraftAttachmentsLive = Layer.effect(
  MailboxDraftAttachments,
  Effect.gen(function* () {
    const authorization = yield* MailAuthorization;
    const repository = yield* MailboxRepository;
    const blobs = yield* DraftAttachmentBlobStore;
    const authorize = (mailboxId: MailboxId, draftId: DraftId) =>
      authorization.requireAttachmentUpload({
        resource: { _tag: "Draft", draftId, mailboxId },
      });

    return MailboxDraftAttachments.of({
      reserve: (command) =>
        Effect.gen(function* () {
          yield* authorize(command.mailboxId, command.draftId);
          const reservation = yield* repository
            .reserveDraftAttachment(command)
            .pipe(Effect.mapError(mapRepositoryError));
          yield* verifyReservationIdentity(
            reservation,
            command.mailboxId,
            command.draftId
          );
          return reservation.status === "reserved" &&
            reservation.fileName === command.fileName &&
            reservation.mimeType === command.mimeType &&
            reservation.size === command.size
            ? reservation
            : yield* Effect.fail(
                attachmentError(
                  "storage",
                  new Error("Draft attachment reservation invariant failed")
                )
              );
        }),
      upload: (command) =>
        Effect.gen(function* () {
          yield* authorize(command.mailboxId, command.draftId);
          const reservation = yield* repository
            .getDraftAttachment(command)
            .pipe(Effect.mapError(mapRepositoryError));
          yield* verifyReservationIdentity(
            reservation,
            command.mailboxId,
            command.draftId,
            command.attachmentId
          );
          if (command.content.byteLength !== reservation.size) {
            return yield* attachmentError("invalid-input");
          }
          const contentSha256 = yield* blobs
            .store({ content: command.content, reservation })
            .pipe(
              Effect.mapError((cause) => attachmentError("storage", cause))
            );
          const result = yield* repository
            .completeDraftAttachment({
              attachmentId: command.attachmentId,
              contentSha256,
              draftId: command.draftId,
              mailboxId: command.mailboxId,
            })
            .pipe(Effect.mapError(mapRepositoryError));
          yield* verifyReservationIdentity(
            result.attachment,
            command.mailboxId,
            command.draftId,
            command.attachmentId
          );
          if (result.attachment.contentSha256 !== contentSha256) {
            return yield* attachmentError(
              "storage",
              new Error("Draft attachment digest invariant failed")
            );
          }
          return result;
        }),
    });
  })
);
