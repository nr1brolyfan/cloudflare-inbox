import { and, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { Cursor, DraftId, MailboxId } from "#/modules/mailbox/domain/Mailbox";
import {
  CreateDraftInput,
  DraftPage,
  DraftSchema,
  DraftSummary,
  UpdateDraftInput,
} from "#/modules/mailbox/domain/MailboxDraft";
import type {
  GetDraftInput,
  ListDraftsInput,
} from "#/modules/mailbox/domain/MailboxDraft";
import { MailboxDomainError } from "#/modules/mailbox/domain/MailboxError";
import { MailboxIdentity } from "#/modules/mailbox/ports/MailboxIdentity";
import { MailAddress } from "#/shared/MailAddress";
import { UnixMillis, Version } from "#/shared/Temporal";

import { MailboxOperationStore } from "./MailboxOperationStoreSqlite";
import { MailboxDatabase } from "./MailboxSqliteDatabase";
import {
  AddressList,
  decodeJson,
  encodeJson,
  StringList,
} from "./MailboxSqliteJson";
import { MailboxRuntime } from "./MailboxSqliteRuntime";
import { draft } from "./MailboxSqliteSchema";

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
    createDraft: (input: CreateDraftInput) =>
      provideDatabase(createDraft(mailboxId, input, runtime, operations)),
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
