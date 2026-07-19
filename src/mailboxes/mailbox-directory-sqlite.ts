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
import type { Folder } from "./folder";
import { FolderSummarySchema } from "./folder-summary";
import type { MailboxId } from "./identifiers";
import { LabelSchema } from "./label";
import type { Label } from "./label";
import type { MailboxDirectoryRuntime } from "./mailbox-directory-runtime";
import type { MailboxSql, MailboxSqlStorage } from "./mailbox-sqlite";

const systemFolders = [
  { id: "inbox", kind: "inbox", name: "Inbox" },
  { id: "sent", kind: "sent", name: "Sent" },
  { id: "drafts", kind: "drafts", name: "Drafts" },
  { id: "scheduled", kind: "scheduled", name: "Scheduled" },
  { id: "archive", kind: "archive", name: "Archive" },
  { id: "spam", kind: "spam", name: "Spam" },
  { id: "trash", kind: "trash", name: "Trash" },
];

const oneOrNotFound = <A>(rows: readonly A[]) =>
  rows.length === 0 ? undefined : rows[0];

export const initializeMailboxDirectory = (
  storage: MailboxSqlStorage,
  runtime: MailboxDirectoryRuntime
) =>
  storage.transactionSync(() => {
    const now = runtime.now();
    for (const folder of systemFolders) {
      storage.sql.exec(
        `INSERT INTO folder
          (id, name, kind, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO NOTHING`,
        folder.id,
        folder.name,
        folder.kind,
        now,
        now
      );
      storage.sql.exec(
        `UPDATE folder
            SET name = ?, kind = ?, created_at = ?, updated_at = ?, deleted_at = NULL
          WHERE id = ?
            AND name = 'Migrated folder'
            AND kind = 'custom'
            AND created_at = 0
            AND updated_at = 0`,
        folder.name,
        folder.kind,
        now,
        now,
        folder.id
      );
    }
  });

const mailboxDomainError = (
  operation: MailboxDomainError["operation"],
  reason: MailboxDomainError["reason"],
  message: string,
  details: Pick<
    MailboxDomainError,
    "resourceType" | "resourceId" | "expectedVersion" | "actualVersion"
  > = {}
) => new MailboxDomainError({ operation, reason, message, ...details });

const folderFromRow = (
  row: Readonly<Record<string, unknown>>,
  mailboxId: MailboxId
) =>
  Schema.decodeUnknownSync(FolderSchema)({
    id: row.id,
    mailboxId,
    name: row.name,
    kind: row.kind,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
  });

const labelFromRow = (
  row: Readonly<Record<string, unknown>>,
  mailboxId: MailboxId
) =>
  Schema.decodeUnknownSync(LabelSchema)({
    id: row.id,
    mailboxId,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
  });

const operationResult = <A>(
  storage: MailboxSqlStorage,
  operationId: string,
  operationKind: "create-folder" | "create-label",
  requestKey: string,
  schema: Schema.Decoder<A>
): Result.Result<A, MailboxDomainError> | undefined => {
  const row = oneOrNotFound(
    storage.sql
      .exec(
        `SELECT operation_kind, request_key, result_payload
           FROM mailbox_operation
          WHERE operation_id = ?`,
        operationId
      )
      .toArray()
  );
  if (row === undefined) {
    return;
  }
  if (row.operation_kind !== operationKind || row.request_key !== requestKey) {
    return Result.fail(
      mailboxDomainError(
        operationKind,
        "idempotency-conflict",
        "Operation ID was already used for a different request",
        { resourceId: operationId }
      )
    );
  }
  if (typeof row.result_payload !== "string") {
    throw new TypeError("Stored mailbox operation result is invalid");
  }
  return Result.succeed(
    Schema.decodeUnknownSync(schema)(JSON.parse(row.result_payload))
  );
};

export const listFolders = (sql: MailboxSql, mailboxId: MailboxId) => {
  const items = sql
    .exec(
      `SELECT folder.id,
              folder.name,
              folder.kind,
              folder.created_at,
              folder.updated_at,
              folder.version,
              COUNT(message.id) AS message_count,
              COALESCE(SUM(CASE WHEN message.read = 0 THEN 1 ELSE 0 END), 0) AS unread_count
         FROM folder
         LEFT JOIN message
           ON message.folder_id = folder.id
          AND message.deleted_at IS NULL
        WHERE folder.deleted_at IS NULL
        GROUP BY folder.id
        ORDER BY CASE folder.kind
          WHEN 'inbox' THEN 0
          WHEN 'sent' THEN 1
          WHEN 'drafts' THEN 2
          WHEN 'scheduled' THEN 3
          WHEN 'archive' THEN 4
          WHEN 'spam' THEN 5
          WHEN 'trash' THEN 6
          ELSE 7
        END, folder.name COLLATE NOCASE, folder.id`
    )
    .toArray()
    .map((row) =>
      Schema.decodeUnknownSync(FolderSummarySchema)({
        ...folderFromRow(row, mailboxId),
        messageCount: row.message_count,
        unreadCount: row.unread_count,
      })
    );
  return Schema.decodeUnknownSync(FolderList)({ items });
};

export const createFolder = (
  storage: MailboxSqlStorage,
  mailboxId: MailboxId,
  input: CreateFolderInput,
  runtime: MailboxDirectoryRuntime
): Result.Result<Folder, MailboxDomainError> =>
  storage.transactionSync(() => {
    const requestKey = JSON.stringify({ name: input.name });
    const previous = operationResult(
      storage,
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
    storage.sql.exec(
      `INSERT INTO folder (id, name, kind, created_at, updated_at)
       VALUES (?, ?, 'custom', ?, ?)`,
      id,
      input.name,
      now,
      now
    );
    const result = folderFromRow(
      storage.sql.exec("SELECT * FROM folder WHERE id = ?", id).toArray()[0] ??
        {},
      mailboxId
    );
    storage.sql.exec(
      `INSERT INTO mailbox_operation
        (operation_id, operation_kind, request_key, resource_id, result_payload, created_at)
       VALUES (?, 'create-folder', ?, ?, ?, ?)`,
      input.operationId,
      requestKey,
      id,
      JSON.stringify(Schema.encodeSync(FolderSchema)(result)),
      now
    );
    return Result.succeed(result);
  });

export const renameFolder = (
  storage: MailboxSqlStorage,
  mailboxId: MailboxId,
  input: RenameFolderInput,
  runtime: MailboxDirectoryRuntime
): Result.Result<Folder, MailboxDomainError> =>
  storage.transactionSync(() => {
    const row = oneOrNotFound(
      storage.sql
        .exec(
          "SELECT * FROM folder WHERE id = ? AND deleted_at IS NULL",
          input.folderId
        )
        .toArray()
    );
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
    storage.sql.exec(
      `UPDATE folder
          SET name = ?, updated_at = ?, version = version + 1
        WHERE id = ? AND version = ? AND deleted_at IS NULL`,
      input.name,
      updatedAt,
      input.folderId,
      input.expectedVersion
    );
    return Result.succeed(
      folderFromRow(
        storage.sql
          .exec("SELECT * FROM folder WHERE id = ?", input.folderId)
          .toArray()[0] ?? {},
        mailboxId
      )
    );
  });

export const deleteFolder = (
  storage: MailboxSqlStorage,
  mailboxId: MailboxId,
  input: DeleteFolderInput,
  runtime: MailboxDirectoryRuntime
): Result.Result<DeletedFolder, MailboxDomainError> =>
  storage.transactionSync(() => {
    const row = oneOrNotFound(
      storage.sql
        .exec(
          "SELECT * FROM folder WHERE id = ? AND deleted_at IS NULL",
          input.folderId
        )
        .toArray()
    );
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
    const activeMessage = oneOrNotFound(
      storage.sql
        .exec(
          "SELECT 1 AS present FROM message WHERE folder_id = ? AND deleted_at IS NULL LIMIT 1",
          input.folderId
        )
        .toArray()
    );
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
    storage.sql.exec(
      `UPDATE folder
          SET deleted_at = ?, updated_at = ?, version = version + 1
        WHERE id = ? AND version = ? AND deleted_at IS NULL`,
      deletedAt,
      deletedAt,
      input.folderId,
      input.expectedVersion
    );
    return Result.succeed(
      Schema.decodeUnknownSync(DeletedFolder)({
        id: input.folderId,
        deletedAt,
        version: input.expectedVersion + 1,
      })
    );
  });

export const listLabels = (sql: MailboxSql, mailboxId: MailboxId) =>
  Schema.decodeUnknownSync(LabelList)({
    items: sql
      .exec(
        `SELECT * FROM label
          WHERE deleted_at IS NULL
          ORDER BY name COLLATE NOCASE, id`
      )
      .toArray()
      .map((row) => labelFromRow(row, mailboxId)),
  });

export const createLabel = (
  storage: MailboxSqlStorage,
  mailboxId: MailboxId,
  input: CreateLabelInput,
  runtime: MailboxDirectoryRuntime
): Result.Result<Label, MailboxDomainError> =>
  storage.transactionSync(() => {
    const requestKey = JSON.stringify({ name: input.name });
    const previous = operationResult(
      storage,
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
    storage.sql.exec(
      `INSERT INTO label (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`,
      id,
      input.name,
      now,
      now
    );
    const result = labelFromRow(
      storage.sql.exec("SELECT * FROM label WHERE id = ?", id).toArray()[0] ??
        {},
      mailboxId
    );
    storage.sql.exec(
      `INSERT INTO mailbox_operation
        (operation_id, operation_kind, request_key, resource_id, result_payload, created_at)
       VALUES (?, 'create-label', ?, ?, ?, ?)`,
      input.operationId,
      requestKey,
      id,
      JSON.stringify(Schema.encodeSync(LabelSchema)(result)),
      now
    );
    return Result.succeed(result);
  });

export const renameLabel = (
  storage: MailboxSqlStorage,
  mailboxId: MailboxId,
  input: RenameLabelInput,
  runtime: MailboxDirectoryRuntime
): Result.Result<Label, MailboxDomainError> =>
  storage.transactionSync(() => {
    const row = oneOrNotFound(
      storage.sql
        .exec(
          "SELECT * FROM label WHERE id = ? AND deleted_at IS NULL",
          input.labelId
        )
        .toArray()
    );
    if (row === undefined) {
      return Result.fail(
        mailboxDomainError("rename-label", "not-found", "Label was not found", {
          resourceType: "label",
          resourceId: input.labelId,
        })
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
    storage.sql.exec(
      `UPDATE label
          SET name = ?, updated_at = ?, version = version + 1
        WHERE id = ? AND version = ? AND deleted_at IS NULL`,
      input.name,
      updatedAt,
      input.labelId,
      input.expectedVersion
    );
    return Result.succeed(
      labelFromRow(
        storage.sql
          .exec("SELECT * FROM label WHERE id = ?", input.labelId)
          .toArray()[0] ?? {},
        mailboxId
      )
    );
  });

export const deleteLabel = (
  storage: MailboxSqlStorage,
  mailboxId: MailboxId,
  input: DeleteLabelInput,
  runtime: MailboxDirectoryRuntime
): Result.Result<DeletedLabel, MailboxDomainError> =>
  storage.transactionSync(() => {
    const row = oneOrNotFound(
      storage.sql
        .exec(
          "SELECT * FROM label WHERE id = ? AND deleted_at IS NULL",
          input.labelId
        )
        .toArray()
    );
    if (row === undefined) {
      return Result.fail(
        mailboxDomainError("delete-label", "not-found", "Label was not found", {
          resourceType: "label",
          resourceId: input.labelId,
        })
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
    storage.sql.exec(
      `UPDATE label
          SET deleted_at = ?, updated_at = ?, version = version + 1
        WHERE id = ? AND version = ? AND deleted_at IS NULL`,
      deletedAt,
      deletedAt,
      input.labelId,
      input.expectedVersion
    );
    return Result.succeed(
      Schema.decodeUnknownSync(DeletedLabel)({
        id: input.labelId,
        deletedAt,
        version: input.expectedVersion + 1,
      })
    );
  });
