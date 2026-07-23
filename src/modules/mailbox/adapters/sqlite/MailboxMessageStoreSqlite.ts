import {
  and,
  asc,
  count,
  desc,
  eq,
  getTableColumns,
  isNotNull,
  isNull,
  sql,
} from "drizzle-orm";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import {
  Cursor,
  MailboxId,
  MessageId,
  UnixMillis,
  Version,
} from "#/modules/mailbox/domain/Mailbox";
import { MailboxDomainError } from "#/modules/mailbox/domain/MailboxError";
import {
  AddMessageLabelInput,
  AttachmentBlobLocation,
  AttachmentMetadata,
  MoveMessageInput,
  MessageDetailSchema,
  MessageFilters as MessageFiltersSchema,
  MessageMutationResult,
  MessagePage,
  MessageSummarySchema,
  RemoveMessageLabelInput,
  SetMessageReadInput,
  SetMessageStarredInput,
  ThreadDetailSchema,
  ThreadSummarySchema,
} from "#/modules/mailbox/domain/MailboxMessage";
import type {
  GetMessageInput,
  GetAttachmentBlobInput,
  GetThreadInput,
  ListMessagesInput,
  MessageFilters,
  SearchMessagesInput,
} from "#/modules/mailbox/domain/MailboxMessage";
import { MailboxIdentity } from "#/modules/mailbox/ports/MailboxIdentity";

import { MailboxOperationStore } from "./MailboxOperationStoreSqlite";
import { MailboxDatabase } from "./MailboxSqliteDatabase";
import {
  AddressList,
  decodeJson,
  optionalAddress,
  StringList,
} from "./MailboxSqliteJson";
import { MailboxRuntime } from "./MailboxSqliteRuntime";
import {
  attachment,
  folder,
  inboundProcessing,
  label,
  message,
  messageLabel,
  outboundDelivery,
} from "./MailboxSqliteSchema";

const readMessageDetailRow = (
  db: Omit<MailboxDatabase, "$client">,
  row: typeof message.$inferSelect,
  mailboxId: MailboxId
) =>
  Effect.gen(function* () {
    const [labelRows, attachmentRows, deliveryRows] = yield* Effect.all([
      db
        .select({ labelId: messageLabel.labelId })
        .from(messageLabel)
        .innerJoin(label, eq(label.id, messageLabel.labelId))
        .where(and(eq(messageLabel.messageId, row.id), isNull(label.deletedAt)))
        .orderBy(asc(messageLabel.labelId)),
      db
        .select()
        .from(attachment)
        .where(
          and(eq(attachment.messageId, row.id), isNull(attachment.deletedAt))
        )
        .orderBy(asc(attachment.id)),
      row.outboundDeliveryId === null
        ? Effect.succeed([])
        : db
            .select()
            .from(outboundDelivery)
            .where(
              and(
                eq(outboundDelivery.id, row.outboundDeliveryId),
                isNull(outboundDelivery.deletedAt)
              )
            )
            .limit(1),
    ]);
    const attachments = attachmentRows.map((item) =>
      Schema.decodeUnknownSync(AttachmentMetadata)({
        id: item.id,
        messageId: item.messageId,
        fileName: item.fileName,
        mimeType: item.mimeType,
        size: item.size,
        contentId: item.contentId ?? undefined,
        disposition: item.disposition,
      })
    );

    return Schema.decodeUnknownSync(MessageDetailSchema)({
      id: row.id,
      mailboxId,
      folderId: row.folderId,
      threadId: row.threadId,
      direction: row.direction,
      outboundDeliveryId: row.outboundDeliveryId ?? undefined,
      deliveryStatus: deliveryRows[0]?.status,
      subject: row.subject,
      sender: optionalAddress(row.senderJson),
      recipients: decodeJson(AddressList, row.recipientsJson),
      snippet: row.snippet,
      activityAt: row.activityAt,
      read: row.read === 1,
      starred: row.starred === 1,
      hasAttachments: attachments.length > 0,
      labelIds: labelRows.map((item) => item.labelId),
      size: row.size,
      version: row.version,
      rfcMessageId: row.rfcMessageId ?? undefined,
      inReplyTo: row.inReplyTo ?? undefined,
      references: decodeJson(StringList, row.referencesJson),
      to: decodeJson(AddressList, row.toJson),
      cc: decodeJson(AddressList, row.ccJson),
      bcc: decodeJson(AddressList, row.bccJson),
      textBody: row.textBody ?? undefined,
      htmlBody: row.htmlBody ?? undefined,
      headerDate: row.headerDate ?? undefined,
      receivedAt: row.receivedAt ?? undefined,
      scheduledAt: row.scheduledAt ?? undefined,
      acceptedAt: deliveryRows[0]?.acceptedAt ?? undefined,
      attachments,
    });
  });

const readMessageSummaryRow = (
  detail: Schema.Schema.Type<typeof MessageDetailSchema>
) => Schema.decodeUnknownSync(MessageSummarySchema)(detail);

const CursorPayload = Schema.Struct({
  mailboxId: MailboxId,
  scope: Schema.String,
  filterFingerprint: Schema.String,
  activityAt: UnixMillis,
  id: MessageId,
  rank: Schema.optional(Schema.Number),
  snapshotFingerprint: Schema.optional(Schema.String),
});

const messageDomainError = (
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

const fingerprint = (value: string) => {
  let first = 0;
  let second = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    first = (first * 31 + codePoint) % 2_147_483_647;
    second = (second * 131 + codePoint) % 2_147_483_629;
  }
  return [first, second]
    .map((part) => part.toString(36).padStart(6, "0"))
    .join("");
};

const filterFingerprint = (filters: MessageFilters | undefined) =>
  fingerprint(
    JSON.stringify(
      filters === undefined
        ? {}
        : Schema.encodeSync(MessageFiltersSchema)(filters)
    )
  );

const searchFingerprint = (
  ftsQuery: string,
  filters: MessageFilters | undefined
) =>
  fingerprint(
    JSON.stringify({
      query: ftsQuery,
      filters:
        filters === undefined
          ? {}
          : Schema.encodeSync(MessageFiltersSchema)(filters),
    })
  );

const toMessageFtsQuery = (query: string) => {
  const terms = query.match(/[\p{L}\p{N}_]+(?:[.@+-][\p{L}\p{N}_]+)*/gu) ?? [];
  return terms.length === 0
    ? undefined
    : terms.map((term) => `"${term.replaceAll('"', '""')}"`).join(" ");
};

const encodeCursor = (payload: Schema.Schema.Type<typeof CursorPayload>) =>
  Schema.decodeUnknownSync(Cursor)(
    btoa(encodeURIComponent(JSON.stringify(payload)))
  );

const decodeCursor = (
  value: string,
  mailboxId: MailboxId,
  scope: string,
  expectedFilterFingerprint: string,
  operation: MailboxDomainError["operation"]
) => {
  const parsed = Result.try({
    try: () => JSON.parse(decodeURIComponent(atob(value))),
    catch: () =>
      messageDomainError(operation, "validation", "Message cursor is invalid"),
  });
  if (Result.isFailure(parsed)) {
    return parsed;
  }
  const decoded = Schema.decodeUnknownResult(CursorPayload)(parsed.success);
  if (Result.isFailure(decoded)) {
    return Result.fail(
      messageDomainError(operation, "validation", "Message cursor is invalid")
    );
  }
  const cursor = decoded.success;
  return cursor.mailboxId === mailboxId &&
    cursor.scope === scope &&
    cursor.filterFingerprint === expectedFilterFingerprint
    ? Result.succeed(cursor)
    : Result.fail(
        messageDomainError(
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

const listMessages = (mailboxId: MailboxId, input: ListMessagesInput) =>
  Effect.gen(function* () {
    const db = yield* MailboxDatabase;
    const key = filterFingerprint(input.filters);
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
              filterFingerprint: key,
              activityAt: last.activityAt,
              id: last.id,
            })
          : undefined,
    });
  });

const searchMessages = (mailboxId: MailboxId, input: SearchMessagesInput) =>
  Effect.gen(function* () {
    const db = yield* MailboxDatabase;
    const ftsQuery = toMessageFtsQuery(input.query);
    if (ftsQuery === undefined) {
      return yield* messageDomainError(
        "search-messages",
        "validation",
        "Search query has no searchable terms"
      );
    }
    const key = searchFingerprint(ftsQuery, input.filters);
    const decodedCursor =
      input.page?.cursor === undefined
        ? Result.void
        : decodeCursor(
            input.page.cursor,
            mailboxId,
            "messages-search",
            key,
            "search-messages"
          );
    if (Result.isFailure(decodedCursor)) {
      return yield* decodedCursor.failure;
    }
    const cursor = decodedCursor.success;
    if (
      cursor !== undefined &&
      (cursor.rank === undefined || cursor.snapshotFingerprint === undefined)
    ) {
      return yield* messageDomainError(
        "search-messages",
        "validation",
        "Message cursor does not match this query"
      );
    }
    const cursorRank = cursor?.rank ?? Number.NEGATIVE_INFINITY;
    const rank = sql<number>`(
      SELECT bm25(message_search)
      FROM message_search
      WHERE message_search.rowid = "message".rowid
        AND message_search MATCH ${ftsQuery}
    )`;
    const rows = yield* db
      .select({ ...getTableColumns(message), searchRank: rank })
      .from(message)
      .where(
        and(
          isNull(message.deletedAt),
          sql`"message".rowid IN (
            SELECT rowid FROM message_search WHERE message_search MATCH ${ftsQuery}
          )`
        )
      )
      .orderBy(rank, desc(message.activityAt), desc(message.id));
    const hydrated = yield* Effect.all(
      rows.map((row) =>
        Effect.map(readMessageDetailRow(db, row, mailboxId), (detail) => ({
          row,
          rank: row.searchRank,
          detail,
          summary: readMessageSummaryRow(detail),
        }))
      )
    );
    const matching = hydrated.filter(({ detail, row, summary }) =>
      matchesFilters(summary, detail, row, input.filters)
    );
    const snapshotFingerprint = fingerprint(
      JSON.stringify(
        matching.map(({ rank: searchRank, summary }) => [
          searchRank,
          summary.activityAt,
          summary.id,
        ])
      )
    );
    if (
      cursor !== undefined &&
      cursor.snapshotFingerprint !== snapshotFingerprint
    ) {
      return yield* messageDomainError(
        "search-messages",
        "validation",
        "Message cursor does not match the current search results"
      );
    }
    const filtered = matching.filter(
      ({ rank: searchRank, summary }) =>
        cursor === undefined ||
        searchRank > cursorRank ||
        (searchRank === cursorRank &&
          (summary.activityAt < cursor.activityAt ||
            (summary.activityAt === cursor.activityAt &&
              summary.id < cursor.id)))
    );
    const limit = input.page?.limit ?? 50;
    const page = filtered.slice(0, limit);
    const items = page.map(({ summary }) => summary);
    const last = page.at(-1);
    return Schema.decodeUnknownSync(MessagePage)({
      items,
      nextCursor:
        filtered.length > limit && last !== undefined
          ? encodeCursor({
              mailboxId,
              scope: "messages-search",
              filterFingerprint: key,
              activityAt: last.summary.activityAt,
              id: last.summary.id,
              rank: last.rank,
              snapshotFingerprint,
            })
          : undefined,
    });
  });

const getMessage = (mailboxId: MailboxId, input: GetMessageInput) =>
  Effect.gen(function* () {
    const db = yield* MailboxDatabase;
    const [row] = yield* db
      .select()
      .from(message)
      .where(and(eq(message.id, input.messageId), isNull(message.deletedAt)))
      .limit(1);
    if (row === undefined) {
      return yield* messageDomainError(
        "get-message",
        "not-found",
        "Message was not found",
        { resourceType: "message", resourceId: input.messageId }
      );
    }
    return yield* readMessageDetailRow(db, row, mailboxId);
  });

const getAttachmentBlob = (
  mailboxId: MailboxId,
  input: GetAttachmentBlobInput
) =>
  Effect.gen(function* () {
    const db = yield* MailboxDatabase;
    const [row] = yield* db
      .select({
        attachmentId: attachment.id,
        contentId: attachment.contentId,
        disposition: attachment.disposition,
        fileName: attachment.fileName,
        folderId: message.folderId,
        inboundIngestId: attachment.inboundIngestId,
        messageId: message.id,
        mimeType: attachment.mimeType,
        receivedAt: message.receivedAt,
        size: attachment.size,
        sourceIndex: attachment.sourceIndex,
      })
      .from(attachment)
      .innerJoin(message, eq(message.id, attachment.messageId))
      .innerJoin(folder, eq(folder.id, message.folderId))
      .innerJoin(
        inboundProcessing,
        and(
          eq(inboundProcessing.id, attachment.inboundIngestId),
          eq(inboundProcessing.messageId, attachment.messageId)
        )
      )
      .where(
        and(
          eq(attachment.id, input.attachmentId),
          eq(attachment.messageId, input.messageId),
          eq(attachment.disposition, "inline"),
          eq(inboundProcessing.status, "ready"),
          isNotNull(attachment.contentId),
          isNotNull(attachment.inboundIngestId),
          isNotNull(attachment.sourceIndex),
          isNotNull(message.receivedAt),
          isNull(attachment.deletedAt),
          isNull(message.deletedAt),
          isNull(folder.deletedAt)
        )
      )
      .limit(1);
    if (row === undefined) {
      return yield* messageDomainError(
        "get-attachment",
        "not-found",
        "Inline attachment was not found",
        { resourceType: "attachment", resourceId: input.attachmentId }
      );
    }
    return yield* Schema.decodeUnknownEffect(AttachmentBlobLocation)({
      ...row,
      mailboxId,
    });
  });

const getThread = (mailboxId: MailboxId, input: GetThreadInput) =>
  Effect.gen(function* () {
    const db = yield* MailboxDatabase;
    const key = fingerprint(JSON.stringify({ threadId: input.threadId }));
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
    const threadPredicate = and(
      eq(message.threadId, input.threadId),
      isNull(message.deletedAt)
    );
    const rows =
      input.page === undefined
        ? yield* db
            .select()
            .from(message)
            .where(threadPredicate)
            .orderBy(desc(message.activityAt), desc(message.id))
            .limit(50)
            .pipe(
              Effect.map((latest) => {
                const chronological: typeof latest = [];
                for (let index = latest.length - 1; index >= 0; index -= 1) {
                  const row = latest[index];
                  if (row !== undefined) {
                    chronological.push(row);
                  }
                }
                return chronological;
              })
            )
        : yield* db
            .select()
            .from(message)
            .where(threadPredicate)
            .orderBy(asc(message.activityAt), asc(message.id));
    const [stats] = yield* db
      .select({
        messageCount: count(message.id),
        unreadCount: sql<number>`coalesce(sum(case when ${message.read} = 0 then 1 else 0 end), 0)`,
      })
      .from(message)
      .where(threadPredicate);
    const all = yield* Effect.all(
      rows.map((row) => readMessageDetailRow(db, row, mailboxId))
    );
    if (all.length === 0) {
      return yield* messageDomainError(
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
      messageCount: stats?.messageCount,
      unreadCount: stats?.unreadCount,
      latestActivityAt: all.at(-1)?.activityAt,
    });
    const cursor = decodedCursor.success;
    const remaining = all.filter((item) =>
      cursor === undefined
        ? true
        : item.activityAt > cursor.activityAt ||
          (item.activityAt === cursor.activityAt && item.id > cursor.id)
    );
    // Opening a thread prioritizes its latest replies while explicit cursor
    // pagination retains the existing chronological forward traversal.
    const limit = input.page?.limit ?? 50;
    const messages = remaining.slice(0, limit);
    const last = messages.at(-1);
    return Schema.decodeUnknownSync(ThreadDetailSchema)({
      thread,
      messages,
      nextCursor:
        input.page !== undefined &&
        remaining.length > limit &&
        last !== undefined
          ? encodeCursor({
              mailboxId,
              scope: `thread:${input.threadId}:asc`,
              filterFingerprint: key,
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

const messageMutationOperationKind = (mutation: MessageMutation) => {
  switch (mutation._tag) {
    case "Read": {
      return "set-message-read";
    }
    case "Starred": {
      return "set-message-starred";
    }
    case "Move": {
      return "move-message";
    }
    case "AddLabel": {
      return "add-message-label";
    }
    case "RemoveLabel": {
      return "remove-message-label";
    }
    default: {
      const exhaustive: never = mutation;
      return exhaustive;
    }
  }
};

const messageMutationRequestKey = (mutation: MessageMutation) => {
  switch (mutation._tag) {
    case "Read": {
      return JSON.stringify(
        Schema.encodeSync(SetMessageReadInput)(mutation.input)
      );
    }
    case "Starred": {
      return JSON.stringify(
        Schema.encodeSync(SetMessageStarredInput)(mutation.input)
      );
    }
    case "Move": {
      return JSON.stringify(
        Schema.encodeSync(MoveMessageInput)(mutation.input)
      );
    }
    case "AddLabel": {
      return JSON.stringify(
        Schema.encodeSync(AddMessageLabelInput)(mutation.input)
      );
    }
    case "RemoveLabel": {
      return JSON.stringify(
        Schema.encodeSync(RemoveMessageLabelInput)(mutation.input)
      );
    }
    default: {
      const exhaustive: never = mutation;
      return exhaustive;
    }
  }
};

const mutateMessage = (
  mailboxId: MailboxId,
  mutation: MessageMutation,
  runtime: MailboxRuntime,
  operations: MailboxOperationStore
) =>
  Effect.gen(function* () {
    const db = yield* MailboxDatabase;
    return yield* db.transaction((tx) =>
      Effect.gen(function* () {
        const { input } = mutation;
        const operationKind = messageMutationOperationKind(mutation);
        const requestKey = messageMutationRequestKey(mutation);
        const previous = yield* operations.replay(
          input.operationId,
          "mutate-message",
          operationKind,
          requestKey,
          MessageMutationResult
        );
        if (previous !== undefined) {
          if (Result.isFailure(previous)) {
            return yield* previous.failure;
          }
          return previous.success;
        }
        const [row] = yield* tx
          .select()
          .from(message)
          .where(
            and(eq(message.id, input.messageId), isNull(message.deletedAt))
          )
          .limit(1);
        if (row === undefined) {
          return yield* messageDomainError(
            "mutate-message",
            "not-found",
            "Message was not found",
            { resourceType: "message", resourceId: input.messageId }
          );
        }
        if (row.version !== input.expectedVersion) {
          return yield* messageDomainError(
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
              return yield* messageDomainError(
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
            const [target] = yield* tx
              .select({ id: label.id })
              .from(label)
              .where(
                and(
                  eq(label.id, mutation.input.labelId),
                  isNull(label.deletedAt)
                )
              )
              .limit(1);
            if (target === undefined) {
              return yield* messageDomainError(
                "mutate-message",
                "not-found",
                "Label was not found",
                {
                  resourceType: "label",
                  resourceId: mutation.input.labelId,
                }
              );
            }
            yield* tx
              .insert(messageLabel)
              .values({
                messageId: input.messageId,
                labelId: mutation.input.labelId,
              })
              .onConflictDoNothing();
            yield* tx
              .update(message)
              .set({ updatedAt: sql`max(${message.updatedAt}, ${now})` })
              .where(eq(message.id, input.messageId));
            break;
          }
          case "RemoveLabel": {
            const [target] = yield* tx
              .select({ id: label.id })
              .from(label)
              .where(
                and(
                  eq(label.id, mutation.input.labelId),
                  isNull(label.deletedAt)
                )
              )
              .limit(1);
            if (target === undefined) {
              return yield* messageDomainError(
                "mutate-message",
                "not-found",
                "Label was not found",
                {
                  resourceType: "label",
                  resourceId: mutation.input.labelId,
                }
              );
            }
            yield* tx
              .delete(messageLabel)
              .where(
                and(
                  eq(messageLabel.messageId, input.messageId),
                  eq(messageLabel.labelId, mutation.input.labelId)
                )
              );
            yield* tx
              .update(message)
              .set({ updatedAt: sql`max(${message.updatedAt}, ${now})` })
              .where(eq(message.id, input.messageId));
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
          return yield* messageDomainError(
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
        const result = readMessageSummaryRow(detail);
        yield* operations.store(
          input.operationId,
          operationKind,
          requestKey,
          input.messageId,
          JSON.stringify(Schema.encodeSync(MessageMutationResult)(result)),
          now
        );
        return result;
      })
    );
  });

const makeMailboxMessageStore = (
  db: MailboxDatabase,
  runtime: MailboxRuntime,
  mailboxId: MailboxId,
  operations: MailboxOperationStore
) => {
  const provideDatabase = <A, E>(
    effect: Effect.Effect<A, E, MailboxDatabase>
  ) => effect.pipe(Effect.provideService(MailboxDatabase, db));

  return {
    listMessages: (input: ListMessagesInput) =>
      provideDatabase(listMessages(mailboxId, input)),
    searchMessages: (input: SearchMessagesInput) =>
      provideDatabase(searchMessages(mailboxId, input)),
    getMessage: (input: GetMessageInput) =>
      provideDatabase(getMessage(mailboxId, input)),
    getAttachmentBlob: (input: GetAttachmentBlobInput) =>
      provideDatabase(getAttachmentBlob(mailboxId, input)),
    getThread: (input: GetThreadInput) =>
      provideDatabase(getThread(mailboxId, input)),
    setMessageRead: (input: SetMessageReadInput) =>
      provideDatabase(
        mutateMessage(mailboxId, { _tag: "Read", input }, runtime, operations)
      ),
    setMessageStarred: (input: SetMessageStarredInput) =>
      provideDatabase(
        mutateMessage(
          mailboxId,
          { _tag: "Starred", input },
          runtime,
          operations
        )
      ),
    moveMessage: (input: MoveMessageInput) =>
      provideDatabase(
        mutateMessage(mailboxId, { _tag: "Move", input }, runtime, operations)
      ),
    addMessageLabel: (input: AddMessageLabelInput) =>
      provideDatabase(
        mutateMessage(
          mailboxId,
          { _tag: "AddLabel", input },
          runtime,
          operations
        )
      ),
    removeMessageLabel: (input: RemoveMessageLabelInput) =>
      provideDatabase(
        mutateMessage(
          mailboxId,
          { _tag: "RemoveLabel", input },
          runtime,
          operations
        )
      ),
  };
};

export type MailboxMessageStore = ReturnType<typeof makeMailboxMessageStore>;

export const MailboxMessageStore = Context.Service<MailboxMessageStore>(
  "cloudflare-inbox/MailboxMessageStore"
);

export const MailboxMessageStoreSqliteLayer = Layer.effect(
  MailboxMessageStore,
  Effect.gen(function* () {
    const db = yield* MailboxDatabase;
    const runtime = yield* MailboxRuntime;
    const { mailboxId } = yield* MailboxIdentity;
    const operations = yield* MailboxOperationStore;
    return MailboxMessageStore.of(
      makeMailboxMessageStore(db, runtime, mailboxId, operations)
    );
  })
);
