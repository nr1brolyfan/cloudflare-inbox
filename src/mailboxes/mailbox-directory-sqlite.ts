import { and, count, eq, isNull, sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { DeletedFolder } from "./deleted-folder";
import { DeletedLabel } from "./deleted-label";
import type {
  CreateFolderInput,
  CreateLabelInput,
  DeleteFolderInput,
  DeleteLabelInput,
  RenameFolderInput,
  RenameLabelInput,
} from "./directory-contract";
import { FolderList, LabelList } from "./directory-contract";
import { MailboxDomainError } from "./errors/mailbox-domain-error";
import { FolderSchema } from "./folder";
import { FolderSummarySchema } from "./folder-summary";
import type { MailboxId } from "./identifiers";
import { LabelSchema } from "./label";
import { MailboxDatabase } from "./mailbox-database";
import { MailboxDirectoryRuntime } from "./mailbox-directory-runtime";
import { folder, label, mailboxOperation, message } from "./mailbox-schema";

const systemFolders = [
  { id: "inbox", kind: "inbox", name: "Inbox" },
  { id: "sent", kind: "sent", name: "Sent" },
  { id: "drafts", kind: "drafts", name: "Drafts" },
  { id: "scheduled", kind: "scheduled", name: "Scheduled" },
  { id: "archive", kind: "archive", name: "Archive" },
  { id: "spam", kind: "spam", name: "Spam" },
  { id: "trash", kind: "trash", name: "Trash" },
] as const;

export const initializeMailboxDirectory = Effect.gen(function* () {
  const db = yield* MailboxDatabase;
  const runtime = yield* MailboxDirectoryRuntime;

  yield* db.transaction((tx) =>
    Effect.gen(function* () {
      const now = runtime.now();
      for (const systemFolder of systemFolders) {
        yield* tx
          .insert(folder)
          .values({
            id: systemFolder.id,
            name: systemFolder.name,
            kind: systemFolder.kind,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing({ target: folder.id });
        yield* tx
          .update(folder)
          .set({
            name: systemFolder.name,
            kind: systemFolder.kind,
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
          })
          .where(
            and(
              eq(folder.id, systemFolder.id),
              eq(folder.name, "Migrated folder"),
              eq(folder.kind, "custom"),
              eq(folder.createdAt, 0),
              eq(folder.updatedAt, 0)
            )
          );
      }
    })
  );
});

const mailboxDomainError = (
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

const folderFromRow = (row: typeof folder.$inferSelect, mailboxId: MailboxId) =>
  Schema.decodeUnknownSync(FolderSchema)({
    id: row.id,
    mailboxId,
    name: row.name,
    kind: row.kind,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    version: row.version,
  });

const labelFromRow = (row: typeof label.$inferSelect, mailboxId: MailboxId) =>
  Schema.decodeUnknownSync(LabelSchema)({
    id: row.id,
    mailboxId,
    name: row.name,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    version: row.version,
  });

const operationResult = <A>(
  operationId: string,
  operationKind: "create-folder" | "create-label",
  requestKey: string,
  schema: Schema.Decoder<A>
) =>
  Effect.gen(function* () {
    const db = yield* MailboxDatabase;
    const [row] = yield* db
      .select({
        operationKind: mailboxOperation.operationKind,
        requestKey: mailboxOperation.requestKey,
        resultPayload: mailboxOperation.resultPayload,
      })
      .from(mailboxOperation)
      .where(eq(mailboxOperation.operationId, operationId));

    if (row === undefined) {
      return;
    }
    if (row.operationKind !== operationKind || row.requestKey !== requestKey) {
      return Result.fail(
        mailboxDomainError(
          operationKind,
          "idempotency-conflict",
          "Operation ID was already used for a different request",
          { resourceId: operationId }
        )
      );
    }
    return Result.succeed(
      Schema.decodeUnknownSync(schema)(JSON.parse(row.resultPayload))
    );
  });

export const listFolders = (mailboxId: MailboxId) =>
  Effect.gen(function* () {
    const db = yield* MailboxDatabase;
    const rows = yield* db
      .select({
        id: folder.id,
        name: folder.name,
        kind: folder.kind,
        createdAt: folder.createdAt,
        updatedAt: folder.updatedAt,
        version: folder.version,
        deletedAt: folder.deletedAt,
        messageCount: count(message.id),
        unreadCount: sql<number>`coalesce(sum(case when ${message.read} = 0 then 1 else 0 end), 0)`,
      })
      .from(folder)
      .leftJoin(
        message,
        and(eq(message.folderId, folder.id), isNull(message.deletedAt))
      )
      .where(isNull(folder.deletedAt))
      .groupBy(folder.id)
      .orderBy(
        sql`case ${folder.kind}
          when 'inbox' then 0
          when 'sent' then 1
          when 'drafts' then 2
          when 'scheduled' then 3
          when 'archive' then 4
          when 'spam' then 5
          when 'trash' then 6
          else 7
        end`,
        sql`${folder.name} collate nocase`,
        folder.id
      );

    return Schema.decodeUnknownSync(FolderList)({
      items: rows.map((row) =>
        Schema.decodeUnknownSync(FolderSummarySchema)({
          ...folderFromRow(row, mailboxId),
          messageCount: row.messageCount,
          unreadCount: row.unreadCount,
        })
      ),
    });
  });

export const createFolder = (mailboxId: MailboxId, input: CreateFolderInput) =>
  Effect.gen(function* () {
    const db = yield* MailboxDatabase;
    const runtime = yield* MailboxDirectoryRuntime;

    return yield* db.transaction((tx) =>
      Effect.gen(function* () {
        const requestKey = JSON.stringify({ name: input.name });
        const previous = yield* operationResult(
          input.operationId,
          "create-folder",
          requestKey,
          FolderSchema
        );
        if (previous !== undefined) {
          return previous;
        }

        const now = runtime.now();
        const id = runtime.randomId();
        const [row] = yield* tx
          .insert(folder)
          .values({
            id,
            name: input.name,
            kind: "custom",
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        if (row === undefined) {
          return yield* Effect.die(
            new Error("Created folder was not returned")
          );
        }
        const result = folderFromRow(row, mailboxId);
        yield* tx.insert(mailboxOperation).values({
          operationId: input.operationId,
          operationKind: "create-folder",
          requestKey,
          resourceId: id,
          resultPayload: JSON.stringify(
            Schema.encodeSync(FolderSchema)(result)
          ),
          createdAt: now,
        });
        return Result.succeed(result);
      })
    );
  });

export const renameFolder = (mailboxId: MailboxId, input: RenameFolderInput) =>
  Effect.gen(function* () {
    const db = yield* MailboxDatabase;
    const runtime = yield* MailboxDirectoryRuntime;

    return yield* db.transaction((tx) =>
      Effect.gen(function* () {
        const [row] = yield* tx
          .select()
          .from(folder)
          .where(and(eq(folder.id, input.folderId), isNull(folder.deletedAt)));
        if (row === undefined) {
          return Result.fail(
            mailboxDomainError(
              "rename-folder",
              "not-found",
              "Folder was not found",
              { resourceType: "folder", resourceId: input.folderId }
            )
          );
        }
        const current = folderFromRow(row, mailboxId);
        if (current.version !== input.expectedVersion) {
          return Result.fail(
            mailboxDomainError(
              "rename-folder",
              "version-conflict",
              "Folder version does not match",
              {
                resourceType: "folder",
                resourceId: input.folderId,
                expectedVersion: input.expectedVersion,
                actualVersion: current.version,
              }
            )
          );
        }
        const updatedAt = Math.max(runtime.now(), current.updatedAt);
        const [updated] = yield* tx
          .update(folder)
          .set({
            name: input.name,
            updatedAt,
            version: sql`${folder.version} + 1`,
          })
          .where(
            and(
              eq(folder.id, input.folderId),
              eq(folder.version, input.expectedVersion),
              isNull(folder.deletedAt)
            )
          )
          .returning();
        if (updated === undefined) {
          return yield* Effect.die(
            new Error("Renamed folder was not returned")
          );
        }
        return Result.succeed(folderFromRow(updated, mailboxId));
      })
    );
  });

export const deleteFolder = (mailboxId: MailboxId, input: DeleteFolderInput) =>
  Effect.gen(function* () {
    const db = yield* MailboxDatabase;
    const runtime = yield* MailboxDirectoryRuntime;

    return yield* db.transaction((tx) =>
      Effect.gen(function* () {
        const [row] = yield* tx
          .select()
          .from(folder)
          .where(and(eq(folder.id, input.folderId), isNull(folder.deletedAt)));
        if (row === undefined) {
          return Result.fail(
            mailboxDomainError(
              "delete-folder",
              "not-found",
              "Folder was not found",
              { resourceType: "folder", resourceId: input.folderId }
            )
          );
        }
        const current = folderFromRow(row, mailboxId);
        if (current.version !== input.expectedVersion) {
          return Result.fail(
            mailboxDomainError(
              "delete-folder",
              "version-conflict",
              "Folder version does not match",
              {
                resourceType: "folder",
                resourceId: input.folderId,
                expectedVersion: input.expectedVersion,
                actualVersion: current.version,
              }
            )
          );
        }
        if (current.kind !== "custom") {
          return Result.fail(
            mailboxDomainError(
              "delete-folder",
              "system-folder",
              "System folders cannot be deleted",
              { resourceType: "folder", resourceId: input.folderId }
            )
          );
        }
        const [activeMessage] = yield* tx
          .select({ id: message.id })
          .from(message)
          .where(
            and(eq(message.folderId, input.folderId), isNull(message.deletedAt))
          )
          .limit(1);
        if (activeMessage !== undefined) {
          return Result.fail(
            mailboxDomainError(
              "delete-folder",
              "folder-not-empty",
              "Folder contains active messages",
              { resourceType: "folder", resourceId: input.folderId }
            )
          );
        }
        const deletedAt = Math.max(runtime.now(), current.updatedAt);
        yield* tx
          .update(folder)
          .set({
            deletedAt,
            updatedAt: deletedAt,
            version: sql`${folder.version} + 1`,
          })
          .where(
            and(
              eq(folder.id, input.folderId),
              eq(folder.version, input.expectedVersion),
              isNull(folder.deletedAt)
            )
          );
        return Result.succeed(
          Schema.decodeUnknownSync(DeletedFolder)({
            id: input.folderId,
            deletedAt,
            version: input.expectedVersion + 1,
          })
        );
      })
    );
  });

export const listLabels = (mailboxId: MailboxId) =>
  Effect.gen(function* () {
    const db = yield* MailboxDatabase;
    const rows = yield* db
      .select()
      .from(label)
      .where(isNull(label.deletedAt))
      .orderBy(sql`${label.name} collate nocase`, label.id);
    return Schema.decodeUnknownSync(LabelList)({
      items: rows.map((row) => labelFromRow(row, mailboxId)),
    });
  });

export const createLabel = (mailboxId: MailboxId, input: CreateLabelInput) =>
  Effect.gen(function* () {
    const db = yield* MailboxDatabase;
    const runtime = yield* MailboxDirectoryRuntime;

    return yield* db.transaction((tx) =>
      Effect.gen(function* () {
        const requestKey = JSON.stringify({ name: input.name });
        const previous = yield* operationResult(
          input.operationId,
          "create-label",
          requestKey,
          LabelSchema
        );
        if (previous !== undefined) {
          return previous;
        }
        const now = runtime.now();
        const id = runtime.randomId();
        const [row] = yield* tx
          .insert(label)
          .values({ id, name: input.name, createdAt: now, updatedAt: now })
          .returning();
        if (row === undefined) {
          return yield* Effect.die(new Error("Created label was not returned"));
        }
        const result = labelFromRow(row, mailboxId);
        yield* tx.insert(mailboxOperation).values({
          operationId: input.operationId,
          operationKind: "create-label",
          requestKey,
          resourceId: id,
          resultPayload: JSON.stringify(Schema.encodeSync(LabelSchema)(result)),
          createdAt: now,
        });
        return Result.succeed(result);
      })
    );
  });

export const renameLabel = (mailboxId: MailboxId, input: RenameLabelInput) =>
  Effect.gen(function* () {
    const db = yield* MailboxDatabase;
    const runtime = yield* MailboxDirectoryRuntime;

    return yield* db.transaction((tx) =>
      Effect.gen(function* () {
        const [row] = yield* tx
          .select()
          .from(label)
          .where(and(eq(label.id, input.labelId), isNull(label.deletedAt)));
        if (row === undefined) {
          return Result.fail(
            mailboxDomainError(
              "rename-label",
              "not-found",
              "Label was not found",
              { resourceType: "label", resourceId: input.labelId }
            )
          );
        }
        const current = labelFromRow(row, mailboxId);
        if (current.version !== input.expectedVersion) {
          return Result.fail(
            mailboxDomainError(
              "rename-label",
              "version-conflict",
              "Label version does not match",
              {
                resourceType: "label",
                resourceId: input.labelId,
                expectedVersion: input.expectedVersion,
                actualVersion: current.version,
              }
            )
          );
        }
        const updatedAt = Math.max(runtime.now(), current.updatedAt);
        const [updated] = yield* tx
          .update(label)
          .set({
            name: input.name,
            updatedAt,
            version: sql`${label.version} + 1`,
          })
          .where(
            and(
              eq(label.id, input.labelId),
              eq(label.version, input.expectedVersion),
              isNull(label.deletedAt)
            )
          )
          .returning();
        if (updated === undefined) {
          return yield* Effect.die(new Error("Renamed label was not returned"));
        }
        return Result.succeed(labelFromRow(updated, mailboxId));
      })
    );
  });

export const deleteLabel = (mailboxId: MailboxId, input: DeleteLabelInput) =>
  Effect.gen(function* () {
    const db = yield* MailboxDatabase;
    const runtime = yield* MailboxDirectoryRuntime;

    return yield* db.transaction((tx) =>
      Effect.gen(function* () {
        const [row] = yield* tx
          .select()
          .from(label)
          .where(and(eq(label.id, input.labelId), isNull(label.deletedAt)));
        if (row === undefined) {
          return Result.fail(
            mailboxDomainError(
              "delete-label",
              "not-found",
              "Label was not found",
              { resourceType: "label", resourceId: input.labelId }
            )
          );
        }
        const current = labelFromRow(row, mailboxId);
        if (current.version !== input.expectedVersion) {
          return Result.fail(
            mailboxDomainError(
              "delete-label",
              "version-conflict",
              "Label version does not match",
              {
                resourceType: "label",
                resourceId: input.labelId,
                expectedVersion: input.expectedVersion,
                actualVersion: current.version,
              }
            )
          );
        }
        const deletedAt = Math.max(runtime.now(), current.updatedAt);
        yield* tx
          .update(label)
          .set({
            deletedAt,
            updatedAt: deletedAt,
            version: sql`${label.version} + 1`,
          })
          .where(
            and(
              eq(label.id, input.labelId),
              eq(label.version, input.expectedVersion),
              isNull(label.deletedAt)
            )
          );
        return Result.succeed(
          Schema.decodeUnknownSync(DeletedLabel)({
            id: input.labelId,
            deletedAt,
            version: input.expectedVersion + 1,
          })
        );
      })
    );
  });
