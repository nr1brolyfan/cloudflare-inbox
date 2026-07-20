/* oxlint-disable max-classes-per-file -- Message-reading projections are intentionally consolidated. */
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
  FileName,
  FolderId,
  LabelId,
  MailAddress,
  MailboxId,
  MessageDirection,
  MessageId,
  MessageSnippet,
  MessageSubject,
  MimeType,
  ThreadId,
  UnixMillis,
} from "./core";
import { MailboxDomainError } from "./errors";
import type { MailboxRepositoryError } from "./errors";
import { MailboxRepository } from "./repository";

export const MailboxMessageView = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("Folder"),
    mailboxId: MailboxId,
    folderId: FolderId,
  }),
  Schema.Struct({
    _tag: Schema.Literal("Label"),
    mailboxId: MailboxId,
    labelId: LabelId,
  }),
]);
export type MailboxMessageView = Schema.Schema.Type<typeof MailboxMessageView>;

export const OpenMailboxThreadInput = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("Folder"),
    mailboxId: MailboxId,
    folderId: FolderId,
    messageId: MessageId,
    threadId: ThreadId,
  }),
  Schema.Struct({
    _tag: Schema.Literal("Label"),
    mailboxId: MailboxId,
    labelId: LabelId,
    messageId: MessageId,
    threadId: ThreadId,
  }),
]);
export type OpenMailboxThreadInput = Schema.Schema.Type<
  typeof OpenMailboxThreadInput
>;

export class MailboxMessageListItem extends Schema.Class<MailboxMessageListItem>(
  "cloudflare-inbox/MailboxMessageListItem"
)({
  id: MessageId,
  threadId: ThreadId,
  direction: MessageDirection,
  subject: MessageSubject,
  sender: Schema.optional(MailAddress),
  recipients: Schema.Array(MailAddress),
  snippet: MessageSnippet,
  activityAt: UnixMillis,
  read: Schema.Boolean,
  starred: Schema.Boolean,
  hasAttachments: Schema.Boolean,
}) {}

export const MailboxMessageListResult = Schema.Struct({
  items: Schema.Array(MailboxMessageListItem),
  hasMore: Schema.Boolean,
});
export type MailboxMessageListResult = Schema.Schema.Type<
  typeof MailboxMessageListResult
>;

export class MailboxThreadAttachment extends Schema.Class<MailboxThreadAttachment>(
  "cloudflare-inbox/MailboxThreadAttachment"
)({
  id: AttachmentId,
  fileName: FileName,
  mimeType: MimeType,
  size: ByteSize,
  disposition: Schema.Literals(["attachment", "inline"]),
}) {}

export class MailboxThreadMessage extends Schema.Class<MailboxThreadMessage>(
  "cloudflare-inbox/MailboxThreadMessage"
)({
  id: MessageId,
  direction: MessageDirection,
  sender: Schema.optional(MailAddress),
  to: Schema.Array(MailAddress),
  cc: Schema.Array(MailAddress),
  activityAt: UnixMillis,
  read: Schema.Boolean,
  textBody: Schema.optional(Schema.String),
  hasHtmlBody: Schema.Boolean,
  attachments: Schema.Array(MailboxThreadAttachment),
}) {}

const Count = Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)));

export class MailboxThreadHeader extends Schema.Class<MailboxThreadHeader>(
  "cloudflare-inbox/MailboxThreadHeader"
)({
  id: ThreadId,
  subject: MessageSubject,
  messageCount: Count,
  unreadCount: Count,
  latestActivityAt: UnixMillis,
}) {}

export const MailboxThreadHeaderSchema = MailboxThreadHeader.check(
  Schema.makeFilter((thread) => {
    if (thread.messageCount < 1) {
      return "a thread must contain at least one message";
    }
    return thread.unreadCount <= thread.messageCount
      ? undefined
      : "unreadCount cannot exceed messageCount";
  })
);

export const MailboxThreadResult = Schema.Struct({
  thread: MailboxThreadHeaderSchema,
  messages: Schema.Array(MailboxThreadMessage),
  hasMore: Schema.Boolean,
}).check(
  Schema.makeFilter((result) => {
    if (result.messages.length === 0) {
      return "a thread result must contain at least one message";
    }
    if (result.messages.length > result.thread.messageCount) {
      return "the page cannot contain more messages than the thread";
    }
    return result.messages.filter((message) => !message.read).length <=
      result.thread.unreadCount
      ? undefined
      : "the page cannot contain more unread messages than the thread";
  })
);
export type MailboxThreadResult = Schema.Schema.Type<
  typeof MailboxThreadResult
>;

export class MailboxMessageReadingError extends Data.TaggedError(
  "MailboxMessageReadingError"
)<{
  readonly cause?: unknown;
  readonly message: string;
  readonly reason: "not-found" | "storage";
}> {}

export interface MailboxMessageReading {
  readonly listView: (
    input: MailboxMessageView
  ) => Effect.Effect<
    MailboxMessageListResult,
    MailAuthorizationError | MailboxMessageReadingError,
    CurrentPrincipal
  >;
  readonly openThread: (
    input: OpenMailboxThreadInput
  ) => Effect.Effect<
    MailboxThreadResult,
    MailAuthorizationError | MailboxMessageReadingError,
    CurrentPrincipal
  >;
}

export const MailboxMessageReading = Context.Service<MailboxMessageReading>(
  "cloudflare-inbox/MailboxMessageReading"
);

const readingError = (reason: "not-found" | "storage", cause?: unknown) =>
  new MailboxMessageReadingError({
    cause,
    message:
      reason === "not-found"
        ? "Mailbox message content was not found"
        : "Mailbox message content could not be loaded",
    reason,
  });

const mapRepositoryError = (
  error: MailboxDomainError | MailboxRepositoryError
) =>
  error instanceof MailboxDomainError && error.reason === "not-found"
    ? readingError("not-found")
    : readingError("storage", error);

/** Authorized mailbox-wide reads projected for the inbox UI boundary. */
export const MailboxMessageReadingLive = Layer.effect(
  MailboxMessageReading,
  Effect.gen(function* () {
    const authorization = yield* MailAuthorization;
    const repository = yield* MailboxRepository;

    const requireRead = (view: MailboxMessageView) =>
      view._tag === "Folder"
        ? authorization.requireFolderMessageRead({
            resource: {
              _tag: "Folder",
              folderId: view.folderId,
              mailboxId: view.mailboxId,
            },
          })
        : authorization
            .requireMailboxMessageRead({
              resource: { _tag: "Mailbox", mailboxId: view.mailboxId },
            })
            .pipe(
              Effect.map((location) => ({
                _tag: "MailboxMessageRead" as const,
                mailboxId: location.mailboxId,
              }))
            );

    return MailboxMessageReading.of({
      listView: (input) =>
        Effect.gen(function* () {
          yield* requireRead(input);
          const page = yield* repository
            .listMessages({
              mailboxId: input.mailboxId,
              filters:
                input._tag === "Folder"
                  ? { folderId: input.folderId }
                  : { labelIds: [input.labelId] },
            })
            .pipe(Effect.mapError(mapRepositoryError));
          const invalidItem = page.items.some(
            (message) =>
              message.mailboxId !== input.mailboxId ||
              (input._tag === "Folder"
                ? message.folderId !== input.folderId
                : !message.labelIds.includes(input.labelId))
          );
          if (invalidItem) {
            return yield* readingError(
              "storage",
              new Error("Mailbox message view identity invariant failed")
            );
          }

          return yield* Schema.decodeUnknownEffect(MailboxMessageListResult)({
            hasMore: page.nextCursor !== undefined,
            items: page.items.map((message) => ({
              activityAt: message.activityAt,
              direction: message.direction,
              hasAttachments: message.hasAttachments,
              id: message.id,
              read: message.read,
              recipients: message.recipients,
              sender: message.sender,
              snippet: message.snippet,
              starred: message.starred,
              subject: message.subject,
              threadId: message.threadId,
            })),
          }).pipe(Effect.mapError((cause) => readingError("storage", cause)));
        }),
      openThread: (input) =>
        Effect.gen(function* () {
          const access = yield* requireRead(input);
          if (access._tag === "FolderMessageRead") {
            const location = yield* authorization.requireMessage({
              action: "read",
              resource: {
                _tag: "Message",
                mailboxId: input.mailboxId,
                messageId: input.messageId,
              },
            });
            if (location.folderId !== access.folderId) {
              return yield* readingError("not-found");
            }
          }
          const anchor = yield* repository
            .getMessage({
              mailboxId: input.mailboxId,
              messageId: input.messageId,
            })
            .pipe(Effect.mapError(mapRepositoryError));
          const anchorBelongsToView =
            anchor.threadId === input.threadId &&
            (input._tag === "Folder"
              ? anchor.folderId === input.folderId
              : anchor.labelIds.includes(input.labelId));
          if (!anchorBelongsToView) {
            return yield* readingError("not-found");
          }
          const detail = yield* repository
            .getThread({
              mailboxId: input.mailboxId,
              threadId: input.threadId,
            })
            .pipe(Effect.mapError(mapRepositoryError));
          if (
            detail.thread.mailboxId !== input.mailboxId ||
            detail.thread.id !== input.threadId
          ) {
            return yield* readingError(
              "storage",
              new Error("Mailbox thread identity invariant failed")
            );
          }
          if (access._tag === "FolderMessageRead") {
            yield* Effect.all(
              detail.messages.map((message) =>
                authorization.requireMessage({
                  action: "read",
                  resource: {
                    _tag: "Message",
                    mailboxId: input.mailboxId,
                    messageId: message.id,
                  },
                })
              ),
              { concurrency: 4, discard: true }
            );
          }
          const projectedThread =
            access._tag === "FolderMessageRead" &&
            detail.messages.length < detail.thread.messageCount
              ? {
                  id: detail.thread.id,
                  latestActivityAt: detail.messages.at(-1)?.activityAt,
                  messageCount: detail.messages.length,
                  subject: detail.messages.at(-1)?.subject,
                  unreadCount: detail.messages.filter(
                    (message) => !message.read
                  ).length,
                }
              : detail.thread;

          return yield* Schema.decodeUnknownEffect(MailboxThreadResult)({
            hasMore:
              detail.nextCursor !== undefined ||
              detail.messages.length < detail.thread.messageCount,
            messages: detail.messages.map((message) => ({
              activityAt: message.activityAt,
              attachments: message.attachments.map((attachment) => ({
                disposition: attachment.disposition,
                fileName: attachment.fileName,
                id: attachment.id,
                mimeType: attachment.mimeType,
                size: attachment.size,
              })),
              cc: message.cc,
              direction: message.direction,
              hasHtmlBody: message.htmlBody !== undefined,
              id: message.id,
              read: message.read,
              sender: message.sender,
              textBody: message.textBody,
              to: message.to,
            })),
            thread: {
              id: projectedThread.id,
              latestActivityAt: projectedThread.latestActivityAt,
              messageCount: projectedThread.messageCount,
              subject: projectedThread.subject,
              unreadCount: projectedThread.unreadCount,
            },
          }).pipe(Effect.mapError((cause) => readingError("storage", cause)));
        }),
    });
  })
);
