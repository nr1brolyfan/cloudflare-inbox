/* oxlint-disable max-classes-per-file -- Attachment contract, error and service form one cohesive use case. */
import type { CurrentPrincipal } from "@effect-auth/core/Permission";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import type { MailAuthorizationError } from "#/authorization/mail-authorization";
import { MailAuthorization } from "#/authorization/mail-authorization";
import {
  AttachmentId,
  FolderId,
  LabelId,
  MailboxId,
  MessageId,
} from "#/modules/mailbox/domain/Mailbox";
import type { MimeType } from "#/modules/mailbox/domain/Mailbox";
import { MailboxDomainError } from "#/modules/mailbox/domain/MailboxError";
import type {
  AttachmentBlobLocation,
  MessageDetail,
} from "#/modules/mailbox/domain/MailboxMessage";
import { InboundAttachmentBlobReader } from "#/modules/mailbox/ports/InboundAttachmentBlobReader";
import type { BlobStoreError } from "#/modules/mailbox/ports/MailboxBlobStore";
import { MailboxMessageRepository } from "#/modules/mailbox/ports/MailboxMessageRepository";
import type { MailboxRepositoryError } from "#/modules/mailbox/ports/MailboxRepositoryError";

export const MailboxInlineAttachmentInput = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("Folder"),
    attachmentId: AttachmentId,
    folderId: FolderId,
    mailboxId: MailboxId,
    messageId: MessageId,
  }),
  Schema.Struct({
    _tag: Schema.Literal("Label"),
    attachmentId: AttachmentId,
    labelId: LabelId,
    mailboxId: MailboxId,
    messageId: MessageId,
  }),
]);
export type MailboxInlineAttachmentInput = Schema.Schema.Type<
  typeof MailboxInlineAttachmentInput
>;

export interface MailboxInlineAttachmentContent {
  readonly bytes: Uint8Array;
  readonly mimeType: MimeType;
}

export class MailboxInlineAttachmentError extends Data.TaggedError(
  "MailboxInlineAttachmentError"
)<{
  readonly cause?: unknown;
  readonly message: string;
  readonly reason: "not-found" | "storage";
}> {}

export interface MailboxInlineAttachmentReadingService {
  readonly get: (
    input: MailboxInlineAttachmentInput
  ) => Effect.Effect<
    MailboxInlineAttachmentContent,
    MailAuthorizationError | MailboxInlineAttachmentError,
    CurrentPrincipal
  >;
}

const safeInlineImageMimeTypes = new Set([
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export const isSafeInlineImageMimeType = (mimeType: string) =>
  safeInlineImageMimeTypes.has(mimeType.toLowerCase());

const attachmentError = (reason: "not-found" | "storage", cause?: unknown) =>
  new MailboxInlineAttachmentError({
    cause,
    message:
      reason === "not-found"
        ? "Inline message attachment was not found"
        : "Inline message attachment could not be loaded",
    reason,
  });

const mapRepositoryError = (
  error: MailboxDomainError | MailboxRepositoryError
) =>
  error instanceof MailboxDomainError && error.reason === "not-found"
    ? attachmentError("not-found")
    : attachmentError("storage", error);

const messageMatchesView = (
  input: MailboxInlineAttachmentInput,
  message: MessageDetail,
  resolvedFolderId: string
) =>
  message.mailboxId === input.mailboxId &&
  message.id === input.messageId &&
  resolvedFolderId === message.folderId &&
  (input._tag === "Folder"
    ? message.folderId === input.folderId
    : message.labelIds.includes(input.labelId));

type InlineAttachmentMetadata = MessageDetail["attachments"][number] & {
  readonly contentId: string;
};

const isEligibleInlineAttachment = (
  metadata: MessageDetail["attachments"][number] | undefined
): metadata is InlineAttachmentMetadata =>
  metadata !== undefined &&
  metadata.disposition === "inline" &&
  metadata.contentId !== undefined &&
  isSafeInlineImageMimeType(metadata.mimeType);

const attachmentLocationsMatch = (
  input: MailboxInlineAttachmentInput,
  folderId: string,
  metadata: InlineAttachmentMetadata,
  authorized: {
    readonly attachmentId: string;
    readonly folderId: string;
    readonly mailboxId: string;
    readonly messageId: string;
  },
  location: AttachmentBlobLocation
) =>
  authorized.mailboxId === input.mailboxId &&
  authorized.messageId === input.messageId &&
  authorized.attachmentId === input.attachmentId &&
  authorized.folderId === folderId &&
  location.mailboxId === input.mailboxId &&
  location.messageId === input.messageId &&
  location.attachmentId === input.attachmentId &&
  location.folderId === folderId &&
  location.contentId === metadata.contentId &&
  location.mimeType === metadata.mimeType &&
  isSafeInlineImageMimeType(location.mimeType);

/** Independently authorizes and loads one CID image without exposing R2 identity. */
export class MailboxInlineAttachmentReading extends Context.Service<
  MailboxInlineAttachmentReading,
  MailboxInlineAttachmentReadingService
>()("cloudflare-inbox/MailboxInlineAttachmentReading", {
  make: Effect.gen(function* () {
    const authorization = yield* MailAuthorization;
    const blobs = yield* InboundAttachmentBlobReader;
    const repository = yield* MailboxMessageRepository;

    return {
      get: (input) =>
        Effect.gen(function* () {
          yield* input._tag === "Folder"
            ? authorization.requireFolderMessageRead({
                resource: {
                  _tag: "Folder",
                  folderId: input.folderId,
                  mailboxId: input.mailboxId,
                },
              })
            : authorization.requireMailboxMessageRead({
                resource: { _tag: "Mailbox", mailboxId: input.mailboxId },
              });

          const messageLocation = yield* authorization
            .requireMessage({
              action: "read",
              resource: {
                _tag: "Message",
                mailboxId: input.mailboxId,
                messageId: input.messageId,
              },
            })
            .pipe(
              Effect.catchTag("AuthorizationError", () =>
                Effect.fail(attachmentError("not-found"))
              )
            );
          const message = yield* repository
            .getMessage({
              mailboxId: input.mailboxId,
              messageId: input.messageId,
            })
            .pipe(Effect.mapError(mapRepositoryError));
          const metadata = message.attachments.find(
            (attachment) => attachment.id === input.attachmentId
          );
          if (
            !messageMatchesView(input, message, messageLocation.folderId) ||
            !isEligibleInlineAttachment(metadata)
          ) {
            return yield* attachmentError("not-found");
          }

          const authorizedLocation = yield* authorization.requireAttachmentRead(
            {
              resource: {
                _tag: "Attachment",
                attachmentId: input.attachmentId,
                mailboxId: input.mailboxId,
              },
            }
          );
          const location = yield* repository
            .getAttachmentBlob({
              attachmentId: input.attachmentId,
              mailboxId: input.mailboxId,
              messageId: input.messageId,
            })
            .pipe(Effect.mapError(mapRepositoryError));
          if (
            !attachmentLocationsMatch(
              input,
              message.folderId,
              metadata,
              authorizedLocation,
              location
            )
          ) {
            return yield* attachmentError("not-found");
          }

          const bytes = yield* blobs
            .read(location)
            .pipe(
              Effect.mapError((error: BlobStoreError) =>
                attachmentError("storage", error)
              )
            );
          return { bytes, mimeType: location.mimeType };
        }),
    } satisfies MailboxInlineAttachmentReadingService;
  }),
}) {
  static readonly layerNoDeps = Layer.effect(this, this.make);
}
