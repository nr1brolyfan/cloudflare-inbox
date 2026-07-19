import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { MailboxDomainError } from "./errors/mailbox-domain-error";
import { Cursor } from "./identifiers";
import type { MailboxId } from "./identifiers";
import { MailboxDatabase } from "./mailbox-database";
import type { MailboxDirectoryRuntime } from "./mailbox-directory-runtime";
import {
  readMessageDetailRow,
  readMessageSummaryRow,
} from "./mailbox-mail-row";
import { folder, label, message, messageLabel } from "./mailbox-schema";
import type {
  AddMessageLabelInput,
  GetMessageInput,
  GetThreadInput,
  ListMessagesInput,
  MessageFilters,
  MoveMessageInput,
  RemoveMessageLabelInput,
  SetMessageReadInput,
  SetMessageStarredInput,
} from "./message-contract";
import {
  MessageFilters as MessageFiltersSchema,
  MessagePage,
} from "./message-contract";
import { Version } from "./primitives";
import { ThreadDetailSchema } from "./thread-detail";
import { ThreadSummarySchema } from "./thread-summary";

const CursorPayload = Schema.Struct({
  mailboxId: Schema.String,
  scope: Schema.String,
  filterKey: Schema.String,
  activityAt: Schema.Number,
  id: Schema.String,
});

const domainError = (
  operation: MailboxDomainError["operation"],
  reason: MailboxDomainError["reason"],
  messageText: string,
  details: Pick<
    MailboxDomainError,
    "resourceType" | "resourceId" | "expectedVersion" | "actualVersion"
  > = {}
) =>
  new MailboxDomainError({
    operation,
    reason,
    message: messageText,
    ...details,
  });

const filterKey = (filters: MessageFilters | undefined) =>
  JSON.stringify(
    filters === undefined
      ? {}
      : Schema.encodeSync(MessageFiltersSchema)(filters)
  );

const encodeCursor = (payload: Schema.Schema.Type<typeof CursorPayload>) =>
  Schema.decodeUnknownSync(Cursor)(
    btoa(encodeURIComponent(JSON.stringify(payload)))
  );

const decodeCursor = (
  value: string,
  mailboxId: MailboxId,
  scope: string,
  expectedFilterKey: string,
  operation: MailboxDomainError["operation"]
) => {
  const parsed = Result.try({
    try: () => JSON.parse(decodeURIComponent(atob(value))),
    catch: () =>
      domainError(operation, "validation", "Message cursor is invalid"),
  });
  if (Result.isFailure(parsed)) {
    return parsed;
  }
  const decoded = Schema.decodeUnknownResult(CursorPayload)(parsed.success);
  if (Result.isFailure(decoded)) {
    return Result.fail(
      domainError(operation, "validation", "Message cursor is invalid")
    );
  }
  const cursor = decoded.success;
  return cursor.mailboxId === mailboxId &&
    cursor.scope === scope &&
    cursor.filterKey === expectedFilterKey
    ? Result.succeed(cursor)
    : Result.fail(
        domainError(
          operation,
          "validation",
          "Message cursor does not match this query"
        )
      );
};

const addressMatches = (
  addresses: readonly { readonly address: string }[],
  expected: string | undefined
) =>
  expected === undefined ||
  addresses.some((address) => address.address === expected);

const matchesLocationFilters = (
  messageSummary: ReturnType<typeof readMessageSummaryRow>,
  detail: Effect.Success<ReturnType<typeof readMessageDetailRow>>,
  filters: MessageFilters
) =>
  (filters.folderId === undefined ||
    messageSummary.folderId === filters.folderId) &&
  (filters.labelIds === undefined ||
    filters.labelIds.every((labelId) =>
      messageSummary.labelIds.includes(labelId)
    )) &&
  (filters.from === undefined ||
    messageSummary.sender?.address === filters.from) &&
  addressMatches(detail.to, filters.to) &&
  addressMatches(detail.cc, filters.cc);

const matchesStateFilters = (
  messageSummary: ReturnType<typeof readMessageSummaryRow>,
  row: typeof message.$inferSelect,
  filters: MessageFilters
) =>
  (filters.after === undefined || messageSummary.activityAt >= filters.after) &&
  (filters.before === undefined ||
    messageSummary.activityAt < filters.before) &&
  (filters.read === undefined || messageSummary.read === filters.read) &&
  (filters.starred === undefined ||
    messageSummary.starred === filters.starred) &&
  (filters.hasAttachment === undefined ||
    messageSummary.hasAttachments === filters.hasAttachment) &&
  (filters.direction === undefined ||
    messageSummary.direction === filters.direction) &&
  (filters.deliveryStatus === undefined ||
    messageSummary.deliveryStatus === filters.deliveryStatus) &&
  (filters.needsReply === undefined ||
    (row.needsReply === 1) === filters.needsReply);

const matchesFilters = (
  messageSummary: ReturnType<typeof readMessageSummaryRow>,
  detail: Effect.Success<ReturnType<typeof readMessageDetailRow>>,
  row: typeof message.$inferSelect,
  filters: MessageFilters | undefined
) =>
  filters === undefined ||
  (matchesLocationFilters(messageSummary, detail, filters) &&
    matchesStateFilters(messageSummary, row, filters));

export const listMessages = (mailboxId: MailboxId, input: ListMessagesInput) =>
  Effect.gen(function* () {
    const db = yield* MailboxDatabase;
    const key = filterKey(input.filters);
    const decodedCursor =
      input.page?.cursor === undefined
        ? Result.void
        : decodeCursor(
            input.page.cursor,
            mailboxId,
            "messages-desc",
            key,
            "list-messages"
          );
    if (Result.isFailure(decodedCursor)) {
      return yield* decodedCursor.failure;
    }
    const cursor = decodedCursor.success;
    const rows = yield* db
      .select()
      .from(message)
      .where(isNull(message.deletedAt))
      .orderBy(desc(message.activityAt), desc(message.id));
    const hydrated = yield* Effect.all(
      rows
        .filter((row) =>
          cursor === undefined
            ? true
            : row.activityAt < cursor.activityAt ||
              (row.activityAt === cursor.activityAt && row.id < cursor.id)
        )
        .map((row) =>
          Effect.map(readMessageDetailRow(db, row, mailboxId), (detail) => ({
            row,
            detail,
            summary: readMessageSummaryRow(detail),
          }))
        )
    );
    const filtered = hydrated.filter(({ detail, row, summary }) =>
      matchesFilters(summary, detail, row, input.filters)
    );
    const limit = input.page?.limit ?? 50;
    const items = filtered.slice(0, limit).map(({ summary }) => summary);
    const last = filtered.at(limit - 1)?.summary;
    return Schema.decodeUnknownSync(MessagePage)({
      items,
      nextCursor:
        filtered.length > limit && last !== undefined
          ? encodeCursor({
              mailboxId,
              scope: "messages-desc",
              filterKey: key,
              activityAt: last.activityAt,
              id: last.id,
            })
          : undefined,
    });
  });

export const getMessage = (mailboxId: MailboxId, input: GetMessageInput) =>
  Effect.gen(function* () {
    const db = yield* MailboxDatabase;
    const [row] = yield* db
      .select()
      .from(message)
      .where(and(eq(message.id, input.messageId), isNull(message.deletedAt)))
      .limit(1);
    if (row === undefined) {
      return yield* domainError(
        "get-message",
        "not-found",
        "Message was not found",
        { resourceType: "message", resourceId: input.messageId }
      );
    }
    return yield* readMessageDetailRow(db, row, mailboxId);
  });

export const getThread = (mailboxId: MailboxId, input: GetThreadInput) =>
  Effect.gen(function* () {
    const db = yield* MailboxDatabase;
    const key = JSON.stringify({ threadId: input.threadId });
    const decodedCursor =
      input.page?.cursor === undefined
        ? Result.void
        : decodeCursor(
            input.page.cursor,
            mailboxId,
            `thread:${input.threadId}:asc`,
            key,
            "get-thread"
          );
    if (Result.isFailure(decodedCursor)) {
      return yield* decodedCursor.failure;
    }
    const rows = yield* db
      .select()
      .from(message)
      .where(
        and(eq(message.threadId, input.threadId), isNull(message.deletedAt))
      )
      .orderBy(asc(message.activityAt), asc(message.id));
    const all = yield* Effect.all(
      rows.map((row) => readMessageDetailRow(db, row, mailboxId))
    );
    if (all.length === 0) {
      return yield* domainError(
        "get-thread",
        "not-found",
        "Thread was not found",
        { resourceType: "thread", resourceId: input.threadId }
      );
    }
    const participants = [
      ...new Map(
        all
          .flatMap((item) => [
            ...(item.sender === undefined ? [] : [item.sender]),
            ...item.recipients,
          ])
          .map((address) => [address.address, address])
      ).values(),
    ];
    const thread = Schema.decodeUnknownSync(ThreadSummarySchema)({
      id: input.threadId,
      mailboxId,
      subject: all.at(-1)?.subject,
      participants,
      messageCount: all.length,
      unreadCount: all.filter((item) => !item.read).length,
      latestActivityAt: all.at(-1)?.activityAt,
    });
    const cursor = decodedCursor.success;
    const remaining = all.filter((item) =>
      cursor === undefined
        ? true
        : item.activityAt > cursor.activityAt ||
          (item.activityAt === cursor.activityAt && item.id > cursor.id)
    );
    const limit = input.page?.limit ?? 50;
    const messages = remaining.slice(0, limit);
    const last = messages.at(-1);
    return Schema.decodeUnknownSync(ThreadDetailSchema)({
      thread,
      messages,
      nextCursor:
        remaining.length > limit && last !== undefined
          ? encodeCursor({
              mailboxId,
              scope: `thread:${input.threadId}:asc`,
              filterKey: key,
              activityAt: last.activityAt,
              id: last.id,
            })
          : undefined,
    });
  });

type MessageMutation =
  | { readonly _tag: "Read"; readonly input: SetMessageReadInput }
  | { readonly _tag: "Starred"; readonly input: SetMessageStarredInput }
  | { readonly _tag: "Move"; readonly input: MoveMessageInput }
  | { readonly _tag: "AddLabel"; readonly input: AddMessageLabelInput }
  | { readonly _tag: "RemoveLabel"; readonly input: RemoveMessageLabelInput };

const mutateMessage = (
  mailboxId: MailboxId,
  mutation: MessageMutation,
  runtime: MailboxDirectoryRuntime
) =>
  Effect.gen(function* () {
    const db = yield* MailboxDatabase;
    return yield* db.transaction((tx) =>
      Effect.gen(function* () {
        const { input } = mutation;
        const [row] = yield* tx
          .select()
          .from(message)
          .where(
            and(eq(message.id, input.messageId), isNull(message.deletedAt))
          )
          .limit(1);
        if (row === undefined) {
          return yield* domainError(
            "mutate-message",
            "not-found",
            "Message was not found",
            { resourceType: "message", resourceId: input.messageId }
          );
        }
        if (row.version !== input.expectedVersion) {
          return yield* domainError(
            "mutate-message",
            "version-conflict",
            "Message version does not match",
            {
              resourceType: "message",
              resourceId: input.messageId,
              expectedVersion: input.expectedVersion,
              actualVersion: Schema.decodeUnknownSync(Version)(row.version),
            }
          );
        }

        const now = runtime.now();
        const mutateLabel = (labelId: string, add: boolean) =>
          Effect.gen(function* () {
            const [target] = yield* tx
              .select({ id: label.id })
              .from(label)
              .where(and(eq(label.id, labelId), isNull(label.deletedAt)))
              .limit(1);
            if (target === undefined) {
              return yield* domainError(
                "mutate-message",
                "not-found",
                "Label was not found",
                { resourceType: "label", resourceId: labelId }
              );
            }
            if (add) {
              yield* tx
                .insert(messageLabel)
                .values({ messageId: input.messageId, labelId })
                .onConflictDoNothing();
            }
            if (!add) {
              yield* tx
                .delete(messageLabel)
                .where(
                  and(
                    eq(messageLabel.messageId, input.messageId),
                    eq(messageLabel.labelId, labelId)
                  )
                );
            }
            yield* tx
              .update(message)
              .set({ updatedAt: sql`max(${message.updatedAt}, ${now})` })
              .where(eq(message.id, input.messageId));
          });

        switch (mutation._tag) {
          case "Read": {
            yield* tx
              .update(message)
              .set({
                read: mutation.input.read ? 1 : 0,
                updatedAt: sql`max(${message.updatedAt}, ${now})`,
              })
              .where(eq(message.id, input.messageId));
            break;
          }
          case "Starred": {
            yield* tx
              .update(message)
              .set({
                starred: mutation.input.starred ? 1 : 0,
                updatedAt: sql`max(${message.updatedAt}, ${now})`,
              })
              .where(eq(message.id, input.messageId));
            break;
          }
          case "Move": {
            const [target] = yield* tx
              .select({ id: folder.id })
              .from(folder)
              .where(
                and(
                  eq(folder.id, mutation.input.folderId),
                  isNull(folder.deletedAt)
                )
              )
              .limit(1);
            if (target === undefined) {
              return yield* domainError(
                "mutate-message",
                "not-found",
                "Target folder was not found",
                {
                  resourceType: "folder",
                  resourceId: mutation.input.folderId,
                }
              );
            }
            yield* tx
              .update(message)
              .set({
                folderId: mutation.input.folderId,
                updatedAt: sql`max(${message.updatedAt}, ${now})`,
              })
              .where(eq(message.id, input.messageId));
            break;
          }
          case "AddLabel": {
            yield* mutateLabel(mutation.input.labelId, true);
            break;
          }
          case "RemoveLabel": {
            yield* mutateLabel(mutation.input.labelId, false);
            break;
          }
          default: {
            const exhaustive: never = mutation;
            return exhaustive;
          }
        }

        const [next] = yield* tx
          .update(message)
          .set({ version: sql`${message.version} + 1` })
          .where(
            and(
              eq(message.id, input.messageId),
              eq(message.version, input.expectedVersion)
            )
          )
          .returning();
        if (next === undefined) {
          return yield* domainError(
            "mutate-message",
            "version-conflict",
            "Message version does not match",
            {
              resourceType: "message",
              resourceId: input.messageId,
              expectedVersion: input.expectedVersion,
              actualVersion: Schema.decodeUnknownSync(Version)(row.version),
            }
          );
        }
        const detail = yield* readMessageDetailRow(tx, next, mailboxId);
        return readMessageSummaryRow(detail);
      })
    );
  });

export const setMessageRead = (
  mailboxId: MailboxId,
  input: SetMessageReadInput,
  runtime: MailboxDirectoryRuntime
) => mutateMessage(mailboxId, { _tag: "Read", input }, runtime);

export const setMessageStarred = (
  mailboxId: MailboxId,
  input: SetMessageStarredInput,
  runtime: MailboxDirectoryRuntime
) => mutateMessage(mailboxId, { _tag: "Starred", input }, runtime);

export const moveMessage = (
  mailboxId: MailboxId,
  input: MoveMessageInput,
  runtime: MailboxDirectoryRuntime
) => mutateMessage(mailboxId, { _tag: "Move", input }, runtime);

export const addMessageLabel = (
  mailboxId: MailboxId,
  input: AddMessageLabelInput,
  runtime: MailboxDirectoryRuntime
) => mutateMessage(mailboxId, { _tag: "AddLabel", input }, runtime);

export const removeMessageLabel = (
  mailboxId: MailboxId,
  input: RemoveMessageLabelInput,
  runtime: MailboxDirectoryRuntime
) => mutateMessage(mailboxId, { _tag: "RemoveLabel", input }, runtime);
