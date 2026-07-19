import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import {
  applyMailboxMigrations,
  mailboxSchemaVersion,
} from "./sqlite-migrations";

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

describe("MailboxDO migrations", () => {
  it("creates and records the current schema on a fresh database", () => {
    const database = new DatabaseSync(":memory:");

    try {
      expect(applyMailboxMigrations(makeStorage(database))).toBe(
        mailboxSchemaVersion
      );
      expect(
        database
          .prepare(
            "SELECT version, applied_at FROM mailbox_schema_migration ORDER BY version"
          )
          .all()
          .map((row) => ({ ...row }))
      ).toStrictEqual([
        { version: 1, applied_at: expect.any(String) },
        { version: 2, applied_at: expect.any(String) },
        { version: 3, applied_at: expect.any(String) },
        { version: 4, applied_at: expect.any(String) },
      ]);
      expect(
        database
          .prepare("PRAGMA table_info(folder)")
          .all()
          .map((row) => row.name)
      ).toStrictEqual([
        "id",
        "version",
        "deleted_at",
        "name",
        "kind",
        "created_at",
        "updated_at",
      ]);
      expect(
        database
          .prepare(
            `SELECT name FROM sqlite_schema
              WHERE type = 'table' AND name IN ('label', 'mailbox_operation')
              ORDER BY name`
          )
          .all()
          .map((row) => row.name)
      ).toStrictEqual(["label", "mailbox_operation"]);
      expect(() =>
        database
          .prepare(
            "INSERT INTO label (id, name, created_at, updated_at) VALUES ('bad', '', 0, 0)"
          )
          .run()
      ).toThrow("CHECK constraint failed");
    } finally {
      database.close();
    }
  });

  it("is idempotent when the database is already current", () => {
    const database = new DatabaseSync(":memory:");
    const storage = makeStorage(database);

    try {
      applyMailboxMigrations(storage);
      applyMailboxMigrations(storage);

      expect({
        ...database
          .prepare("SELECT COUNT(*) AS count FROM mailbox_schema_migration")
          .get(),
      }).toStrictEqual({ count: mailboxSchemaVersion });
    } finally {
      database.close();
    }
  });

  it("upgrades an existing version-one database", () => {
    const database = new DatabaseSync(":memory:");
    const storage = makeStorage(database);

    try {
      database.exec(`CREATE TABLE mailbox_schema_migration (
        version INTEGER PRIMARY KEY NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      ) STRICT`);
      database
        .prepare("INSERT INTO mailbox_schema_migration (version) VALUES (1)")
        .run();

      expect(applyMailboxMigrations(storage)).toBe(mailboxSchemaVersion);
      expect(
        database
          .prepare(
            `SELECT name FROM sqlite_schema
              WHERE type = 'table'
                AND name IN ('mailbox_metadata', 'folder', 'message', 'attachment', 'draft', 'filter_rule', 'label', 'mailbox_operation', 'message_label', 'outbound_delivery')
              ORDER BY name`
          )
          .all()
          .map((row) => row.name)
      ).toStrictEqual([
        "attachment",
        "draft",
        "filter_rule",
        "folder",
        "label",
        "mailbox_metadata",
        "mailbox_operation",
        "message",
        "message_label",
        "outbound_delivery",
      ]);
    } finally {
      database.close();
    }
  });

  it("rejects a database created by an unknown newer schema", () => {
    const database = new DatabaseSync(":memory:");
    const storage = makeStorage(database);

    try {
      applyMailboxMigrations(storage);
      const unknownVersion = mailboxSchemaVersion + 1;
      database
        .prepare("INSERT INTO mailbox_schema_migration (version) VALUES (?)")
        .run(unknownVersion);

      expect(() => applyMailboxMigrations(storage)).toThrow(
        `unknown migration version ${unknownVersion}`
      );
    } finally {
      database.close();
    }
  });

  it("upgrades populated version-two skeleton tables without rebuilding them", () => {
    const database = new DatabaseSync(":memory:");
    const storage = makeStorage(database);

    try {
      database.exec(`
        CREATE TABLE mailbox_schema_migration (
          version INTEGER PRIMARY KEY NOT NULL,
          applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        ) STRICT;
        INSERT INTO mailbox_schema_migration (version) VALUES (1), (2);
        CREATE TABLE mailbox_metadata (
          singleton INTEGER PRIMARY KEY NOT NULL CHECK (singleton = 1),
          mailbox_id TEXT NOT NULL UNIQUE
        ) STRICT;
        CREATE TABLE folder (
          id TEXT PRIMARY KEY NOT NULL,
          version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
          deleted_at INTEGER
        ) STRICT;
        CREATE TABLE message (
          id TEXT PRIMARY KEY NOT NULL,
          folder_id TEXT NOT NULL REFERENCES folder(id),
          version INTEGER NOT NULL DEFAULT 1,
          deleted_at INTEGER
        ) STRICT;
        CREATE INDEX message_folder_id_idx ON message(folder_id, id);
        CREATE TABLE attachment (
          id TEXT PRIMARY KEY NOT NULL,
          message_id TEXT NOT NULL REFERENCES message(id),
          version INTEGER NOT NULL DEFAULT 1,
          deleted_at INTEGER
        ) STRICT;
        CREATE INDEX attachment_message_id_idx ON attachment(message_id, id);
        CREATE TABLE draft (
          id TEXT PRIMARY KEY NOT NULL,
          version INTEGER NOT NULL DEFAULT 1,
          deleted_at INTEGER
        ) STRICT;
        CREATE TABLE filter_rule (
          id TEXT PRIMARY KEY NOT NULL,
          version INTEGER NOT NULL DEFAULT 1,
          deleted_at INTEGER
        ) STRICT;
        INSERT INTO folder (id) VALUES ('legacy');
        INSERT INTO message (id, folder_id) VALUES ('message-1', 'legacy');
      `);

      expect(applyMailboxMigrations(storage)).toBe(mailboxSchemaVersion);
      expect({
        ...database
          .prepare(
            "SELECT name, kind, created_at, updated_at FROM folder WHERE id = 'legacy'"
          )
          .get(),
      }).toStrictEqual({
        name: "Migrated folder",
        kind: "custom",
        created_at: 0,
        updated_at: 0,
      });
      expect({
        ...database
          .prepare("SELECT read FROM message WHERE id = 'message-1'")
          .get(),
      }).toStrictEqual({ read: 0 });
    } finally {
      database.close();
    }
  });

  it("upgrades populated version-three directory storage to mail data", () => {
    const database = new DatabaseSync(":memory:");
    const storage = makeStorage(database);

    try {
      database.exec(`
        CREATE TABLE mailbox_schema_migration (
          version INTEGER PRIMARY KEY NOT NULL,
          applied_at TEXT NOT NULL DEFAULT ''
        ) STRICT;
        INSERT INTO mailbox_schema_migration (version) VALUES (1), (2), (3);
        CREATE TABLE mailbox_metadata (singleton INTEGER PRIMARY KEY, mailbox_id TEXT NOT NULL) STRICT;
        CREATE TABLE folder (
          id TEXT PRIMARY KEY, version INTEGER NOT NULL DEFAULT 1, deleted_at INTEGER,
          name TEXT NOT NULL, kind TEXT NOT NULL, created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        ) STRICT;
        CREATE TABLE message (
          id TEXT PRIMARY KEY, folder_id TEXT NOT NULL REFERENCES folder(id),
          version INTEGER NOT NULL DEFAULT 1, deleted_at INTEGER,
          read INTEGER NOT NULL DEFAULT 0
        ) STRICT;
        CREATE TABLE attachment (
          id TEXT PRIMARY KEY, message_id TEXT NOT NULL REFERENCES message(id),
          version INTEGER NOT NULL DEFAULT 1, deleted_at INTEGER
        ) STRICT;
        CREATE TABLE draft (
          id TEXT PRIMARY KEY, version INTEGER NOT NULL DEFAULT 1, deleted_at INTEGER
        ) STRICT;
        CREATE TABLE filter_rule (
          id TEXT PRIMARY KEY, version INTEGER NOT NULL DEFAULT 1, deleted_at INTEGER
        ) STRICT;
        CREATE TABLE label (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL, version INTEGER NOT NULL DEFAULT 1,
          deleted_at INTEGER
        ) STRICT;
        CREATE TABLE mailbox_operation (
          operation_id TEXT PRIMARY KEY, operation_kind TEXT NOT NULL,
          request_key TEXT NOT NULL, resource_id TEXT NOT NULL,
          result_payload TEXT NOT NULL, created_at INTEGER NOT NULL
        ) STRICT;
        INSERT INTO folder
          (id, name, kind, created_at, updated_at) VALUES ('inbox', 'Inbox', 'inbox', 0, 0);
        INSERT INTO message (id, folder_id) VALUES ('legacy-message', 'inbox');
        INSERT INTO draft (id) VALUES ('legacy-draft');
      `);

      expect(applyMailboxMigrations(storage)).toBe(mailboxSchemaVersion);
      expect({
        message: {
          ...database
            .prepare(
              "SELECT thread_id, direction, starred FROM message WHERE id = 'legacy-message'"
            )
            .get(),
        },
        draft: {
          ...database
            .prepare(
              "SELECT to_json, subject, created_at FROM draft WHERE id = 'legacy-draft'"
            )
            .get(),
        },
      }).toStrictEqual({
        message: { thread_id: "legacy", direction: "inbound", starred: 0 },
        draft: { to_json: "[]", subject: "", created_at: 0 },
      });
    } finally {
      database.close();
    }
  });
});
