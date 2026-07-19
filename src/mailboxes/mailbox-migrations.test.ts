import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import {
  applyMailboxMigrations,
  mailboxSchemaVersion,
} from "./mailbox-migrations";

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
      ]);
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
      }).toStrictEqual({ count: 2 });
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

      expect(applyMailboxMigrations(storage)).toBe(2);
      expect(
        database
          .prepare(
            `SELECT name FROM sqlite_schema
              WHERE type = 'table'
                AND name IN ('mailbox_metadata', 'folder', 'message', 'attachment', 'draft', 'filter_rule')
              ORDER BY name`
          )
          .all()
          .map((row) => row.name)
      ).toStrictEqual([
        "attachment",
        "draft",
        "filter_rule",
        "folder",
        "mailbox_metadata",
        "message",
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
      database
        .prepare("INSERT INTO mailbox_schema_migration (version) VALUES (3)")
        .run();

      expect(() => applyMailboxMigrations(storage)).toThrow(
        "unknown migration version 3"
      );
    } finally {
      database.close();
    }
  });
});
