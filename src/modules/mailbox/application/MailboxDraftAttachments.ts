/* oxlint-disable max-classes-per-file -- Attachment error and service form one cohesive use case. */
import type { CurrentPrincipal } from "@effect-auth/core/Permission";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { MailAuthorizationError } from "#/authorization/mail-authorization";
import { MailAuthorization } from "#/authorization/mail-authorization";
import type { AttachmentId, DraftId, MailboxId } from "#/mailboxes/core";
import { MailboxDomainError } from "#/mailboxes/errors";
import type { MailboxRepositoryError } from "#/mailboxes/errors";
import type {
  DraftAttachmentReservation,
  DraftAttachmentUploadResult,
  ReserveDraftAttachmentCommand,
  UploadDraftAttachmentCommand,
} from "#/modules/mailbox/domain/MailboxDraftAttachment";
import { DraftAttachmentBlobStore } from "#/modules/mailbox/ports/DraftAttachmentBlobStore";
import { MailboxDraftRepository } from "#/modules/mailbox/ports/MailboxDraftRepository";

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

export interface MailboxDraftAttachmentsService {
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

export class MailboxDraftAttachments extends Context.Service<
  MailboxDraftAttachments,
  MailboxDraftAttachmentsService
>()("cloudflare-inbox/MailboxDraftAttachments", {
  make: Effect.gen(function* () {
    const authorization = yield* MailAuthorization;
    const repository = yield* MailboxDraftRepository;
    const blobs = yield* DraftAttachmentBlobStore;
    const authorize = (mailboxId: MailboxId, draftId: DraftId) =>
      authorization.requireAttachmentUpload({
        resource: { _tag: "Draft", draftId, mailboxId },
      });

    return {
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
    } satisfies MailboxDraftAttachmentsService;
  }),
}) {
  static readonly layerNoDeps = Layer.effect(this, this.make);
}
