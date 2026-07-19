import { DatabaseSync } from "node:sqlite";

import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import { MailboxId } from "./identifiers";
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

describe("MailboxDO SQLite repository", () => {
  it("resolves canonical ancestry for every supported resource", () => {
    const database = new DatabaseSync(":memory:");
    const storage = makeStorage(database);
    const mailboxId = Schema.decodeUnknownSync(MailboxId)("mailbox-a");

    try {
      database.exec("PRAGMA foreign_keys = ON");
      applyMailboxMigrations(storage);
      initializeMailboxRepository(storage, mailboxId);
      database.exec(`
        INSERT INTO folder (id) VALUES ('inbox');
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
      database.exec(`
        INSERT INTO folder (id) VALUES ('inbox');
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
});
