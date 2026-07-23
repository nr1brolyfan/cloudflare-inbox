import { and, eq, isNull, sql } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import type { MailboxId } from "#/modules/mailbox/domain/Mailbox";
import type {
  CreateFolderInput,
  CreateLabelInput,
} from "#/modules/mailbox/domain/MailboxDirectory";
import {
  DeletedFolder,
  DeletedLabel,
  DeleteFolderInput,
  DeleteLabelInput,
  FolderList,
  FolderSchema,
  FolderSummarySchema,
  LabelList,
  LabelSchema,
  RenameFolderInput,
  RenameLabelInput,
} from "#/modules/mailbox/domain/MailboxDirectory";
import { MailboxDomainError } from "#/modules/mailbox/domain/MailboxError";
import { MailboxIdentity } from "#/modules/mailbox/ports/MailboxIdentity";

import { MailboxOperationStore } from "./MailboxOperationStoreSqlite";
import { MailboxDatabase } from "./MailboxSqliteDatabase";
import { MailboxRuntime } from "./MailboxSqliteRuntime";
import { draft, folder, label, message } from "./MailboxSqliteSchema";

const systemFolders = [
  { id: "inbox", kind: "inbox", name: "Inbox" },
  { id: "sent", kind: "sent", name: "Sent" },
  { id: "drafts", kind: "drafts", name: "Drafts" },
  { id: "scheduled", kind: "scheduled", name: "Scheduled" },
  { id: "archive", kind: "archive", name: "Archive" },
  { id: "spam", kind: "spam", name: "Spam" },
  { id: "trash", kind: "trash", name: "Trash" },
] as const;

const initializeMailboxDirectory = Effect.gen(function* () {
  const db = yield* MailboxDatabase;
  const runtime = yield* MailboxRuntime;

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

const listFolders = (mailboxId: MailboxId) =>
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
        messageCount: sql<number>`case
          when ${folder.kind} = 'drafts' then (
            select count(*) from ${draft} where ${draft.deletedAt} is null
          )
          else count(${message.id})
        end`,
        unreadCount: sql<number>`case
          when ${folder.kind} = 'drafts' then 0
          else coalesce(sum(case when ${message.read} = 0 then 1 else 0 end), 0)
        end`,
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

const createFolder = (
  mailboxId: MailboxId,
  input: CreateFolderInput,
  operations: MailboxOperationStore
) =>
  Effect.gen(function* () {
    const db = yield* MailboxDatabase;
    const runtime = yield* MailboxRuntime;

    return yield* db.transaction((tx) =>
      Effect.gen(function* () {
        const requestKey = JSON.stringify({ name: input.name });
        const previous = yield* operations.replay(
          input.operationId,
          "create-folder",
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
        yield* operations.store(
          input.operationId,
          "create-folder",
          requestKey,
          id,
          JSON.stringify(Schema.encodeSync(FolderSchema)(result)),
          now
        );
        return Result.succeed(result);
      })
    );
  });

const renameFolder = (
  mailboxId: MailboxId,
  input: RenameFolderInput,
  operations: MailboxOperationStore
) =>
  Effect.gen(function* () {
    const db = yield* MailboxDatabase;
    const runtime = yield* MailboxRuntime;

    return yield* db.transaction((tx) =>
      Effect.gen(function* () {
        const requestKey = JSON.stringify(
          Schema.encodeSync(RenameFolderInput)(input)
        );
        const previous = yield* operations.replay(
          input.operationId,
          "rename-folder",
          "rename-folder",
          requestKey,
          FolderSchema
        );
        if (previous !== undefined) {
          return previous;
        }
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
        const result = folderFromRow(updated, mailboxId);
        yield* operations.store(
          input.operationId,
          "rename-folder",
          requestKey,
          input.folderId,
          JSON.stringify(Schema.encodeSync(FolderSchema)(result)),
          updatedAt
        );
        return Result.succeed(result);
      })
    );
  });

const deleteFolder = (
  mailboxId: MailboxId,
  input: DeleteFolderInput,
  operations: MailboxOperationStore
) =>
  Effect.gen(function* () {
    const db = yield* MailboxDatabase;
    const runtime = yield* MailboxRuntime;

    return yield* db.transaction((tx) =>
      Effect.gen(function* () {
        const requestKey = JSON.stringify(
          Schema.encodeSync(DeleteFolderInput)(input)
        );
        const previous = yield* operations.replay(
          input.operationId,
          "delete-folder",
          "delete-folder",
          requestKey,
          DeletedFolder
        );
        if (previous !== undefined) {
          return previous;
        }
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
        const [updated] = yield* tx
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
          )
          .returning({ id: folder.id });
        if (updated === undefined) {
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
        const result = Schema.decodeUnknownSync(DeletedFolder)({
          id: input.folderId,
          deletedAt,
          version: input.expectedVersion + 1,
        });
        yield* operations.store(
          input.operationId,
          "delete-folder",
          requestKey,
          input.folderId,
          JSON.stringify(Schema.encodeSync(DeletedFolder)(result)),
          deletedAt
        );
        return Result.succeed(result);
      })
    );
  });

const listLabels = (mailboxId: MailboxId) =>
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

const createLabel = (
  mailboxId: MailboxId,
  input: CreateLabelInput,
  operations: MailboxOperationStore
) =>
  Effect.gen(function* () {
    const db = yield* MailboxDatabase;
    const runtime = yield* MailboxRuntime;

    return yield* db.transaction((tx) =>
      Effect.gen(function* () {
        const requestKey = JSON.stringify({ name: input.name });
        const previous = yield* operations.replay(
          input.operationId,
          "create-label",
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
        yield* operations.store(
          input.operationId,
          "create-label",
          requestKey,
          id,
          JSON.stringify(Schema.encodeSync(LabelSchema)(result)),
          now
        );
        return Result.succeed(result);
      })
    );
  });

const renameLabel = (
  mailboxId: MailboxId,
  input: RenameLabelInput,
  operations: MailboxOperationStore
) =>
  Effect.gen(function* () {
    const db = yield* MailboxDatabase;
    const runtime = yield* MailboxRuntime;

    return yield* db.transaction((tx) =>
      Effect.gen(function* () {
        const requestKey = JSON.stringify(
          Schema.encodeSync(RenameLabelInput)(input)
        );
        const previous = yield* operations.replay(
          input.operationId,
          "rename-label",
          "rename-label",
          requestKey,
          LabelSchema
        );
        if (previous !== undefined) {
          return previous;
        }
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
        const result = labelFromRow(updated, mailboxId);
        yield* operations.store(
          input.operationId,
          "rename-label",
          requestKey,
          input.labelId,
          JSON.stringify(Schema.encodeSync(LabelSchema)(result)),
          updatedAt
        );
        return Result.succeed(result);
      })
    );
  });

const deleteLabel = (
  mailboxId: MailboxId,
  input: DeleteLabelInput,
  operations: MailboxOperationStore
) =>
  Effect.gen(function* () {
    const db = yield* MailboxDatabase;
    const runtime = yield* MailboxRuntime;

    return yield* db.transaction((tx) =>
      Effect.gen(function* () {
        const requestKey = JSON.stringify(
          Schema.encodeSync(DeleteLabelInput)(input)
        );
        const previous = yield* operations.replay(
          input.operationId,
          "delete-label",
          "delete-label",
          requestKey,
          DeletedLabel
        );
        if (previous !== undefined) {
          return previous;
        }
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
        const [updated] = yield* tx
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
          )
          .returning({ id: label.id });
        if (updated === undefined) {
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
        const result = Schema.decodeUnknownSync(DeletedLabel)({
          id: input.labelId,
          deletedAt,
          version: input.expectedVersion + 1,
        });
        yield* operations.store(
          input.operationId,
          "delete-label",
          requestKey,
          input.labelId,
          JSON.stringify(Schema.encodeSync(DeletedLabel)(result)),
          deletedAt
        );
        return Result.succeed(result);
      })
    );
  });

const provideDirectoryDependencies = <A, E>(
  effect: Effect.Effect<A, E, MailboxDatabase | MailboxRuntime>,
  db: MailboxDatabase,
  runtime: MailboxRuntime
) =>
  effect.pipe(
    Effect.provideService(MailboxDatabase, db),
    Effect.provideService(MailboxRuntime, runtime)
  );

const makeMailboxDirectoryStore = (
  db: MailboxDatabase,
  runtime: MailboxRuntime,
  mailboxId: MailboxId,
  operations: MailboxOperationStore
) => ({
  initialize: provideDirectoryDependencies(
    initializeMailboxDirectory,
    db,
    runtime
  ),
  listFolders: () =>
    provideDirectoryDependencies(listFolders(mailboxId), db, runtime),
  createFolder: (input: CreateFolderInput) =>
    provideDirectoryDependencies(
      createFolder(mailboxId, input, operations),
      db,
      runtime
    ),
  renameFolder: (input: RenameFolderInput) =>
    provideDirectoryDependencies(
      renameFolder(mailboxId, input, operations),
      db,
      runtime
    ),
  deleteFolder: (input: DeleteFolderInput) =>
    provideDirectoryDependencies(
      deleteFolder(mailboxId, input, operations),
      db,
      runtime
    ),
  listLabels: () =>
    provideDirectoryDependencies(listLabels(mailboxId), db, runtime),
  createLabel: (input: CreateLabelInput) =>
    provideDirectoryDependencies(
      createLabel(mailboxId, input, operations),
      db,
      runtime
    ),
  renameLabel: (input: RenameLabelInput) =>
    provideDirectoryDependencies(
      renameLabel(mailboxId, input, operations),
      db,
      runtime
    ),
  deleteLabel: (input: DeleteLabelInput) =>
    provideDirectoryDependencies(
      deleteLabel(mailboxId, input, operations),
      db,
      runtime
    ),
});

export type MailboxDirectoryStore = ReturnType<
  typeof makeMailboxDirectoryStore
>;

export const MailboxDirectoryStore = Context.Service<MailboxDirectoryStore>(
  "cloudflare-inbox/MailboxDirectoryStore"
);

export const MailboxDirectoryStoreSqliteLayer = Layer.effect(
  MailboxDirectoryStore,
  Effect.gen(function* () {
    const db = yield* MailboxDatabase;
    const runtime = yield* MailboxRuntime;
    const { mailboxId } = yield* MailboxIdentity;
    const operations = yield* MailboxOperationStore;
    return MailboxDirectoryStore.of(
      makeMailboxDirectoryStore(db, runtime, mailboxId, operations)
    );
  })
);
