import * as SqliteClient from "@effect/sql-sqlite-do/SqliteClient";
import * as Cloudflare from "alchemy/Cloudflare";
import {
  and,
  asc,
  count,
  desc,
  eq,
  getTableColumns,
  inArray,
  isNull,
  sql,
} from "drizzle-orm";
import * as DrizzleDo from "drizzle-orm/effect-sqlite-do";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import {
  Cursor,
  MailAddress,
  MailboxId,
  MessageId,
  OperationId,
  UnixMillis,
  Version,
} from "./core";
import type { RfcMessageId } from "./core";
import type { CreateFolderInput, CreateLabelInput } from "./directory";
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
} from "./directory";
import { CreateDraftInput, DraftSchema, UpdateDraftInput } from "./drafts";
import type { GetDraftInput } from "./drafts";
import { MailboxDomainError } from "./errors";
import {
  CommitInboundMessageV1,
  InboundProcessingSchema,
  InboundWorkflowParamsV1,
  PreparedInboundReplayV1,
} from "./inbound";
import type {
  CommitInboundMessage as CommitInboundMessageType,
  RecordInboundProcessing,
  ReplayInboundInput,
} from "./inbound";
import {
  AddMessageLabelInput,
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
} from "./messages";
import type {
  GetMessageInput,
  GetThreadInput,
  ListMessagesInput,
  MessageFilters,
  SearchMessagesInput,
} from "./messages";
import {
  CancelOutboundDeliveryInput,
  OutboundDeliveryFailure,
  OutboundDeliveryResult,
  OutboundDeliverySchema,
  OutboundFailureCode,
  ResendOutboundInput,
  ResendOutboundResult,
  ScheduleOutboundInput,
  ScheduleOutboundResult,
} from "./outbound";
import type { GetOutboundDeliveryInput } from "./outbound";
import {
  AttachmentLocation,
  DraftLocation,
  FolderLocation,
  MessageLocation,
  RuleLocation,
} from "./resource-location";
import type {
  MailboxResourceLookup,
  MailboxResourceLookupResult as MailboxResourceLookupResultType,
} from "./resource-location";
import { applyMailboxMigrations } from "./sqlite-migrations";
import {
  attachment,
  draft,
  filterRule,
  folder,
  inboundProcessing,
  label,
  mailboxMetadata,
  mailboxOperation,
  mailboxRelations,
  message,
  messageLabel,
  outboundDelivery,
} from "./sqlite-schema";

export type MailboxDatabase = DrizzleDo.EffectSQLiteDoDatabase<
  typeof mailboxRelations
> & {
  readonly $client: SqliteClient.SqliteClient;
};

/** Effect-native Drizzle client scoped to one mailbox Durable Object. */
export const MailboxDatabase = Context.Service<MailboxDatabase>(
  "cloudflare-inbox/MailboxDatabase"
);

export interface MailboxRuntime {
  readonly now: () => number;
  readonly randomId: () => string;
}

/** Clock and identifier source captured by SQLite store layers. */
export const MailboxRuntime = Context.Service<MailboxRuntime>(
  "cloudflare-inbox/MailboxRuntime"
);

export interface MailboxIdentity {
  readonly mailboxId: MailboxId;
}

/** Canonical identity derived from the Durable Object's addressed name. */
export const MailboxIdentity = Context.Service<MailboxIdentity>(
  "cloudflare-inbox/MailboxIdentity"
);

export const MailboxDatabaseLive = Layer.unwrap(
  Effect.gen(function* () {
    const state = yield* Cloudflare.DurableObjectState;
    const { storage } = state.raw;

    yield* Effect.sync(() => applyMailboxMigrations(storage));
    const clientLive = SqliteClient.layer({ storage });

    return Layer.effect(
      MailboxDatabase,
      DrizzleDo.makeWithDefaults({ relations: mailboxRelations, storage })
    ).pipe(Layer.provide(clientLive));
  })
);

export const MailboxRuntimeLive = Layer.succeed(
  MailboxRuntime,
  MailboxRuntime.of({
    now: Date.now,
    randomId: () => crypto.randomUUID(),
  })
);

export const MailboxIdentityLive = Layer.effect(
  MailboxIdentity,
  Effect.gen(function* () {
    const state = yield* Cloudflare.DurableObjectState;
    const name = yield* Effect.sync(() => {
      if (state.id.name === undefined) {
        throw new Error(
          "MailboxDO must be addressed by canonical mailbox name"
        );
      }
      return state.id.name;
    });
    const mailboxId = yield* Schema.decodeUnknownEffect(MailboxId)(name).pipe(
      Effect.orDie
    );
    return MailboxIdentity.of({ mailboxId });
  })
);

const makeMailboxOperationStore = (db: MailboxDatabase) => ({
  replay: <A>(
    operationId: string,
    operation: MailboxDomainError["operation"],
    operationKind: string,
    requestKey: string,
    schema: Schema.Decoder<A>
  ) =>
    Effect.gen(function* () {
      const [row] = yield* db
        .select({
          operationKind: mailboxOperation.operationKind,
          requestKey: mailboxOperation.requestKey,
          resultPayload: mailboxOperation.resultPayload,
        })
        .from(mailboxOperation)
        .where(eq(mailboxOperation.operationId, operationId))
        .limit(1);

      if (row === undefined) {
        return;
      }
      if (
        row.operationKind !== operationKind ||
        row.requestKey !== requestKey
      ) {
        return Result.fail(
          new MailboxDomainError({
            operation,
            reason: "idempotency-conflict",
            message: "Operation ID was already used for a different request",
            resourceId: operationId,
          })
        );
      }
      return Result.succeed(
        Schema.decodeUnknownSync(schema)(JSON.parse(row.resultPayload))
      );
    }),
  store: (
    operationId: string,
    operationKind: string,
    requestKey: string,
    resourceId: string,
    resultPayload: string,
    createdAt: number
  ) =>
    db
      .insert(mailboxOperation)
      .values({
        operationId,
        operationKind,
        requestKey,
        resourceId,
        resultPayload,
        createdAt,
      })
      .pipe(Effect.asVoid),
});

export type MailboxOperationStore = ReturnType<
  typeof makeMailboxOperationStore
>;

/** Durable operation replay shared by idempotent SQLite mutation stores. */
export const MailboxOperationStore = Context.Service<MailboxOperationStore>(
  "cloudflare-inbox/MailboxOperationStore"
);

export const MailboxOperationStoreLive = Layer.effect(
  MailboxOperationStore,
  Effect.gen(function* () {
    const db = yield* MailboxDatabase;
    return MailboxOperationStore.of(makeMailboxOperationStore(db));
  })
);

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

export const MailboxDirectoryStoreLive = Layer.effect(
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

const resourceNotFound = {
  _tag: "NotFound",
} as const satisfies MailboxResourceLookupResultType;

const initializeMailboxResourceIndex = (mailboxId: MailboxId) =>
  Effect.gen(function* () {
    const db = yield* MailboxDatabase;

    yield* db.transaction((tx) =>
      Effect.gen(function* () {
        const rows = yield* tx
          .select({ mailboxId: mailboxMetadata.mailboxId })
          .from(mailboxMetadata)
          .where(eq(mailboxMetadata.singleton, 1));

        if (rows.length === 0) {
          yield* tx.insert(mailboxMetadata).values({ singleton: 1, mailboxId });
        } else if (rows.length !== 1 || rows[0]?.mailboxId !== mailboxId) {
          return yield* Effect.die(
            new Error(
              "Mailbox database identity does not match its Durable Object"
            )
          );
        }
      })
    );
  });

const resolveMailboxResource = (lookup: MailboxResourceLookup) =>
  Effect.gen(function* () {
    const db = yield* MailboxDatabase;

    switch (lookup._tag) {
      case "Folder": {
        const [row] = yield* db
          .select({
            mailboxId: mailboxMetadata.mailboxId,
            folderId: folder.id,
          })
          .from(mailboxMetadata)
          .crossJoin(folder)
          .where(
            and(
              eq(mailboxMetadata.singleton, 1),
              eq(folder.id, lookup.folderId),
              isNull(folder.deletedAt)
            )
          );
        return row === undefined
          ? resourceNotFound
          : yield* Schema.decodeUnknownEffect(FolderLocation)({
              _tag: "Folder",
              ...row,
            });
      }
      case "Message": {
        const [row] = yield* db
          .select({
            mailboxId: mailboxMetadata.mailboxId,
            folderId: folder.id,
            messageId: message.id,
          })
          .from(mailboxMetadata)
          .crossJoin(message)
          .innerJoin(folder, eq(folder.id, message.folderId))
          .where(
            and(
              eq(mailboxMetadata.singleton, 1),
              eq(message.id, lookup.messageId),
              isNull(message.deletedAt),
              isNull(folder.deletedAt)
            )
          );
        return row === undefined
          ? resourceNotFound
          : yield* Schema.decodeUnknownEffect(MessageLocation)({
              _tag: "Message",
              ...row,
            });
      }
      case "Draft": {
        const [row] = yield* db
          .select({
            mailboxId: mailboxMetadata.mailboxId,
            draftId: draft.id,
          })
          .from(mailboxMetadata)
          .crossJoin(draft)
          .where(
            and(
              eq(mailboxMetadata.singleton, 1),
              eq(draft.id, lookup.draftId),
              isNull(draft.deletedAt)
            )
          );
        return row === undefined
          ? resourceNotFound
          : yield* Schema.decodeUnknownEffect(DraftLocation)({
              _tag: "Draft",
              ...row,
            });
      }
      case "Rule": {
        const [row] = yield* db
          .select({
            mailboxId: mailboxMetadata.mailboxId,
            ruleId: filterRule.id,
          })
          .from(mailboxMetadata)
          .crossJoin(filterRule)
          .where(
            and(
              eq(mailboxMetadata.singleton, 1),
              eq(filterRule.id, lookup.ruleId),
              isNull(filterRule.deletedAt)
            )
          );
        return row === undefined
          ? resourceNotFound
          : yield* Schema.decodeUnknownEffect(RuleLocation)({
              _tag: "Rule",
              ...row,
            });
      }
      case "Attachment": {
        const [row] = yield* db
          .select({
            mailboxId: mailboxMetadata.mailboxId,
            folderId: folder.id,
            messageId: message.id,
            attachmentId: attachment.id,
          })
          .from(mailboxMetadata)
          .crossJoin(attachment)
          .innerJoin(message, eq(message.id, attachment.messageId))
          .innerJoin(folder, eq(folder.id, message.folderId))
          .where(
            and(
              eq(mailboxMetadata.singleton, 1),
              eq(attachment.id, lookup.attachmentId),
              isNull(attachment.deletedAt),
              isNull(message.deletedAt),
              isNull(folder.deletedAt)
            )
          );
        return row === undefined
          ? resourceNotFound
          : yield* Schema.decodeUnknownEffect(AttachmentLocation)({
              _tag: "Attachment",
              ...row,
            });
      }
      default: {
        const exhaustive: never = lookup;
        return exhaustive;
      }
    }
  });

const makeMailboxResourceIndex = (
  db: MailboxDatabase,
  mailboxId: MailboxId
) => ({
  initialize: initializeMailboxResourceIndex(mailboxId).pipe(
    Effect.provideService(MailboxDatabase, db)
  ),
  resolve: (lookup: MailboxResourceLookup) =>
    resolveMailboxResource(lookup).pipe(
      Effect.provideService(MailboxDatabase, db)
    ),
});

export type MailboxResourceIndex = ReturnType<typeof makeMailboxResourceIndex>;

export const MailboxResourceIndex = Context.Service<MailboxResourceIndex>(
  "cloudflare-inbox/MailboxResourceIndex"
);

export const MailboxResourceIndexLive = Layer.effect(
  MailboxResourceIndex,
  Effect.gen(function* () {
    const db = yield* MailboxDatabase;
    const { mailboxId } = yield* MailboxIdentity;
    return MailboxResourceIndex.of(makeMailboxResourceIndex(db, mailboxId));
  })
);

const AddressList = Schema.Array(MailAddress);
const StringList = Schema.Array(Schema.String);

const encodeJson = <A, I>(schema: Schema.Codec<A, I>, value: A) =>
  JSON.stringify(Schema.encodeSync(schema)(value));

const decodeJson = <A>(schema: Schema.Decoder<A>, value: string) =>
  Schema.decodeUnknownSync(schema)(JSON.parse(value));

const optionalAddress = (value: string | null) =>
  value === null ? undefined : decodeJson(MailAddress, value);

const readOutboundDeliveryRow = (
  row: typeof outboundDelivery.$inferSelect,
  mailboxId: MailboxId
) =>
  Schema.decodeUnknownSync(OutboundDeliverySchema)({
    id: row.id,
    resendOf: row.resendOf ?? undefined,
    mailboxId,
    messageId: row.messageId,
    status: row.status,
    sendAt: row.sendAt,
    acceptedAt: row.acceptedAt ?? undefined,
    deliveredAt: row.deliveredAt ?? undefined,
    bouncedAt: row.bouncedAt ?? undefined,
    cancelledAt: row.cancelledAt ?? undefined,
    failure:
      row.failureCode === null
        ? undefined
        : Schema.decodeUnknownSync(OutboundDeliveryFailure)({
            code: Schema.decodeUnknownSync(OutboundFailureCode)(
              row.failureCode
            ),
            failedAt: row.failureAt,
          }),
    attemptCount: row.attemptCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    version: row.version,
  });

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

export const MailboxMessageStoreLive = Layer.effect(
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

const readInboundProcessingRow = (
  row: typeof inboundProcessing.$inferSelect,
  mailboxId: MailboxId
) =>
  Schema.decodeUnknownSync(InboundProcessingSchema)({
    id: row.id,
    mailboxId,
    status: row.status,
    messageId: row.messageId ?? undefined,
    failure:
      row.failureCode === null
        ? undefined
        : {
            code: row.failureCode,
            failedAt: row.failureAt,
            replayable: row.failureReplayable === 1,
          },
    attemptCount: row.attemptCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    version: row.version,
  });

const inboundSnippet = (textBody: string | undefined) =>
  (textBody ?? "").replaceAll(/\s+/gu, " ").trim().slice(0, 500);

const inboundIdentityKey = (input: {
  readonly envelope: CommitInboundMessageType["envelope"];
  readonly inboundIngestId: CommitInboundMessageType["inboundIngestId"];
  readonly mailboxId: MailboxId;
  readonly receivedAt: CommitInboundMessageType["receivedAt"];
}) =>
  JSON.stringify(
    Schema.encodeSync(InboundWorkflowParamsV1)({
      envelope: input.envelope,
      formatVersion: 1,
      inboundIngestId: input.inboundIngestId,
      mailboxId: input.mailboxId,
      receivedAt: input.receivedAt,
    })
  );

const committedInboundIdentityKey = (requestKey: string) =>
  inboundIdentityKey(
    Schema.decodeUnknownSync(CommitInboundMessageV1)(JSON.parse(requestKey))
  );

const inboundCommitRequestKey = (input: CommitInboundMessageType) =>
  JSON.stringify(
    Schema.encodeSync(CommitInboundMessageV1)({
      envelope: input.envelope,
      formatVersion: 1,
      inboundIngestId: input.inboundIngestId,
      mailboxId: input.mailboxId,
      message: input.message,
      receivedAt: input.receivedAt,
    })
  );

const executionAttempt = (
  input:
    | { readonly formatVersion: 1 }
    | { readonly formatVersion: 2; readonly executionAttempt: number }
) => (input.formatVersion === 1 ? 1 : input.executionAttempt);

const checkpointRank = {
  received: 0,
  raw_stored: 1,
  parsing: 2,
  attachments_stored: 3,
} as const;

const recordInboundProcessing = (
  mailboxId: MailboxId,
  input: RecordInboundProcessing,
  runtime: MailboxRuntime
) =>
  Effect.gen(function* () {
    const db = yield* MailboxDatabase;
    return yield* db.transaction((tx) =>
      // oxlint-disable-next-line eslint/complexity -- Monotonic state validation must be atomic with the write.
      Effect.gen(function* () {
        const requestKey = inboundIdentityKey(input);
        const attempt = executionAttempt(input);
        const [existing] = yield* tx
          .select()
          .from(inboundProcessing)
          .where(eq(inboundProcessing.id, input.inboundIngestId))
          .limit(1);
        if (existing !== undefined) {
          if (existing.attemptCount !== attempt) {
            return yield* messageDomainError(
              "record-inbound",
              "invalid-state",
              "Inbound Workflow execution is stale",
              { resourceType: "inbound", resourceId: input.inboundIngestId }
            );
          }
          if (
            existing.status === "ready" &&
            input._tag === "Failure" &&
            input.message !== undefined
          ) {
            const expectedCommitKey = inboundCommitRequestKey({
              envelope: input.envelope,
              formatVersion: 1,
              inboundIngestId: input.inboundIngestId,
              mailboxId: input.mailboxId,
              message: input.message,
              receivedAt: input.receivedAt,
            });
            if (existing.requestKey !== expectedCommitKey) {
              return yield* messageDomainError(
                "record-inbound",
                "idempotency-conflict",
                "Ready inbound message differs from the failed commit",
                {
                  resourceType: "inbound",
                  resourceId: input.inboundIngestId,
                }
              );
            }
          }
          const existingIdentityKey =
            existing.status === "ready"
              ? committedInboundIdentityKey(existing.requestKey)
              : existing.requestKey;
          if (existingIdentityKey !== requestKey) {
            return yield* messageDomainError(
              "record-inbound",
              "idempotency-conflict",
              "Inbound ingest ID was already recorded with different data",
              {
                resourceType: "inbound",
                resourceId: input.inboundIngestId,
              }
            );
          }
          if (existing.status === "ready" || existing.status === "failed") {
            return readInboundProcessingRow(existing, mailboxId);
          }

          const updatedAt = Math.max(
            runtime.now(),
            input.receivedAt,
            existing.updatedAt
          );
          if (input._tag === "Failure") {
            const [failed] = yield* tx
              .update(inboundProcessing)
              .set({
                status: "failed",
                failureCode: input.failure.code,
                failureAt: updatedAt,
                failureReplayable: input.failure.replayable ? 1 : 0,
                updatedAt,
                version: existing.version + 1,
              })
              .where(eq(inboundProcessing.id, input.inboundIngestId))
              .returning();
            if (failed === undefined) {
              return yield* Effect.die(
                new Error("Inbound failure update returned no row")
              );
            }
            return readInboundProcessingRow(failed, mailboxId);
          }

          const currentRank = checkpointRank[existing.status];
          const requestedRank = checkpointRank[input.status];
          if (requestedRank <= currentRank) {
            return readInboundProcessingRow(existing, mailboxId);
          }
          if (requestedRank !== currentRank + 1) {
            return yield* messageDomainError(
              "record-inbound",
              "invalid-state",
              "Inbound checkpoint cannot skip a processing state",
              {
                resourceType: "inbound",
                resourceId: input.inboundIngestId,
              }
            );
          }
          const [advanced] = yield* tx
            .update(inboundProcessing)
            .set({
              status: input.status,
              updatedAt,
              version: existing.version + 1,
            })
            .where(eq(inboundProcessing.id, input.inboundIngestId))
            .returning();
          if (advanced === undefined) {
            return yield* Effect.die(
              new Error("Inbound checkpoint update returned no row")
            );
          }
          return readInboundProcessingRow(advanced, mailboxId);
        }

        if (attempt !== 1) {
          return yield* messageDomainError(
            "record-inbound",
            "invalid-state",
            "Replayed inbound processing must already be prepared",
            { resourceType: "inbound", resourceId: input.inboundIngestId }
          );
        }
        if (input._tag === "Checkpoint" && input.status !== "raw_stored") {
          return yield* messageDomainError(
            "record-inbound",
            "invalid-state",
            "Inbound processing must begin at raw_stored",
            {
              resourceType: "inbound",
              resourceId: input.inboundIngestId,
            }
          );
        }
        const updatedAt = Math.max(runtime.now(), input.receivedAt);
        const [created] = yield* tx
          .insert(inboundProcessing)
          .values({
            id: input.inboundIngestId,
            status: input._tag === "Failure" ? "failed" : input.status,
            requestKey,
            failureCode: input._tag === "Failure" ? input.failure.code : null,
            failureAt: input._tag === "Failure" ? updatedAt : null,
            failureReplayable:
              input._tag === "Failure"
                ? input.failure.replayable
                  ? 1
                  : 0
                : null,
            attemptCount: 1,
            createdAt: input.receivedAt,
            updatedAt,
            version: 1,
          })
          .returning();
        if (created === undefined) {
          return yield* Effect.die(
            new Error("Inbound processing insert returned no row")
          );
        }
        return readInboundProcessingRow(created, mailboxId);
      })
    );
  });

const commitInboundMessage = (
  mailboxId: MailboxId,
  input: CommitInboundMessageType,
  runtime: MailboxRuntime
) =>
  Effect.gen(function* () {
    const db = yield* MailboxDatabase;
    return yield* db.transaction((tx) =>
      // oxlint-disable-next-line eslint/complexity -- The atomic commit keeps validation and writes in one transaction.
      Effect.gen(function* () {
        const requestKey = inboundCommitRequestKey(input);
        const identityKey = inboundIdentityKey(input);
        const attempt = executionAttempt(input);
        const [existing] = yield* tx
          .select()
          .from(inboundProcessing)
          .where(eq(inboundProcessing.id, input.inboundIngestId))
          .limit(1);
        if (existing !== undefined) {
          if (existing.attemptCount !== attempt) {
            return yield* messageDomainError(
              "commit-inbound",
              "invalid-state",
              "Inbound Workflow execution is stale",
              { resourceType: "inbound", resourceId: input.inboundIngestId }
            );
          }
          if (existing.status === "ready") {
            if (existing.requestKey !== requestKey) {
              return yield* messageDomainError(
                "commit-inbound",
                "idempotency-conflict",
                "Inbound ingest ID was already committed with different data",
                {
                  resourceType: "inbound",
                  resourceId: input.inboundIngestId,
                }
              );
            }
            return readInboundProcessingRow(existing, mailboxId);
          }
          if (existing.requestKey !== identityKey) {
            return yield* messageDomainError(
              "commit-inbound",
              "idempotency-conflict",
              "Inbound ingest ID was already recorded with different data",
              {
                resourceType: "inbound",
                resourceId: input.inboundIngestId,
              }
            );
          }
          if (existing.status !== "attachments_stored") {
            return yield* messageDomainError(
              "commit-inbound",
              "invalid-state",
              "Inbound processing has not stored its attachments",
              {
                resourceType: "inbound",
                resourceId: input.inboundIngestId,
              }
            );
          }
        }
        if (existing === undefined && attempt !== 1) {
          return yield* messageDomainError(
            "commit-inbound",
            "invalid-state",
            "Replayed inbound processing must already be prepared",
            { resourceType: "inbound", resourceId: input.inboundIngestId }
          );
        }

        const nearestReferences: RfcMessageId[] = [];
        for (
          let index = input.message.references.length - 1;
          index >= 0;
          index -= 1
        ) {
          const reference = input.message.references[index];
          if (reference !== undefined) {
            nearestReferences.push(reference);
          }
        }
        const referenceIds = [
          ...(input.message.inReplyTo === undefined
            ? []
            : [input.message.inReplyTo]),
          ...nearestReferences,
        ].filter((value, index, values) => values.indexOf(value) === index);
        const referencedMessages =
          referenceIds.length === 0
            ? []
            : yield* tx
                .select({
                  rfcMessageId: message.rfcMessageId,
                  threadId: message.threadId,
                })
                .from(message)
                .where(inArray(message.rfcMessageId, referenceIds));
        const referencedThreadId = referenceIds
          .map((referenceId) =>
            referencedMessages
              .filter(({ rfcMessageId }) => rfcMessageId === referenceId)
              .map(({ threadId }) => threadId)
              .filter((value, index, values) => values.indexOf(value) === index)
          )
          .find((threadIds) => threadIds.length === 1)?.[0];
        const threadId = referencedThreadId ?? runtime.randomId();
        const messageId = runtime.randomId();
        const now = Math.max(
          runtime.now(),
          input.receivedAt,
          existing?.updatedAt ?? 0
        );
        const recipients = [
          ...input.message.to,
          ...input.message.cc,
          ...input.message.bcc,
        ];

        yield* tx.insert(message).values({
          id: messageId,
          folderId: "inbox",
          version: 1,
          read: 0,
          threadId,
          direction: "inbound",
          subject: input.message.subject,
          senderJson:
            input.message.sender === undefined
              ? null
              : encodeJson(MailAddress, input.message.sender),
          recipientsJson: encodeJson(AddressList, recipients),
          snippet: inboundSnippet(input.message.textBody),
          activityAt: input.receivedAt,
          starred: 0,
          needsReply: 0,
          size: input.envelope.rawSize,
          rfcMessageId: input.message.rfcMessageId ?? null,
          inReplyTo: input.message.inReplyTo ?? null,
          referencesJson: encodeJson(StringList, input.message.references),
          toJson: encodeJson(AddressList, input.message.to),
          ccJson: encodeJson(AddressList, input.message.cc),
          bccJson: encodeJson(AddressList, input.message.bcc),
          textBody: input.message.textBody ?? null,
          htmlBody: input.message.htmlBody ?? null,
          headerDate: input.message.headerDate ?? null,
          receivedAt: input.receivedAt,
          createdAt: now,
          updatedAt: now,
        });

        const result = Schema.decodeUnknownSync(InboundProcessingSchema)({
          id: input.inboundIngestId,
          mailboxId,
          status: "ready",
          messageId,
          attemptCount: existing?.attemptCount ?? 1,
          createdAt: existing?.createdAt ?? input.receivedAt,
          updatedAt: now,
          version: existing === undefined ? 1 : existing.version + 1,
        });
        yield* (
          existing === undefined
            ? tx.insert(inboundProcessing).values({
                id: result.id,
                status: result.status,
                messageId: result.messageId,
                requestKey,
                attemptCount: result.attemptCount,
                createdAt: result.createdAt,
                updatedAt: result.updatedAt,
                version: result.version,
              })
            : tx
                .update(inboundProcessing)
                .set({
                  status: result.status,
                  messageId: result.messageId,
                  requestKey,
                  updatedAt: result.updatedAt,
                  version: result.version,
                })
                .where(eq(inboundProcessing.id, result.id))
        ).pipe(Effect.asVoid);

        for (const metadata of input.message.attachments) {
          yield* tx.insert(attachment).values({
            id: runtime.randomId(),
            messageId,
            version: 1,
            fileName: metadata.fileName ?? "attachment",
            mimeType: metadata.mimeType,
            size: metadata.size,
            contentId: metadata.contentId ?? null,
            inboundIngestId: input.inboundIngestId,
            sourceIndex: metadata.index,
            disposition: metadata.disposition,
          });
        }

        return result;
      })
    );
  });

const prepareInboundReplay = (
  mailboxId: MailboxId,
  input: ReplayInboundInput,
  runtime: MailboxRuntime,
  operations: MailboxOperationStore
) =>
  Effect.gen(function* () {
    const db = yield* MailboxDatabase;
    return yield* db.transaction((tx) =>
      Effect.gen(function* () {
        const requestKey = JSON.stringify({
          inboundIngestId: input.inboundIngestId,
          mailboxId: input.mailboxId,
        });
        const previous = yield* operations.replay(
          input.operationId,
          "replay-inbound",
          "replay-inbound",
          requestKey,
          PreparedInboundReplayV1
        );
        if (previous !== undefined) {
          if (Result.isFailure(previous)) {
            return yield* previous.failure;
          }
          return previous.success;
        }
        const [existing] = yield* tx
          .select()
          .from(inboundProcessing)
          .where(eq(inboundProcessing.id, input.inboundIngestId))
          .limit(1);
        if (existing === undefined) {
          return yield* messageDomainError(
            "replay-inbound",
            "not-found",
            "Inbound processing was not found",
            { resourceType: "inbound", resourceId: input.inboundIngestId }
          );
        }
        if (existing.status !== "failed" || existing.failureReplayable !== 1) {
          return yield* messageDomainError(
            "replay-inbound",
            "invalid-state",
            "Inbound processing is not replayable",
            { resourceType: "inbound", resourceId: input.inboundIngestId }
          );
        }
        const original = Schema.decodeUnknownSync(InboundWorkflowParamsV1)(
          JSON.parse(existing.requestKey)
        );
        const workflowInstanceId = Schema.decodeUnknownSync(OperationId)(
          runtime.randomId()
        );
        const attemptCount = Math.max(existing.attemptCount, 1) + 1;
        const updatedAt = Math.max(runtime.now(), existing.updatedAt);
        const [reopened] = yield* tx
          .update(inboundProcessing)
          .set({
            status: "received",
            failureCode: null,
            failureAt: null,
            failureReplayable: null,
            attemptCount,
            updatedAt,
            version: existing.version + 1,
          })
          .where(eq(inboundProcessing.id, input.inboundIngestId))
          .returning();
        if (reopened === undefined) {
          return yield* Effect.die(
            new Error("Inbound replay update returned no row")
          );
        }
        const prepared = Schema.decodeUnknownSync(PreparedInboundReplayV1)({
          formatVersion: 1,
          processing: readInboundProcessingRow(reopened, mailboxId),
          workflow: {
            ...original,
            executionAttempt: attemptCount,
            formatVersion: 2,
            workflowInstanceId,
          },
        });
        yield* operations.store(
          input.operationId,
          "replay-inbound",
          requestKey,
          input.inboundIngestId,
          JSON.stringify(Schema.encodeSync(PreparedInboundReplayV1)(prepared)),
          updatedAt
        );
        return prepared;
      })
    );
  });

const makeMailboxInboundStore = (
  db: MailboxDatabase,
  runtime: MailboxRuntime,
  mailboxId: MailboxId,
  operations: MailboxOperationStore
) => ({
  commit: (input: CommitInboundMessageType) =>
    commitInboundMessage(mailboxId, input, runtime).pipe(
      Effect.provideService(MailboxDatabase, db)
    ),
  record: (input: RecordInboundProcessing) =>
    recordInboundProcessing(mailboxId, input, runtime).pipe(
      Effect.provideService(MailboxDatabase, db)
    ),
  prepareReplay: (input: ReplayInboundInput) =>
    prepareInboundReplay(mailboxId, input, runtime, operations).pipe(
      Effect.provideService(MailboxDatabase, db)
    ),
});

export type MailboxInboundStore = ReturnType<typeof makeMailboxInboundStore>;

export const MailboxInboundStore = Context.Service<MailboxInboundStore>(
  "cloudflare-inbox/MailboxInboundStore"
);

export const MailboxInboundStoreLive = Layer.effect(
  MailboxInboundStore,
  Effect.gen(function* () {
    const db = yield* MailboxDatabase;
    const runtime = yield* MailboxRuntime;
    const { mailboxId } = yield* MailboxIdentity;
    const operations = yield* MailboxOperationStore;
    return MailboxInboundStore.of(
      makeMailboxInboundStore(db, runtime, mailboxId, operations)
    );
  })
);

const draftNotFound = (
  operation: "get-draft" | "update-draft",
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
    updateDraft: (input: UpdateDraftInput) =>
      provideDatabase(updateDraft(mailboxId, input, runtime, operations)),
  };
};

export type MailboxDraftStore = ReturnType<typeof makeMailboxDraftStore>;

export const MailboxDraftStore = Context.Service<MailboxDraftStore>(
  "cloudflare-inbox/MailboxDraftStore"
);

export const MailboxDraftStoreLive = Layer.effect(
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

const deliveryNotFound = (
  operation: MailboxDomainError["operation"],
  id: string
) =>
  new MailboxDomainError({
    operation,
    reason: "not-found",
    message: "Outbound delivery was not found",
    resourceType: "outbound",
    resourceId: id,
  });

const versionConflict = (
  operation: MailboxDomainError["operation"],
  id: string,
  expectedVersion: Schema.Schema.Type<typeof Version>,
  actualVersion: unknown
) =>
  new MailboxDomainError({
    operation,
    reason: "version-conflict",
    message: "Outbound delivery version does not match",
    resourceType: "outbound",
    resourceId: id,
    expectedVersion,
    actualVersion: Schema.decodeUnknownSync(Version)(actualVersion),
  });

const getOutboundDelivery = (
  mailboxId: MailboxId,
  input: GetOutboundDeliveryInput
) =>
  Effect.gen(function* () {
    const db = yield* MailboxDatabase;
    const [row] = yield* db
      .select()
      .from(outboundDelivery)
      .where(
        and(
          eq(outboundDelivery.id, input.outboundDeliveryId),
          isNull(outboundDelivery.deletedAt)
        )
      )
      .limit(1);
    if (row === undefined) {
      return yield* deliveryNotFound("get-outbound", input.outboundDeliveryId);
    }
    return readOutboundDeliveryRow(row, mailboxId);
  });

const scheduleOutbound = (
  mailboxId: MailboxId,
  input: ScheduleOutboundInput,
  runtime: MailboxRuntime,
  operations: MailboxOperationStore
) =>
  Effect.gen(function* () {
    const db = yield* MailboxDatabase;
    return yield* db.transaction((tx) =>
      Effect.gen(function* () {
        const requestKey = JSON.stringify(
          Schema.encodeSync(ScheduleOutboundInput)(input)
        );
        const previous = yield* operations.replay(
          input.operationId,
          "schedule-outbound",
          "schedule-outbound",
          requestKey,
          ScheduleOutboundResult
        );
        if (previous !== undefined) {
          if (Result.isFailure(previous)) {
            return yield* previous.failure;
          }
          return previous.success;
        }
        const [sourceDraft] = yield* tx
          .select()
          .from(draft)
          .where(and(eq(draft.id, input.draftId), isNull(draft.deletedAt)))
          .limit(1);
        if (sourceDraft === undefined) {
          return yield* new MailboxDomainError({
            operation: "schedule-outbound",
            reason: "not-found",
            message: "Draft was not found",
            resourceType: "draft",
            resourceId: input.draftId,
          });
        }
        if (sourceDraft.version !== input.expectedVersion) {
          return yield* new MailboxDomainError({
            operation: "schedule-outbound",
            reason: "version-conflict",
            message: "Draft version does not match",
            resourceType: "draft",
            resourceId: input.draftId,
            expectedVersion: input.expectedVersion,
            actualVersion: Schema.decodeUnknownSync(Version)(
              sourceDraft.version
            ),
          });
        }
        const now = runtime.now();
        if (input.sendAt < now) {
          return yield* new MailboxDomainError({
            operation: "schedule-outbound",
            reason: "validation",
            message: "sendAt cannot be earlier than server time",
            resourceType: "draft",
            resourceId: input.draftId,
          });
        }
        const recipients = [
          ...decodeJson(AddressList, sourceDraft.toJson),
          ...decodeJson(AddressList, sourceDraft.ccJson),
          ...decodeJson(AddressList, sourceDraft.bccJson),
        ];
        if (recipients.length === 0) {
          return yield* new MailboxDomainError({
            operation: "schedule-outbound",
            reason: "validation",
            message: "At least one recipient is required",
            resourceType: "draft",
            resourceId: input.draftId,
          });
        }
        const attachmentIds = decodeJson(
          StringList,
          sourceDraft.attachmentIdsJson
        );
        const attachments = yield* Effect.all(
          attachmentIds.map((attachmentId) =>
            tx
              .select()
              .from(attachment)
              .where(
                and(
                  eq(attachment.id, attachmentId),
                  isNull(attachment.deletedAt)
                )
              )
              .limit(1)
              .pipe(Effect.map((rows) => rows[0]))
          )
        );
        if (attachments.some((item) => item === undefined)) {
          return yield* new MailboxDomainError({
            operation: "schedule-outbound",
            reason: "validation",
            message: "Draft contains an unavailable attachment",
            resourceType: "draft",
            resourceId: input.draftId,
          });
        }

        const messageId = runtime.randomId();
        const deliveryId = runtime.randomId();
        const threadId = sourceDraft.threadId ?? runtime.randomId();
        const body = sourceDraft.textBody ?? "";
        yield* tx.insert(message).values({
          id: messageId,
          folderId: "scheduled",
          threadId,
          direction: "outbound",
          outboundDeliveryId: deliveryId,
          subject: sourceDraft.subject,
          recipientsJson: JSON.stringify(recipients),
          snippet: body.slice(0, 500),
          activityAt: input.sendAt,
          size: body.length,
          referencesJson: "[]",
          toJson: sourceDraft.toJson,
          ccJson: sourceDraft.ccJson,
          bccJson: sourceDraft.bccJson,
          textBody: sourceDraft.textBody,
          htmlBody: sourceDraft.htmlBody,
          scheduledAt: input.sendAt,
          createdAt: now,
          updatedAt: now,
        });
        for (const source of attachments) {
          if (source !== undefined) {
            yield* tx.insert(attachment).values({
              id: runtime.randomId(),
              messageId,
              fileName: source.fileName,
              mimeType: source.mimeType,
              size: source.size,
              contentId: source.contentId,
              disposition: source.disposition,
            });
          }
        }
        const [deliveryRow] = yield* tx
          .insert(outboundDelivery)
          .values({
            id: deliveryId,
            messageId,
            status: "scheduled",
            sendAt: input.sendAt,
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        if (deliveryRow === undefined) {
          return yield* Effect.die("Outbound delivery insert returned no row");
        }
        const updatedDraft = yield* tx
          .update(draft)
          .set({
            deletedAt: now,
            updatedAt: sql`max(${draft.updatedAt}, ${now})`,
            version: sql`${draft.version} + 1`,
          })
          .where(
            and(
              eq(draft.id, input.draftId),
              eq(draft.version, input.expectedVersion)
            )
          )
          .returning({ id: draft.id });
        if (updatedDraft.length !== 1) {
          return yield* new MailboxDomainError({
            operation: "schedule-outbound",
            reason: "version-conflict",
            message: "Draft version does not match",
            resourceType: "draft",
            resourceId: input.draftId,
            expectedVersion: input.expectedVersion,
            actualVersion: Schema.decodeUnknownSync(Version)(
              sourceDraft.version
            ),
          });
        }
        const result = Schema.decodeUnknownSync(ScheduleOutboundResult)({
          delivery: readOutboundDeliveryRow(deliveryRow, mailboxId),
          serverNow: now,
        });
        yield* operations.store(
          input.operationId,
          "schedule-outbound",
          requestKey,
          deliveryId,
          JSON.stringify(Schema.encodeSync(ScheduleOutboundResult)(result)),
          now
        );
        return result;
      })
    );
  });

const cancelOutboundDelivery = (
  mailboxId: MailboxId,
  input: CancelOutboundDeliveryInput,
  runtime: MailboxRuntime,
  operations: MailboxOperationStore
) =>
  Effect.gen(function* () {
    const db = yield* MailboxDatabase;
    return yield* db.transaction((tx) =>
      Effect.gen(function* () {
        const requestKey = JSON.stringify(
          Schema.encodeSync(CancelOutboundDeliveryInput)(input)
        );
        const previous = yield* operations.replay(
          input.operationId,
          "cancel-outbound",
          "cancel-outbound",
          requestKey,
          OutboundDeliveryResult
        );
        if (previous !== undefined) {
          if (Result.isFailure(previous)) {
            return yield* previous.failure;
          }
          return previous.success;
        }
        const [current] = yield* tx
          .select()
          .from(outboundDelivery)
          .where(
            and(
              eq(outboundDelivery.id, input.outboundDeliveryId),
              isNull(outboundDelivery.deletedAt)
            )
          )
          .limit(1);
        if (current === undefined) {
          return yield* deliveryNotFound(
            "cancel-outbound",
            input.outboundDeliveryId
          );
        }
        if (current.version !== input.expectedVersion) {
          return yield* versionConflict(
            "cancel-outbound",
            input.outboundDeliveryId,
            input.expectedVersion,
            current.version
          );
        }
        if (current.status !== "scheduled") {
          return yield* new MailboxDomainError({
            operation: "cancel-outbound",
            reason: "invalid-state",
            message: "Only scheduled deliveries can be cancelled",
            resourceType: "outbound",
            resourceId: input.outboundDeliveryId,
          });
        }
        const now = Math.max(runtime.now(), current.createdAt);
        const [updated] = yield* tx
          .update(outboundDelivery)
          .set({
            status: "cancelled",
            cancelledAt: now,
            updatedAt: now,
            version: sql`${outboundDelivery.version} + 1`,
          })
          .where(
            and(
              eq(outboundDelivery.id, input.outboundDeliveryId),
              eq(outboundDelivery.version, input.expectedVersion)
            )
          )
          .returning();
        if (updated === undefined) {
          return yield* versionConflict(
            "cancel-outbound",
            input.outboundDeliveryId,
            input.expectedVersion,
            current.version
          );
        }
        const result = readOutboundDeliveryRow(updated, mailboxId);
        yield* operations.store(
          input.operationId,
          "cancel-outbound",
          requestKey,
          input.outboundDeliveryId,
          JSON.stringify(Schema.encodeSync(OutboundDeliveryResult)(result)),
          result.updatedAt
        );
        return result;
      })
    );
  });

const resendOutbound = (
  mailboxId: MailboxId,
  input: ResendOutboundInput,
  runtime: MailboxRuntime,
  operations: MailboxOperationStore
) =>
  Effect.gen(function* () {
    const db = yield* MailboxDatabase;
    return yield* db.transaction((tx) =>
      Effect.gen(function* () {
        const requestKey = JSON.stringify(
          Schema.encodeSync(ResendOutboundInput)(input)
        );
        const previous = yield* operations.replay(
          input.operationId,
          "resend-outbound",
          "resend-outbound",
          requestKey,
          ResendOutboundResult
        );
        if (previous !== undefined) {
          if (Result.isFailure(previous)) {
            return yield* previous.failure;
          }
          return previous.success;
        }
        const [source] = yield* tx
          .select()
          .from(outboundDelivery)
          .where(
            and(
              eq(outboundDelivery.id, input.outboundDeliveryId),
              isNull(outboundDelivery.deletedAt)
            )
          )
          .limit(1);
        if (source === undefined) {
          return yield* deliveryNotFound(
            "resend-outbound",
            input.outboundDeliveryId
          );
        }
        if (source.version !== input.expectedVersion) {
          return yield* versionConflict(
            "resend-outbound",
            input.outboundDeliveryId,
            input.expectedVersion,
            source.version
          );
        }
        if (
          source.status !== "failed" &&
          source.status !== "indeterminate" &&
          source.status !== "bounced"
        ) {
          return yield* new MailboxDomainError({
            operation: "resend-outbound",
            reason: "invalid-state",
            message: "Delivery state is not eligible for resend",
            resourceType: "outbound",
            resourceId: input.outboundDeliveryId,
          });
        }
        const [sourceMessage] = yield* tx
          .select()
          .from(message)
          .where(
            and(eq(message.id, source.messageId), isNull(message.deletedAt))
          )
          .limit(1);
        if (sourceMessage === undefined) {
          return yield* Effect.die("Outbound source message is missing");
        }

        const now = runtime.now();
        const messageId = runtime.randomId();
        const deliveryId = runtime.randomId();
        yield* tx.insert(message).values({
          id: messageId,
          folderId: "scheduled",
          threadId: sourceMessage.threadId,
          direction: "outbound",
          outboundDeliveryId: deliveryId,
          subject: sourceMessage.subject,
          senderJson: sourceMessage.senderJson,
          recipientsJson: sourceMessage.recipientsJson,
          snippet: sourceMessage.snippet,
          activityAt: now,
          read: sourceMessage.read,
          starred: sourceMessage.starred,
          needsReply: 0,
          size: sourceMessage.size,
          rfcMessageId: sourceMessage.rfcMessageId,
          inReplyTo: sourceMessage.inReplyTo,
          referencesJson: sourceMessage.referencesJson,
          toJson: sourceMessage.toJson,
          ccJson: sourceMessage.ccJson,
          bccJson: sourceMessage.bccJson,
          textBody: sourceMessage.textBody,
          htmlBody: sourceMessage.htmlBody,
          headerDate: sourceMessage.headerDate,
          scheduledAt: now,
          createdAt: now,
          updatedAt: now,
        });
        const sourceAttachments = yield* tx
          .select()
          .from(attachment)
          .where(
            and(
              eq(attachment.messageId, source.messageId),
              isNull(attachment.deletedAt)
            )
          );
        for (const sourceAttachment of sourceAttachments) {
          yield* tx.insert(attachment).values({
            id: runtime.randomId(),
            messageId,
            fileName: sourceAttachment.fileName,
            mimeType: sourceAttachment.mimeType,
            size: sourceAttachment.size,
            contentId: sourceAttachment.contentId,
            disposition: sourceAttachment.disposition,
          });
        }
        const [deliveryRow] = yield* tx
          .insert(outboundDelivery)
          .values({
            id: deliveryId,
            resendOf: input.outboundDeliveryId,
            messageId,
            status: "scheduled",
            sendAt: now,
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        if (deliveryRow === undefined) {
          return yield* Effect.die("Outbound delivery insert returned no row");
        }
        const result = Schema.decodeUnknownSync(ResendOutboundResult)({
          sourceDeliveryId: input.outboundDeliveryId,
          delivery: readOutboundDeliveryRow(deliveryRow, mailboxId),
        });
        yield* operations.store(
          input.operationId,
          "resend-outbound",
          requestKey,
          deliveryId,
          JSON.stringify(Schema.encodeSync(ResendOutboundResult)(result)),
          now
        );
        return result;
      })
    );
  });

const makeMailboxOutboundStore = (
  db: MailboxDatabase,
  runtime: MailboxRuntime,
  mailboxId: MailboxId,
  operations: MailboxOperationStore
) => {
  const provideDatabase = <A, E>(
    effect: Effect.Effect<A, E, MailboxDatabase>
  ) => effect.pipe(Effect.provideService(MailboxDatabase, db));

  return {
    getOutboundDelivery: (input: GetOutboundDeliveryInput) =>
      provideDatabase(getOutboundDelivery(mailboxId, input)),
    scheduleOutbound: (input: ScheduleOutboundInput) =>
      provideDatabase(scheduleOutbound(mailboxId, input, runtime, operations)),
    cancelOutboundDelivery: (input: CancelOutboundDeliveryInput) =>
      provideDatabase(
        cancelOutboundDelivery(mailboxId, input, runtime, operations)
      ),
    resendOutbound: (input: ResendOutboundInput) =>
      provideDatabase(resendOutbound(mailboxId, input, runtime, operations)),
  };
};

export type MailboxOutboundStore = ReturnType<typeof makeMailboxOutboundStore>;

export const MailboxOutboundStore = Context.Service<MailboxOutboundStore>(
  "cloudflare-inbox/MailboxOutboundStore"
);

export const MailboxOutboundStoreLive = Layer.effect(
  MailboxOutboundStore,
  Effect.gen(function* () {
    const db = yield* MailboxDatabase;
    const runtime = yield* MailboxRuntime;
    const { mailboxId } = yield* MailboxIdentity;
    const operations = yield* MailboxOperationStore;
    return MailboxOutboundStore.of(
      makeMailboxOutboundStore(db, runtime, mailboxId, operations)
    );
  })
);
