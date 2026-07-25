import { and, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { Cursor, DraftId, MailboxId } from "#/modules/mailbox/domain/Mailbox";
import {
  CreateDraftInput,
  CreateReplyDraftInput,
  DraftPage,
  DraftSchema,
  DraftSummary,
  ReplyDraftOperationResult,
  UpdateDraftInput,
} from "#/modules/mailbox/domain/MailboxDraft";
import type {
  GetDraftInput,
  ListDraftsInput,
} from "#/modules/mailbox/domain/MailboxDraft";
import { MailboxDomainError } from "#/modules/mailbox/domain/MailboxError";
import { MailboxIdentity } from "#/modules/mailbox/ports/MailboxIdentity";
import { normalizeEmailAddressDomain } from "#/shared/EmailAddress";
import { MailAddress } from "#/shared/MailAddress";
import { UnixMillis, Version } from "#/shared/Temporal";

import { readMessageDetailRow } from "./MailboxMessageStoreSqlite";
import { MailboxOperationStore } from "./MailboxOperationStoreSqlite";
import { MailboxDatabase } from "./MailboxSqliteDatabase";
import {
  AddressList,
  decodeJson,
  encodeJson,
  StringList,
} from "./MailboxSqliteJson";
import { MailboxRuntime } from "./MailboxSqliteRuntime";
import { draft, message } from "./MailboxSqliteSchema";

const readDraftRow = (row: typeof draft.$inferSelect, mailboxId: MailboxId) =>
  Schema.decodeUnknownSync(DraftSchema)({
    id: row.id,
    mailboxId,
    threadId: row.threadId ?? undefined,
    inReplyToMessageId: row.inReplyToMessageId ?? undefined,
    to: decodeJson(AddressList, row.toJson),
    cc: decodeJson(AddressList, row.ccJson),
    bcc: decodeJson(AddressList, row.bccJson),
    subject: row.subject,
    textBody: row.textBody ?? undefined,
    htmlBody: row.htmlBody ?? undefined,
    attachmentIds: decodeJson(StringList, row.attachmentIdsJson),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    version: row.version,
  });

const draftNotFound = (
  operation: MailboxDomainError["operation"],
  draftId: string
) =>
  new MailboxDomainError({
    operation,
    reason: "not-found",
    message: "Draft was not found",
    resourceType: "draft",
    resourceId: draftId,
  });

const createDraft = (
  mailboxId: MailboxId,
  input: CreateDraftInput,
  runtime: MailboxRuntime,
  operations: MailboxOperationStore
) =>
  Effect.gen(function* () {
    const db = yield* MailboxDatabase;
    return yield* db.transaction((tx) =>
      Effect.gen(function* () {
        const requestKey = JSON.stringify(
          Schema.encodeSync(CreateDraftInput)(input)
        );
        const previous = yield* operations.replay(
          input.operationId,
          "create-draft",
          "create-draft",
          requestKey,
          DraftSchema
        );
        if (previous !== undefined) {
          if (Result.isFailure(previous)) {
            return yield* previous.failure;
          }
          return previous.success;
        }
        const id = runtime.randomId();
        const now = runtime.now();
        const [row] = yield* tx
          .insert(draft)
          .values({
            id,
            threadId: input.content.threadId ?? null,
            inReplyToMessageId: input.content.inReplyToMessageId ?? null,
            toJson: encodeJson(AddressList, input.content.to),
            ccJson: encodeJson(AddressList, input.content.cc),
            bccJson: encodeJson(AddressList, input.content.bcc),
            subject: input.content.subject,
            textBody: input.content.textBody ?? null,
            htmlBody: input.content.htmlBody ?? null,
            attachmentIdsJson: encodeJson(
              StringList,
              input.content.attachmentIds
            ),
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        if (row === undefined) {
          return yield* Effect.die("Draft insert returned no row");
        }
        const created = readDraftRow(row, mailboxId);
        yield* operations.store(
          input.operationId,
          "create-draft",
          requestKey,
          id,
          JSON.stringify(Schema.encodeSync(DraftSchema)(created)),
          now
        );
        return created;
      })
    );
  });

const replySubject = (subject: string) => {
  const base = subject.replace(/^(?:\s*re\s*:\s*)+/iu, "");
  return base.length === 0 ? "Re:" : `Re: ${base.slice(0, 994)}`;
};

const replyRequestKey = (input: CreateReplyDraftInput) =>
  JSON.stringify(Schema.encodeSync(CreateReplyDraftInput)(input));

const readReplyDraftOperation = (
  input: CreateReplyDraftInput,
  operations: MailboxOperationStore
) =>
  operations
    .replay(
      input.operationId,
      "create-reply-draft",
      "create-reply-draft",
      replyRequestKey(input),
      DraftSchema
    )
    .pipe(
      Effect.flatMap((previous) =>
        previous === undefined
          ? Effect.succeed(
              Schema.decodeUnknownSync(ReplyDraftOperationResult)({
                _tag: "NotFound",
              })
            )
          : Result.isFailure(previous)
            ? Effect.fail(previous.failure)
            : Effect.succeed(
                Schema.decodeUnknownSync(ReplyDraftOperationResult)({
                  _tag: "Found",
                  draft: previous.success,
                })
              )
      )
    );

const createReplyDraft = (
  mailboxId: MailboxId,
  input: CreateReplyDraftInput,
  runtime: MailboxRuntime,
  operations: MailboxOperationStore
) =>
  Effect.gen(function* () {
    const db = yield* MailboxDatabase;
    return yield* db.transaction((tx) =>
      Effect.gen(function* () {
        const requestKey = replyRequestKey(input);
        const previous = yield* operations.replay(
          input.operationId,
          "create-reply-draft",
          "create-reply-draft",
          requestKey,
          DraftSchema
        );
        if (previous !== undefined) {
          if (Result.isFailure(previous)) {
            return yield* previous.failure;
          }
          return previous.success;
        }

        const [targetRow] = yield* tx
          .select()
          .from(message)
          .where(
            and(eq(message.id, input.messageId), isNull(message.deletedAt))
          )
          .limit(1);
        if (targetRow === undefined || targetRow.direction !== "inbound") {
          return yield* new MailboxDomainError({
            operation: "create-reply-draft",
            reason: "not-found",
            message: "Reply target was not found",
            resourceType: "message",
            resourceId: input.messageId,
          });
        }
        const target = yield* readMessageDetailRow(
          tx,
          targetRow,
          mailboxId,
          "create-reply-draft"
        );
        const inContext =
          target.threadId === input.threadId &&
          (input._tag === "Folder"
            ? target.folderId === input.folderId
            : target.labelIds.includes(input.labelId));
        if (!inContext) {
          return yield* new MailboxDomainError({
            operation: "create-reply-draft",
            reason: "not-found",
            message: "Reply target was not found",
            resourceType: "message",
            resourceId: input.messageId,
          });
        }

        const storedRecipients =
          target.replyTo === undefined
            ? target.sender === undefined
              ? []
              : [target.sender]
            : target.replyTo;
        const seen = new Set<string>();
        const recipients = storedRecipients.filter((recipient) => {
          const address = normalizeEmailAddressDomain(recipient.address);
          if (seen.has(address)) {
            return false;
          }
          seen.add(address);
          return true;
        });
        if (recipients.length === 0) {
          return yield* new MailboxDomainError({
            operation: "create-reply-draft",
            reason: "not-found",
            message: "Reply target has no recipient",
            resourceType: "message",
            resourceId: input.messageId,
          });
        }
        if (recipients.length > 50) {
          return yield* new MailboxDomainError({
            operation: "create-reply-draft",
            reason: "validation",
            message: "Reply target has too many recipients",
            resourceType: "message",
            resourceId: input.messageId,
          });
        }

        const id = runtime.randomId();
        const now = runtime.now();
        const [row] = yield* tx
          .insert(draft)
          .values({
            id,
            threadId: input.threadId,
            inReplyToMessageId: input.messageId,
            toJson: encodeJson(AddressList, recipients),
            ccJson: "[]",
            bccJson: "[]",
            subject: replySubject(target.subject),
            textBody: null,
            htmlBody: null,
            attachmentIdsJson: "[]",
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        if (row === undefined) {
          return yield* Effect.die("Reply draft insert returned no row");
        }
        const created = readDraftRow(row, mailboxId);
        yield* operations.store(
          input.operationId,
          "create-reply-draft",
          requestKey,
          id,
          JSON.stringify(Schema.encodeSync(DraftSchema)(created)),
          now
        );
        return created;
      })
    );
  });

const getDraft = (mailboxId: MailboxId, input: GetDraftInput) =>
  Effect.gen(function* () {
    const db = yield* MailboxDatabase;
    const [row] = yield* db
      .select()
      .from(draft)
      .where(and(eq(draft.id, input.draftId), isNull(draft.deletedAt)))
      .limit(1);
    if (row === undefined) {
      return yield* draftNotFound("get-draft", input.draftId);
    }
    return readDraftRow(row, mailboxId);
  });

const DraftCursorPayload = Schema.Struct({
  mailboxId: MailboxId,
  scope: Schema.Literal("drafts-desc"),
  updatedAt: UnixMillis,
  id: DraftId,
});

const encodeDraftCursor = (
  payload: Schema.Schema.Type<typeof DraftCursorPayload>
) =>
  Schema.decodeUnknownSync(Cursor)(
    btoa(encodeURIComponent(JSON.stringify(payload)))
  );

const invalidDraftCursor = () =>
  new MailboxDomainError({
    operation: "list-drafts",
    reason: "validation",
    message: "Draft cursor is invalid",
  });

const decodeDraftCursor = (value: string, mailboxId: MailboxId) => {
  const parsed = Result.try({
    try: () => JSON.parse(decodeURIComponent(atob(value))),
    catch: invalidDraftCursor,
  });
  if (Result.isFailure(parsed)) {
    return parsed;
  }
  const decoded = Schema.decodeUnknownResult(DraftCursorPayload)(
    parsed.success
  );
  return Result.isSuccess(decoded) && decoded.success.mailboxId === mailboxId
    ? Result.succeed(decoded.success)
    : Result.fail(invalidDraftCursor());
};

const listDrafts = (mailboxId: MailboxId, input: ListDraftsInput) =>
  Effect.gen(function* () {
    const db = yield* MailboxDatabase;
    const decodedCursor =
      input.page?.cursor === undefined
        ? Result.void
        : decodeDraftCursor(input.page.cursor, mailboxId);
    if (Result.isFailure(decodedCursor)) {
      return yield* decodedCursor.failure;
    }
    const cursor = decodedCursor.success;
    const limit = input.page?.limit ?? 25;
    const rows = yield* db
      .select({
        id: draft.id,
        version: draft.version,
        subject: draft.subject,
        updatedAt: draft.updatedAt,
        snippet: sql<string>`substr(coalesce(${draft.textBody}, ${draft.htmlBody}, ''), 1, 500)`,
        hasAttachments: sql<number>`case when json_array_length(${draft.attachmentIdsJson}) > 0 then 1 else 0 end`,
        toRecipient: sql<string | null>`json_extract(${draft.toJson}, '$[0]')`,
        ccRecipient: sql<string | null>`json_extract(${draft.ccJson}, '$[0]')`,
        bccRecipient: sql<
          string | null
        >`json_extract(${draft.bccJson}, '$[0]')`,
      })
      .from(draft)
      .where(
        and(
          isNull(draft.deletedAt),
          cursor === undefined
            ? undefined
            : or(
                lt(draft.updatedAt, cursor.updatedAt),
                and(
                  eq(draft.updatedAt, cursor.updatedAt),
                  lt(draft.id, cursor.id)
                )
              )
        )
      )
      .orderBy(desc(draft.updatedAt), desc(draft.id))
      .limit(limit + 1);
    const pageRows = rows.slice(0, limit);
    const items = pageRows.map((row) =>
      Schema.decodeUnknownSync(DraftSummary)({
        id: row.id,
        mailboxId,
        recipients: [
          row.toRecipient,
          row.ccRecipient,
          row.bccRecipient,
        ].flatMap((recipient) =>
          recipient === null ? [] : [decodeJson(MailAddress, recipient)]
        ),
        subject: row.subject,
        snippet: row.snippet,
        hasAttachments: row.hasAttachments === 1,
        updatedAt: row.updatedAt,
        version: row.version,
      })
    );
    const last = pageRows.at(-1);
    return Schema.decodeUnknownSync(DraftPage)({
      items,
      nextCursor:
        rows.length > limit && last !== undefined
          ? encodeDraftCursor({
              mailboxId,
              scope: "drafts-desc",
              updatedAt: Schema.decodeUnknownSync(UnixMillis)(last.updatedAt),
              id: Schema.decodeUnknownSync(DraftId)(last.id),
            })
          : undefined,
    });
  });

const updateDraft = (
  mailboxId: MailboxId,
  input: UpdateDraftInput,
  runtime: MailboxRuntime,
  operations: MailboxOperationStore
) =>
  Effect.gen(function* () {
    const db = yield* MailboxDatabase;
    return yield* db.transaction((tx) =>
      Effect.gen(function* () {
        const requestKey = JSON.stringify(
          Schema.encodeSync(UpdateDraftInput)(input)
        );
        const previous = yield* operations.replay(
          input.operationId,
          "update-draft",
          "update-draft",
          requestKey,
          DraftSchema
        );
        if (previous !== undefined) {
          if (Result.isFailure(previous)) {
            return yield* previous.failure;
          }
          return previous.success;
        }
        const [current] = yield* tx
          .select()
          .from(draft)
          .where(and(eq(draft.id, input.draftId), isNull(draft.deletedAt)))
          .limit(1);
        if (current === undefined) {
          return yield* draftNotFound("update-draft", input.draftId);
        }
        if (current.version !== input.expectedVersion) {
          return yield* new MailboxDomainError({
            operation: "update-draft",
            reason: "version-conflict",
            message: "Draft version does not match",
            resourceType: "draft",
            resourceId: input.draftId,
            expectedVersion: input.expectedVersion,
            actualVersion: Schema.decodeUnknownSync(Version)(current.version),
          });
        }
        const [updated] = yield* tx
          .update(draft)
          .set({
            threadId: input.content.threadId ?? null,
            inReplyToMessageId: input.content.inReplyToMessageId ?? null,
            toJson: encodeJson(AddressList, input.content.to),
            ccJson: encodeJson(AddressList, input.content.cc),
            bccJson: encodeJson(AddressList, input.content.bcc),
            subject: input.content.subject,
            textBody: input.content.textBody ?? null,
            htmlBody: input.content.htmlBody ?? null,
            attachmentIdsJson: encodeJson(
              StringList,
              input.content.attachmentIds
            ),
            updatedAt: Math.max(runtime.now(), current.updatedAt),
            version: sql`${draft.version} + 1`,
          })
          .where(
            and(
              eq(draft.id, input.draftId),
              eq(draft.version, input.expectedVersion),
              isNull(draft.deletedAt)
            )
          )
          .returning();
        if (updated === undefined) {
          return yield* new MailboxDomainError({
            operation: "update-draft",
            reason: "version-conflict",
            message: "Draft version does not match",
            resourceType: "draft",
            resourceId: input.draftId,
            expectedVersion: input.expectedVersion,
            actualVersion: Schema.decodeUnknownSync(Version)(current.version),
          });
        }
        const result = readDraftRow(updated, mailboxId);
        yield* operations.store(
          input.operationId,
          "update-draft",
          requestKey,
          input.draftId,
          JSON.stringify(Schema.encodeSync(DraftSchema)(result)),
          result.updatedAt
        );
        return result;
      })
    );
  });

const makeMailboxDraftStore = (
  db: MailboxDatabase,
  runtime: MailboxRuntime,
  mailboxId: MailboxId,
  operations: MailboxOperationStore
) => {
  const provideDatabase = <A, E>(
    effect: Effect.Effect<A, E, MailboxDatabase>
  ) => effect.pipe(Effect.provideService(MailboxDatabase, db));

  return {
    createReplyDraft: (input: CreateReplyDraftInput) =>
      provideDatabase(createReplyDraft(mailboxId, input, runtime, operations)),
    createDraft: (input: CreateDraftInput) =>
      provideDatabase(createDraft(mailboxId, input, runtime, operations)),
    readReplyDraftOperation: (input: CreateReplyDraftInput) =>
      provideDatabase(readReplyDraftOperation(input, operations)),
    getDraft: (input: GetDraftInput) =>
      provideDatabase(getDraft(mailboxId, input)),
    listDrafts: (input: ListDraftsInput) =>
      provideDatabase(listDrafts(mailboxId, input)),
    updateDraft: (input: UpdateDraftInput) =>
      provideDatabase(updateDraft(mailboxId, input, runtime, operations)),
  };
};

export type MailboxDraftStore = ReturnType<typeof makeMailboxDraftStore>;

export const MailboxDraftStore = Context.Service<MailboxDraftStore>(
  "cloudflare-inbox/MailboxDraftStore"
);

export const MailboxDraftStoreSqliteLayer = Layer.effect(
  MailboxDraftStore,
  Effect.gen(function* () {
    const db = yield* MailboxDatabase;
    const runtime = yield* MailboxRuntime;
    const { mailboxId } = yield* MailboxIdentity;
    const operations = yield* MailboxOperationStore;
    return MailboxDraftStore.of(
      makeMailboxDraftStore(db, runtime, mailboxId, operations)
    );
  })
);
