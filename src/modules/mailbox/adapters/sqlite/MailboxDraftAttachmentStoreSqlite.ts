import { and, asc, eq, isNull, lte, or, gt, sql } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import type { MailboxId } from "#/modules/mailbox/domain/Mailbox";
import {
  DraftAttachmentList,
  DraftAttachmentReservationSchema,
  DraftAttachmentUploadResult,
  draftAttachmentMaxCount,
  draftAttachmentMaxTotalBytes,
  draftAttachmentReservationTtlMillis,
  ReserveDraftAttachmentCommand,
  ReservedDraftAttachment,
} from "#/modules/mailbox/domain/MailboxDraftAttachment";
import type {
  CompleteDraftAttachmentInput,
  GetDraftAttachmentInput,
  ListDraftAttachmentsInput,
} from "#/modules/mailbox/domain/MailboxDraftAttachment";
import { MailboxDomainError } from "#/modules/mailbox/domain/MailboxError";
import { MailboxIdentity } from "#/modules/mailbox/ports/MailboxIdentity";

import { MailboxOperationStore } from "./MailboxOperationStoreSqlite";
import { MailboxDatabase } from "./MailboxSqliteDatabase";
import { encodeJson, StringList } from "./MailboxSqliteJson";
import { MailboxRuntime } from "./MailboxSqliteRuntime";
import { draft, draftAttachment } from "./MailboxSqliteSchema";

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

const draftAttachmentNotFound = (
  operation: "get-draft-attachment" | "complete-draft-attachment",
  attachmentId: string
) =>
  new MailboxDomainError({
    operation,
    reason: "not-found",
    message: "Draft attachment reservation was not found",
    resourceType: "attachment",
    resourceId: attachmentId,
  });

const readDraftAttachmentRow = (
  row: typeof draftAttachment.$inferSelect,
  mailboxId: MailboxId
) =>
  Schema.decodeUnknownSync(DraftAttachmentReservationSchema)({
    contentSha256: row.contentSha256 ?? undefined,
    createdAt: row.createdAt,
    draftId: row.draftId,
    expiresAt: row.expiresAt,
    fileName: row.fileName,
    id: row.id,
    mailboxId,
    mimeType: row.mimeType,
    size: row.size,
    status: row.status,
    storedAt: row.storedAt ?? undefined,
  });

const reserveDraftAttachment = (
  mailboxId: MailboxId,
  input: ReserveDraftAttachmentCommand,
  runtime: MailboxRuntime,
  operations: MailboxOperationStore
) =>
  Effect.gen(function* () {
    const db = yield* MailboxDatabase;
    return yield* db.transaction((tx) =>
      Effect.gen(function* () {
        const requestKey = JSON.stringify(
          Schema.encodeSync(ReserveDraftAttachmentCommand)(input)
        );
        const previous = yield* operations.replay(
          input.operationId,
          "reserve-draft-attachment",
          "reserve-draft-attachment",
          requestKey,
          ReservedDraftAttachment
        );
        if (previous !== undefined) {
          if (Result.isFailure(previous)) {
            return yield* previous.failure;
          }
          return previous.success;
        }
        const [existingDraft] = yield* tx
          .select({ id: draft.id })
          .from(draft)
          .where(and(eq(draft.id, input.draftId), isNull(draft.deletedAt)))
          .limit(1);
        if (existingDraft === undefined) {
          return yield* draftNotFound(
            "reserve-draft-attachment",
            input.draftId
          );
        }
        const now = runtime.now();
        yield* tx
          .delete(draftAttachment)
          .where(
            and(
              eq(draftAttachment.draftId, input.draftId),
              eq(draftAttachment.status, "reserved"),
              lte(draftAttachment.expiresAt, now)
            )
          );
        const active = yield* tx
          .select({ size: draftAttachment.size })
          .from(draftAttachment)
          .where(
            and(
              eq(draftAttachment.draftId, input.draftId),
              or(
                eq(draftAttachment.status, "stored"),
                gt(draftAttachment.expiresAt, now)
              )
            )
          );
        if (active.length >= draftAttachmentMaxCount) {
          return yield* new MailboxDomainError({
            operation: "reserve-draft-attachment",
            reason: "validation",
            message: "Draft attachment count limit exceeded",
            resourceType: "draft",
            resourceId: input.draftId,
          });
        }
        const totalSize = active.reduce((total, item) => total + item.size, 0);
        if (totalSize + input.size > draftAttachmentMaxTotalBytes) {
          return yield* new MailboxDomainError({
            operation: "reserve-draft-attachment",
            reason: "validation",
            message: "Draft attachment size limit exceeded",
            resourceType: "draft",
            resourceId: input.draftId,
          });
        }
        const id = runtime.randomId();
        const [row] = yield* tx
          .insert(draftAttachment)
          .values({
            createdAt: now,
            draftId: input.draftId,
            expiresAt: now + draftAttachmentReservationTtlMillis,
            fileName: input.fileName,
            id,
            mimeType: input.mimeType,
            size: input.size,
          })
          .returning();
        if (row === undefined) {
          return yield* Effect.die(
            new Error("Draft attachment reservation insert returned no row")
          );
        }
        const reservation = readDraftAttachmentRow(row, mailboxId);
        yield* operations.store(
          input.operationId,
          "reserve-draft-attachment",
          requestKey,
          id,
          JSON.stringify(
            Schema.encodeSync(DraftAttachmentReservationSchema)(reservation)
          ),
          now
        );
        return reservation;
      })
    );
  });

const getDraftAttachment = (
  mailboxId: MailboxId,
  input: GetDraftAttachmentInput,
  runtime: MailboxRuntime
) =>
  Effect.gen(function* () {
    const db = yield* MailboxDatabase;
    const [row] = yield* db
      .select()
      .from(draftAttachment)
      .where(
        and(
          eq(draftAttachment.id, input.attachmentId),
          eq(draftAttachment.draftId, input.draftId)
        )
      )
      .limit(1);
    if (row === undefined) {
      return yield* draftAttachmentNotFound(
        "get-draft-attachment",
        input.attachmentId
      );
    }
    if (row.status === "reserved" && row.expiresAt <= runtime.now()) {
      return yield* new MailboxDomainError({
        operation: "get-draft-attachment",
        reason: "invalid-state",
        message: "Attachment reservation expired",
        resourceType: "attachment",
        resourceId: input.attachmentId,
      });
    }
    return readDraftAttachmentRow(row, mailboxId);
  });

const listDraftAttachments = (
  mailboxId: MailboxId,
  input: ListDraftAttachmentsInput,
  runtime: MailboxRuntime
) =>
  Effect.gen(function* () {
    const db = yield* MailboxDatabase;
    const [existingDraft] = yield* db
      .select({ id: draft.id })
      .from(draft)
      .where(and(eq(draft.id, input.draftId), isNull(draft.deletedAt)))
      .limit(1);
    if (existingDraft === undefined) {
      return yield* draftNotFound("list-draft-attachments", input.draftId);
    }
    const now = runtime.now();
    const rows = yield* db
      .select()
      .from(draftAttachment)
      .where(
        and(
          eq(draftAttachment.draftId, input.draftId),
          or(
            eq(draftAttachment.status, "stored"),
            gt(draftAttachment.expiresAt, now)
          )
        )
      )
      .orderBy(asc(draftAttachment.createdAt), asc(draftAttachment.id));
    return Schema.decodeUnknownSync(DraftAttachmentList)({
      items: rows.map((row) => readDraftAttachmentRow(row, mailboxId)),
    });
  });

const completeDraftAttachment = (
  mailboxId: MailboxId,
  input: CompleteDraftAttachmentInput,
  runtime: MailboxRuntime
) =>
  Effect.gen(function* () {
    const db = yield* MailboxDatabase;
    return yield* db.transaction((tx) =>
      Effect.gen(function* () {
        const [reservation] = yield* tx
          .select()
          .from(draftAttachment)
          .where(
            and(
              eq(draftAttachment.id, input.attachmentId),
              eq(draftAttachment.draftId, input.draftId)
            )
          )
          .limit(1);
        if (reservation === undefined) {
          return yield* draftAttachmentNotFound(
            "complete-draft-attachment",
            input.attachmentId
          );
        }
        const [currentDraft] = yield* tx
          .select()
          .from(draft)
          .where(and(eq(draft.id, input.draftId), isNull(draft.deletedAt)))
          .limit(1);
        if (currentDraft === undefined) {
          return yield* draftNotFound(
            "complete-draft-attachment",
            input.draftId
          );
        }
        if (reservation.status === "stored") {
          if (reservation.contentSha256 !== input.contentSha256) {
            return yield* new MailboxDomainError({
              operation: "complete-draft-attachment",
              reason: "idempotency-conflict",
              message: "Attachment was stored with different content",
              resourceType: "attachment",
              resourceId: input.attachmentId,
            });
          }
          return Schema.decodeUnknownSync(DraftAttachmentUploadResult)({
            attachment: readDraftAttachmentRow(reservation, mailboxId),
            draftVersion: currentDraft.version,
          });
        }
        const now = runtime.now();
        if (reservation.expiresAt <= now) {
          return yield* new MailboxDomainError({
            operation: "complete-draft-attachment",
            reason: "invalid-state",
            message: "Attachment reservation expired",
            resourceType: "attachment",
            resourceId: input.attachmentId,
          });
        }
        const [stored] = yield* tx
          .update(draftAttachment)
          .set({
            contentSha256: input.contentSha256,
            status: "stored",
            storedAt: now,
          })
          .where(
            and(
              eq(draftAttachment.id, input.attachmentId),
              eq(draftAttachment.status, "reserved")
            )
          )
          .returning();
        if (stored === undefined) {
          return yield* Effect.die(
            new Error("Draft attachment completion returned no row")
          );
        }
        const attachmentIds = Schema.decodeUnknownSync(StringList)(
          JSON.parse(currentDraft.attachmentIdsJson)
        );
        const nextAttachmentIds = attachmentIds.includes(input.attachmentId)
          ? attachmentIds
          : [...attachmentIds, input.attachmentId];
        const [updatedDraft] = yield* tx
          .update(draft)
          .set({
            attachmentIdsJson: encodeJson(StringList, nextAttachmentIds),
            updatedAt: Math.max(now, currentDraft.updatedAt),
            version: sql`${draft.version} + 1`,
          })
          .where(eq(draft.id, input.draftId))
          .returning({ version: draft.version });
        if (updatedDraft === undefined) {
          return yield* Effect.die(
            new Error("Draft attachment update returned no draft")
          );
        }
        return Schema.decodeUnknownSync(DraftAttachmentUploadResult)({
          attachment: readDraftAttachmentRow(stored, mailboxId),
          draftVersion: updatedDraft.version,
        });
      })
    );
  });

const makeMailboxDraftAttachmentStore = (
  db: MailboxDatabase,
  runtime: MailboxRuntime,
  mailboxId: MailboxId,
  operations: MailboxOperationStore
) => {
  const provideDatabase = <A, E>(
    effect: Effect.Effect<A, E, MailboxDatabase>
  ) => effect.pipe(Effect.provideService(MailboxDatabase, db));

  return {
    completeDraftAttachment: (input: CompleteDraftAttachmentInput) =>
      provideDatabase(completeDraftAttachment(mailboxId, input, runtime)),
    getDraftAttachment: (input: GetDraftAttachmentInput) =>
      provideDatabase(getDraftAttachment(mailboxId, input, runtime)),
    listDraftAttachments: (input: ListDraftAttachmentsInput) =>
      provideDatabase(listDraftAttachments(mailboxId, input, runtime)),
    reserveDraftAttachment: (input: ReserveDraftAttachmentCommand) =>
      provideDatabase(
        reserveDraftAttachment(mailboxId, input, runtime, operations)
      ),
  };
};

export type MailboxDraftAttachmentStore = ReturnType<
  typeof makeMailboxDraftAttachmentStore
>;

export const MailboxDraftAttachmentStore =
  Context.Service<MailboxDraftAttachmentStore>(
    "cloudflare-inbox/MailboxDraftAttachmentStore"
  );

export const MailboxDraftAttachmentStoreSqliteLayer = Layer.effect(
  MailboxDraftAttachmentStore,
  Effect.gen(function* () {
    const db = yield* MailboxDatabase;
    const runtime = yield* MailboxRuntime;
    const { mailboxId } = yield* MailboxIdentity;
    const operations = yield* MailboxOperationStore;
    return MailboxDraftAttachmentStore.of(
      makeMailboxDraftAttachmentStore(db, runtime, mailboxId, operations)
    );
  })
);
