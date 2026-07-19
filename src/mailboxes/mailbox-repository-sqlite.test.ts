import { DatabaseSync } from "node:sqlite";

import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  CreateFolderInput,
  CreateLabelInput,
  DeleteFolderInput,
  DeleteLabelInput,
  RenameFolderInput,
  RenameLabelInput,
} from "./directory-contract";
import type { MailboxDomainError } from "./errors/mailbox-domain-error";
import { MailboxId } from "./identifiers";
import {
  createFolder,
  createLabel,
  deleteFolder,
  deleteLabel,
  initializeMailboxDirectory,
  listFolders,
  listLabels,
  renameFolder,
  renameLabel,
} from "./mailbox-directory-sqlite";
import { applyMailboxMigrations } from "./mailbox-migrations";
import { MailboxResourceLookup } from "./mailbox-repository";
import {
  initializeMailboxRepository,
  resolveMailboxResource,
} from "./mailbox-repository-sqlite";

const makeStorage = (database: DatabaseSync) => ({
  transactionSync: <A>(run: () => A) => {
    database.exec("BEGIN");
    try {
      const result = run();
      database.exec("COMMIT");
      return result;
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  },
  sql: {
    exec: (query: string, ...bindings: (string | number | null)[]) => {
      const statement = database.prepare(query);
      const rows = /^\s*(?:SELECT|WITH|PRAGMA)/iu.test(query)
        ? statement.all(...bindings)
        : (statement.run(...bindings), []);

      return {
        one: () => {
          if (rows.length !== 1) {
            throw new Error(`Expected one row, received ${rows.length}`);
          }
          return rows[0];
        },
        toArray: () => rows,
      };
    },
  },
});

const lookup = (input: unknown) =>
  Schema.decodeUnknownSync(MailboxResourceLookup)(input);

const initializationRuntime = {
  now: () => 1000,
  randomId: () => "unused",
};

const resultSuccess = <A, E>(result: Result.Result<A, E>) => {
  if (Result.isFailure(result)) {
    throw result.failure;
  }
  return result.success;
};

const domainReason = (result: Result.Result<unknown, MailboxDomainError>) => {
  if (Result.isSuccess(result)) {
    throw new Error("Expected a failed Result");
  }
  return result.failure.reason;
};

describe("MailboxDO SQLite repository", () => {
  it("resolves canonical ancestry for every supported resource", () => {
    const database = new DatabaseSync(":memory:");
    const storage = makeStorage(database);
    const mailboxId = Schema.decodeUnknownSync(MailboxId)("mailbox-a");

    try {
      database.exec("PRAGMA foreign_keys = ON");
      applyMailboxMigrations(storage);
      initializeMailboxRepository(storage, mailboxId);
      initializeMailboxDirectory(storage, initializationRuntime);
      database.exec(`
        INSERT INTO message (id, folder_id) VALUES ('message-1', 'inbox');
        INSERT INTO attachment (id, message_id) VALUES ('attachment-1', 'message-1');
        INSERT INTO draft (id) VALUES ('draft-1');
        INSERT INTO filter_rule (id) VALUES ('rule-1');
      `);

      expect(
        resolveMailboxResource(
          storage.sql,
          lookup({ _tag: "Folder", mailboxId, folderId: "inbox" })
        )
      ).toStrictEqual({
        _tag: "Folder",
        mailboxId: "mailbox-a",
        folderId: "inbox",
      });
      expect(
        resolveMailboxResource(
          storage.sql,
          lookup({ _tag: "Message", mailboxId, messageId: "message-1" })
        )
      ).toStrictEqual({
        _tag: "Message",
        mailboxId: "mailbox-a",
        folderId: "inbox",
        messageId: "message-1",
      });
      expect(
        resolveMailboxResource(
          storage.sql,
          lookup({
            _tag: "Attachment",
            mailboxId,
            attachmentId: "attachment-1",
          })
        )
      ).toStrictEqual({
        _tag: "Attachment",
        mailboxId: "mailbox-a",
        folderId: "inbox",
        messageId: "message-1",
        attachmentId: "attachment-1",
      });
      expect(
        resolveMailboxResource(
          storage.sql,
          lookup({ _tag: "Draft", mailboxId, draftId: "draft-1" })
        )
      ).toStrictEqual({
        _tag: "Draft",
        mailboxId: "mailbox-a",
        draftId: "draft-1",
      });
      expect(
        resolveMailboxResource(
          storage.sql,
          lookup({ _tag: "Rule", mailboxId, ruleId: "rule-1" })
        )
      ).toStrictEqual({
        _tag: "Rule",
        mailboxId: "mailbox-a",
        ruleId: "rule-1",
      });
    } finally {
      database.close();
    }
  });

  it("fails closed for missing and soft-deleted ancestry", () => {
    const database = new DatabaseSync(":memory:");
    const storage = makeStorage(database);
    const mailboxId = Schema.decodeUnknownSync(MailboxId)("mailbox-a");

    try {
      applyMailboxMigrations(storage);
      initializeMailboxRepository(storage, mailboxId);
      initializeMailboxDirectory(storage, initializationRuntime);
      database.exec(`
        INSERT INTO message (id, folder_id) VALUES ('message-1', 'inbox');
        UPDATE folder SET deleted_at = 1 WHERE id = 'inbox';
      `);

      expect(
        resolveMailboxResource(
          storage.sql,
          lookup({ _tag: "Message", mailboxId, messageId: "message-1" })
        )
      ).toStrictEqual({ _tag: "NotFound" });
      expect(
        resolveMailboxResource(
          storage.sql,
          lookup({ _tag: "Draft", mailboxId, draftId: "missing" })
        )
      ).toStrictEqual({ _tag: "NotFound" });
    } finally {
      database.close();
    }
  });

  it("rejects identity mismatches and dangling ancestry", () => {
    const database = new DatabaseSync(":memory:");
    const storage = makeStorage(database);

    try {
      database.exec("PRAGMA foreign_keys = ON");
      applyMailboxMigrations(storage);
      initializeMailboxRepository(
        storage,
        Schema.decodeUnknownSync(MailboxId)("mailbox-a")
      );
      initializeMailboxDirectory(storage, initializationRuntime);

      expect(() =>
        initializeMailboxRepository(
          storage,
          Schema.decodeUnknownSync(MailboxId)("mailbox-b")
        )
      ).toThrow("identity does not match");
      expect(() =>
        database
          .prepare(
            "INSERT INTO message (id, folder_id) VALUES ('message-1', 'missing')"
          )
          .run()
      ).toThrow("FOREIGN KEY constraint failed");
    } finally {
      database.close();
    }
  });

  it("seeds the stable system folders exactly once", () => {
    const database = new DatabaseSync(":memory:");
    const storage = makeStorage(database);
    const mailboxId = Schema.decodeUnknownSync(MailboxId)("mailbox-a");

    try {
      applyMailboxMigrations(storage);
      initializeMailboxRepository(storage, mailboxId);
      initializeMailboxDirectory(storage, {
        now: () => 100,
        randomId: () => "unused",
      });
      initializeMailboxRepository(storage, mailboxId);
      initializeMailboxDirectory(storage, {
        now: () => 200,
        randomId: () => "unused",
      });

      expect(
        database
          .prepare(
            "SELECT id, name, kind, created_at, updated_at FROM folder ORDER BY rowid"
          )
          .all()
          .map((row) => ({ ...row }))
      ).toStrictEqual([
        {
          id: "inbox",
          name: "Inbox",
          kind: "inbox",
          created_at: 100,
          updated_at: 100,
        },
        {
          id: "sent",
          name: "Sent",
          kind: "sent",
          created_at: 100,
          updated_at: 100,
        },
        {
          id: "drafts",
          name: "Drafts",
          kind: "drafts",
          created_at: 100,
          updated_at: 100,
        },
        {
          id: "scheduled",
          name: "Scheduled",
          kind: "scheduled",
          created_at: 100,
          updated_at: 100,
        },
        {
          id: "archive",
          name: "Archive",
          kind: "archive",
          created_at: 100,
          updated_at: 100,
        },
        {
          id: "spam",
          name: "Spam",
          kind: "spam",
          created_at: 100,
          updated_at: 100,
        },
        {
          id: "trash",
          name: "Trash",
          kind: "trash",
          created_at: 100,
          updated_at: 100,
        },
      ]);
    } finally {
      database.close();
    }
  });

  it("lists, creates, renames, and soft-deletes folders with active message counts", () => {
    const database = new DatabaseSync(":memory:");
    const storage = makeStorage(database);
    const mailboxId = Schema.decodeUnknownSync(MailboxId)("mailbox-a");
    const runtime = { now: () => 1000, randomId: () => "folder-projects" };

    try {
      applyMailboxMigrations(storage);
      initializeMailboxRepository(storage, mailboxId);
      initializeMailboxDirectory(storage, runtime);
      const created = resultSuccess(
        createFolder(
          storage,
          mailboxId,
          Schema.decodeUnknownSync(CreateFolderInput)({
            mailboxId,
            operationId: "folder-op",
            name: " Projects ",
          }),
          runtime
        )
      );
      database.exec(`
        INSERT INTO message (id, folder_id, read) VALUES
          ('unread', 'folder-projects', 0),
          ('read', 'folder-projects', 1),
          ('deleted', 'folder-projects', 0);
        UPDATE message SET deleted_at = 1001 WHERE id = 'deleted';
      `);

      expect(created).toMatchObject({
        id: "folder-projects",
        mailboxId: "mailbox-a",
        name: "Projects",
        kind: "custom",
        version: 1,
      });
      expect(
        listFolders(storage.sql, mailboxId).items.find(
          (folder) => folder.id === "folder-projects"
        )
      ).toMatchObject({ messageCount: 2, unreadCount: 1 });

      const renamed = resultSuccess(
        renameFolder(
          storage,
          mailboxId,
          Schema.decodeUnknownSync(RenameFolderInput)({
            mailboxId,
            folderId: "folder-projects",
            expectedVersion: 1,
            name: "Work",
          }),
          { ...runtime, now: () => 2000 }
        )
      );
      expect(renamed).toMatchObject({
        name: "Work",
        updatedAt: 2000,
        version: 2,
      });
      expect([
        domainReason(
          renameFolder(
            storage,
            mailboxId,
            Schema.decodeUnknownSync(RenameFolderInput)({
              mailboxId,
              folderId: "folder-projects",
              expectedVersion: 1,
              name: "Stale",
            }),
            runtime
          )
        ),
        domainReason(
          deleteFolder(
            storage,
            mailboxId,
            Schema.decodeUnknownSync(DeleteFolderInput)({
              mailboxId,
              folderId: "folder-projects",
              expectedVersion: 2,
            }),
            runtime
          )
        ),
      ]).toStrictEqual(["version-conflict", "folder-not-empty"]);

      database.exec(
        "UPDATE message SET deleted_at = 2001 WHERE folder_id = 'folder-projects'"
      );
      const deleted = resultSuccess(
        deleteFolder(
          storage,
          mailboxId,
          Schema.decodeUnknownSync(DeleteFolderInput)({
            mailboxId,
            folderId: "folder-projects",
            expectedVersion: 2,
          }),
          { ...runtime, now: () => 3000 }
        )
      );
      expect({
        deleted,
        folderCount: listFolders(storage.sql, mailboxId).items.length,
        missingReason: domainReason(
          deleteFolder(
            storage,
            mailboxId,
            Schema.decodeUnknownSync(DeleteFolderInput)({
              mailboxId,
              folderId: "folder-projects",
              expectedVersion: 3,
            }),
            runtime
          )
        ),
      }).toMatchObject({
        deleted: {
          id: "folder-projects",
          deletedAt: 3000,
          version: 3,
        },
        folderCount: 7,
        missingReason: "not-found",
      });
    } finally {
      database.close();
    }
  });

  it("blocks deletion of system folders", () => {
    const database = new DatabaseSync(":memory:");
    const storage = makeStorage(database);
    const mailboxId = Schema.decodeUnknownSync(MailboxId)("mailbox-a");

    try {
      applyMailboxMigrations(storage);
      initializeMailboxRepository(storage, mailboxId);
      initializeMailboxDirectory(storage, initializationRuntime);
      expect(
        domainReason(
          deleteFolder(
            storage,
            mailboxId,
            Schema.decodeUnknownSync(DeleteFolderInput)({
              mailboxId,
              folderId: "inbox",
              expectedVersion: 1,
            }),
            initializationRuntime
          )
        )
      ).toBe("system-folder");
    } finally {
      database.close();
    }
  });

  it("lists, creates, renames, and soft-deletes labels with CAS", () => {
    const database = new DatabaseSync(":memory:");
    const storage = makeStorage(database);
    const mailboxId = Schema.decodeUnknownSync(MailboxId)("mailbox-a");
    const runtime = { now: () => 1000, randomId: () => "label-important" };

    try {
      applyMailboxMigrations(storage);
      initializeMailboxRepository(storage, mailboxId);
      initializeMailboxDirectory(storage, runtime);
      const created = resultSuccess(
        createLabel(
          storage,
          mailboxId,
          Schema.decodeUnknownSync(CreateLabelInput)({
            mailboxId,
            operationId: "label-op",
            name: " Important ",
          }),
          runtime
        )
      );
      const replay = resultSuccess(
        createLabel(
          storage,
          mailboxId,
          Schema.decodeUnknownSync(CreateLabelInput)({
            mailboxId,
            operationId: "label-op",
            name: "Important",
          }),
          runtime
        )
      );
      expect({
        created,
        replay,
        listed: listLabels(storage.sql, mailboxId).items,
      }).toMatchObject({
        created: {
          id: "label-important",
          name: "Important",
          version: 1,
        },
        replay: created,
        listed: [created],
      });

      const renamed = resultSuccess(
        renameLabel(
          storage,
          mailboxId,
          Schema.decodeUnknownSync(RenameLabelInput)({
            mailboxId,
            labelId: "label-important",
            expectedVersion: 1,
            name: "Priority",
          }),
          { ...runtime, now: () => 500 }
        )
      );
      expect(renamed).toMatchObject({
        name: "Priority",
        updatedAt: 1000,
        version: 2,
      });
      expect(
        domainReason(
          deleteLabel(
            storage,
            mailboxId,
            Schema.decodeUnknownSync(DeleteLabelInput)({
              mailboxId,
              labelId: "label-important",
              expectedVersion: 1,
            }),
            runtime
          )
        )
      ).toBe("version-conflict");
      const deleted = resultSuccess(
        deleteLabel(
          storage,
          mailboxId,
          Schema.decodeUnknownSync(DeleteLabelInput)({
            mailboxId,
            labelId: "label-important",
            expectedVersion: 2,
          }),
          { ...runtime, now: () => 500 }
        )
      );
      expect({
        deleted,
        remaining: listLabels(storage.sql, mailboxId).items,
      }).toMatchObject({
        deleted: { deletedAt: 1000, version: 3 },
        remaining: [],
      });
    } finally {
      database.close();
    }
  });

  it("replays creates and rejects operation ID reuse with another request or kind", () => {
    const database = new DatabaseSync(":memory:");
    const storage = makeStorage(database);
    const mailboxId = Schema.decodeUnknownSync(MailboxId)("mailbox-a");
    let generated = 0;
    const runtime = {
      now: () => 1000,
      randomId: () => {
        generated += 1;
        return `generated-${generated}`;
      },
    };

    try {
      applyMailboxMigrations(storage);
      initializeMailboxRepository(storage, mailboxId);
      initializeMailboxDirectory(storage, runtime);
      const request = Schema.decodeUnknownSync(CreateFolderInput)({
        mailboxId,
        operationId: "shared-op",
        name: " Projects ",
      });
      const first = resultSuccess(
        createFolder(storage, mailboxId, request, runtime)
      );
      resultSuccess(
        renameFolder(
          storage,
          mailboxId,
          Schema.decodeUnknownSync(RenameFolderInput)({
            mailboxId,
            folderId: first.id,
            expectedVersion: 1,
            name: "Renamed",
          }),
          runtime
        )
      );
      const replay = resultSuccess(
        createFolder(
          storage,
          mailboxId,
          Schema.decodeUnknownSync(CreateFolderInput)({
            mailboxId,
            operationId: "shared-op",
            name: "Projects",
          }),
          runtime
        )
      );

      expect(replay).toStrictEqual(first);
      expect(generated).toBe(1);
      expect(
        domainReason(
          createFolder(
            storage,
            mailboxId,
            Schema.decodeUnknownSync(CreateFolderInput)({
              mailboxId,
              operationId: "shared-op",
              name: "Different",
            }),
            runtime
          )
        )
      ).toBe("idempotency-conflict");
      expect(
        domainReason(
          createLabel(
            storage,
            mailboxId,
            Schema.decodeUnknownSync(CreateLabelInput)({
              mailboxId,
              operationId: "shared-op",
              name: "Projects",
            }),
            runtime
          )
        )
      ).toBe("idempotency-conflict");
    } finally {
      database.close();
    }
  });

  it("rolls back resource creation when the idempotency record cannot be stored", () => {
    const database = new DatabaseSync(":memory:");
    const storage = makeStorage(database);
    const mailboxId = Schema.decodeUnknownSync(MailboxId)("mailbox-a");
    const runtime = { now: () => 1000, randomId: () => "rolled-back" };

    try {
      applyMailboxMigrations(storage);
      initializeMailboxRepository(storage, mailboxId);
      initializeMailboxDirectory(storage, runtime);
      database.exec(`CREATE TRIGGER reject_mailbox_operation
        BEFORE INSERT ON mailbox_operation
        BEGIN
          SELECT RAISE(ABORT, 'operation ledger unavailable');
        END`);

      expect(() =>
        createFolder(
          storage,
          mailboxId,
          Schema.decodeUnknownSync(CreateFolderInput)({
            mailboxId,
            operationId: "failed-op",
            name: "Must Roll Back",
          }),
          runtime
        )
      ).toThrow("operation ledger unavailable");
      expect(
        database
          .prepare(
            "SELECT COUNT(*) AS count FROM folder WHERE id = 'rolled-back'"
          )
          .get()
      ).toMatchObject({ count: 0 });
      expect(
        database
          .prepare(
            "SELECT COUNT(*) AS count FROM mailbox_operation WHERE operation_id = 'failed-op'"
          )
          .get()
      ).toMatchObject({ count: 0 });
    } finally {
      database.close();
    }
  });
});
