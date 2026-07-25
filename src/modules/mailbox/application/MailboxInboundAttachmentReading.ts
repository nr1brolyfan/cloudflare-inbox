/* oxlint-disable max-classes-per-file -- Attachment contract, error and service form one cohesive use case. */
import type { CurrentPrincipal } from "@effect-auth/core/Permission";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import {
  AttachmentId,
  FolderId,
  LabelId,
  MailboxId,
  MessageId,
} from "#/modules/mailbox/domain/Mailbox";
import type { MimeType } from "#/modules/mailbox/domain/Mailbox";
import { MailboxDomainError } from "#/modules/mailbox/domain/MailboxError";
import { MAXIMUM_INBOUND_RAW_BYTES } from "#/modules/mailbox/domain/MailboxInbound";
import type {
  InboundAttachmentBlobLocation,
  MessageDetail,
} from "#/modules/mailbox/domain/MailboxMessage";
import { InboundAttachmentBlobReader } from "#/modules/mailbox/ports/InboundAttachmentBlobReader";
import { MailboxAuthorization } from "#/modules/mailbox/ports/MailboxAuthorization";
import type { MailboxAuthorizationError } from "#/modules/mailbox/ports/MailboxAuthorization";
import type { BlobStoreError } from "#/modules/mailbox/ports/MailboxBlobStore";
import { MailboxMessageRepository } from "#/modules/mailbox/ports/MailboxMessageRepository";
import type { MailboxRepositoryError } from "#/modules/mailbox/ports/MailboxRepositoryError";

export const MailboxInboundAttachmentInput = Schema.Union([
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
export type MailboxInboundAttachmentInput = Schema.Schema.Type<
  typeof MailboxInboundAttachmentInput
>;

export interface MailboxInboundAttachmentContent {
  readonly bytes: Uint8Array;
  readonly fileName: string;
  readonly mimeType: MimeType;
}

export class MailboxInboundAttachmentError extends Data.TaggedError(
  "MailboxInboundAttachmentError"
)<{
  readonly cause?: unknown;
  readonly message: string;
  readonly reason: "not-found" | "storage";
}> {}

export interface MailboxInboundAttachmentReadingService {
  readonly get: (
    input: MailboxInboundAttachmentInput
  ) => Effect.Effect<
    MailboxInboundAttachmentContent,
    MailboxAuthorizationError | MailboxInboundAttachmentError,
    CurrentPrincipal
  >;
}

const mediaTypeToken = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u;

export const isValidAttachmentMimeType = (mimeType: string) => {
  const [type, subtype, ...extra] = mimeType.split("/");
  return (
    extra.length === 0 &&
    type !== undefined &&
    subtype !== undefined &&
    mediaTypeToken.test(type) &&
    mediaTypeToken.test(subtype)
  );
};

const attachmentError = (reason: "not-found" | "storage", cause?: unknown) =>
  new MailboxInboundAttachmentError({
    cause,
    message:
      reason === "not-found"
        ? "Inbound message attachment was not found"
        : "Inbound message attachment could not be loaded",
    reason,
  });

const mapRepositoryError = (
  error: MailboxDomainError | MailboxRepositoryError
) =>
  error instanceof MailboxDomainError && error.reason === "not-found"
    ? attachmentError("not-found")
    : attachmentError("storage", error);

const messageMatchesView = (
  input: MailboxInboundAttachmentInput,
  message: MessageDetail,
  resolvedFolderId: string
) =>
  message.direction === "inbound" &&
  message.mailboxId === input.mailboxId &&
  message.id === input.messageId &&
  resolvedFolderId === message.folderId &&
  (input._tag === "Folder"
    ? message.folderId === input.folderId
    : message.labelIds.includes(input.labelId));

const locationsMatch = (
  input: MailboxInboundAttachmentInput,
  metadata: MessageDetail["attachments"][number],
  authorized: {
    readonly attachmentId: string;
    readonly folderId: string;
    readonly mailboxId: string;
    readonly messageId: string;
  },
  location: InboundAttachmentBlobLocation
) =>
  authorized.mailboxId === input.mailboxId &&
  authorized.messageId === input.messageId &&
  authorized.attachmentId === input.attachmentId &&
  authorized.folderId === location.folderId &&
  location.mailboxId === input.mailboxId &&
  location.messageId === input.messageId &&
  location.attachmentId === input.attachmentId &&
  location.disposition === "attachment" &&
  location.fileName === metadata.fileName &&
  location.mimeType === metadata.mimeType &&
  location.size === metadata.size &&
  location.size <= MAXIMUM_INBOUND_RAW_BYTES &&
  isValidAttachmentMimeType(location.mimeType);

/** Independently authorizes and loads one ordinary inbound attachment. */
export class MailboxInboundAttachmentReading extends Context.Service<
  MailboxInboundAttachmentReading,
  MailboxInboundAttachmentReadingService
>()("cloudflare-inbox/MailboxInboundAttachmentReading", {
  make: Effect.gen(function* () {
    const authorization = yield* MailboxAuthorization;
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
            metadata === undefined ||
            metadata.disposition !== "attachment"
          ) {
            return yield* attachmentError("not-found");
          }

          const authorizedLocation =
            yield* authorization.requireInboundAttachmentDownload({
              resource: {
                _tag: "Attachment",
                attachmentId: input.attachmentId,
                mailboxId: input.mailboxId,
              },
            });
          const location = yield* repository
            .getInboundAttachmentBlob({
              attachmentId: input.attachmentId,
              mailboxId: input.mailboxId,
              messageId: input.messageId,
            })
            .pipe(Effect.mapError(mapRepositoryError));
          if (!locationsMatch(input, metadata, authorizedLocation, location)) {
            return yield* attachmentError("not-found");
          }

          const bytes = yield* blobs
            .read(location)
            .pipe(
              Effect.mapError((error: BlobStoreError) =>
                attachmentError("storage", error)
              )
            );
          return {
            bytes,
            fileName: location.fileName,
            mimeType: location.mimeType,
          };
        }),
    };
  }),
}) {
  static readonly layerNoDeps = Layer.effect(this, this.make);
}
