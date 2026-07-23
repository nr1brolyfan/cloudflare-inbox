import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import {
  applyMailboxMigrations,
  mailboxSchemaVersion,
} from "#/modules/mailbox/adapters/sqlite/MailboxSqliteMigrations";

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
        { version: 5, applied_at: expect.any(String) },
        { version: 6, applied_at: expect.any(String) },
        { version: 7, applied_at: expect.any(String) },
        { version: 8, applied_at: expect.any(String) },
        { version: 9, applied_at: expect.any(String) },
        { version: 10, applied_at: expect.any(String) },
        { version: 11, applied_at: expect.any(String) },
        { version: 12, applied_at: expect.any(String) },
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
              WHERE type = 'table' AND name IN ('inbound_processing', 'label', 'mailbox_operation', 'rule_application', 'rule_evaluation')
              ORDER BY name`
          )
          .all()
          .map((row) => row.name)
      ).toStrictEqual([
        "inbound_processing",
        "label",
        "mailbox_operation",
        "rule_application",
        "rule_evaluation",
      ]);
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

  it("adds immutable draft attachment locators to message snapshots", () => {
    const database = new DatabaseSync(":memory:");

    try {
      applyMailboxMigrations(makeStorage(database));
      expect(
        database
          .prepare("PRAGMA table_info(attachment)")
          .all()
          .map((row) => row.name)
      ).toStrictEqual(
        expect.arrayContaining(["content_sha256", "draft_attachment_id"])
      );
      expect(
        database
          .prepare("PRAGMA index_list(attachment)")
          .all()
          .map((row) => row.name)
      ).toContain("attachment_draft_attachment_id_idx");
    } finally {
      database.close();
    }
  });

  it("persists validated outbound provider message identifiers", () => {
    const database = new DatabaseSync(":memory:");

    try {
      applyMailboxMigrations(makeStorage(database));
      expect(
        database
          .prepare("PRAGMA table_info(outbound_delivery)")
          .all()
          .map((row) => row.name)
      ).toContain("provider_message_id");
      database.exec(`
        INSERT INTO folder (id, name, kind, created_at, updated_at)
          VALUES ('sent', 'Sent', 'sent', 0, 0);
        INSERT INTO message (id, folder_id) VALUES ('message-1', 'sent');
        INSERT INTO outbound_delivery
          (id, message_id, status, send_at, created_at, updated_at, provider_message_id)
          VALUES ('delivery-1', 'message-1', 'accepted', 0, 0, 0, 'provider-1');
      `);
      expect(() =>
        database
          .prepare(
            "UPDATE outbound_delivery SET provider_message_id = '' WHERE id = 'delivery-1'"
          )
          .run()
      ).toThrow("CHECK constraint failed");
    } finally {
      database.close();
    }
  });

  it("indexes active drafts for descending keyset listing", () => {
    const database = new DatabaseSync(":memory:");

    try {
      applyMailboxMigrations(makeStorage(database));
      expect(
        database
          .prepare("PRAGMA index_list(draft)")
          .all()
          .map((row) => row.name)
      ).toContain("draft_active_updated_idx");
      expect(
        database
          .prepare(
            "SELECT sql FROM sqlite_schema WHERE type = 'index' AND name = 'draft_active_updated_idx'"
          )
          .get()?.sql
      ).toContain("WHERE deleted_at IS NULL");
    } finally {
      database.close();
    }
  });

  it("expands persisted rules for evaluation and history", () => {
    const database = new DatabaseSync(":memory:");

    try {
      applyMailboxMigrations(makeStorage(database));

      expect(
        database
          .prepare("PRAGMA table_info(filter_rule)")
          .all()
          .map((row) => row.name)
      ).toStrictEqual([
        "id",
        "version",
        "deleted_at",
        "name",
        "enabled",
        "priority",
        "conditions_json",
        "actions_json",
        "stop_processing",
        "created_at",
        "updated_at",
        "ai_instruction",
      ]);
      expect(
        database
          .prepare(
            "SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'async_rule_job'"
          )
          .all()
          .map((row) => row.name)
      ).toStrictEqual(["async_rule_job"]);
      expect(
        database
          .prepare("PRAGMA table_info(inbound_processing)")
          .all()
          .map((row) => row.name)
      ).toContain("async_rule_job_id");
    } finally {
      database.close();
    }
  });

  it("keeps the message FTS index current on insert, update, and soft delete", () => {
    const database = new DatabaseSync(":memory:");

    try {
      applyMailboxMigrations(makeStorage(database));
      const searchIds = (query: string) =>
        database
          .prepare(
            `SELECT id FROM message
            WHERE rowid IN (
              SELECT rowid FROM message_search WHERE message_search MATCH ?
            )`
          )
          .all(query)
          .map((row) => row.id);
      database
        .prepare(
          "INSERT INTO folder (id, name, kind, created_at, updated_at) VALUES ('inbox', 'Inbox', 'inbox', 0, 0)"
        )
        .run();
      database
        .prepare(
          "INSERT INTO message (id, folder_id, subject, snippet, text_body) VALUES ('message-search', 'inbox', 'Alpha', 'Alpha snippet', 'Alpha body')"
        )
        .run();
      expect(searchIds("Alpha")).toStrictEqual(["message-search"]);
      database
        .prepare(
          "UPDATE message SET subject = 'Beta', snippet = 'Beta snippet', text_body = 'Beta body' WHERE id = 'message-search'"
        )
        .run();
      expect(searchIds("Alpha")).toStrictEqual([]);
      database
        .prepare(
          "UPDATE message SET deleted_at = 1000 WHERE id = 'message-search'"
        )
        .run();
      expect(searchIds("Beta")).toStrictEqual([]);
    } finally {
      database.close();
    }
  });

  it("enforces inbound source pairs and creates lookup indexes", () => {
    const database = new DatabaseSync(":memory:");

    try {
      applyMailboxMigrations(makeStorage(database));
      database
        .prepare(
          "INSERT INTO folder (id, name, kind, created_at, updated_at) VALUES ('inbox', 'Inbox', 'inbox', 0, 0)"
        )
        .run();
      database
        .prepare(
          "INSERT INTO message (id, folder_id) VALUES ('message-1', 'inbox')"
        )
        .run();
      database
        .prepare(
          "INSERT INTO inbound_processing (id, status, message_id, request_key, attempt_count, created_at, updated_at, version) VALUES ('ingest-1', 'ready', 'message-1', '{}', 1, 0, 0, 1)"
        )
        .run();

      expect(() =>
        database
          .prepare(
            "INSERT INTO attachment (id, message_id, inbound_ingest_id) VALUES ('attachment-1', 'message-1', 'ingest-1')"
          )
          .run()
      ).toThrow("CHECK constraint failed");
      expect(() =>
        database
          .prepare(
            "INSERT INTO inbound_processing (id, status, request_key, failure_code, failure_at, attempt_count, created_at, updated_at, version) VALUES ('failed-1', 'failed', '{}', 'processing_failed', 0, 1, 0, 0, 1)"
          )
          .run()
      ).toThrow("CHECK constraint failed");
      expect(
        database
          .prepare(
            "SELECT name FROM sqlite_schema WHERE type = 'index' AND name IN ('attachment_inbound_source_uidx', 'message_rfc_message_id_idx') ORDER BY name"
          )
          .all()
          .map((row) => row.name)
      ).toStrictEqual([
        "attachment_inbound_source_uidx",
        "message_rfc_message_id_idx",
      ]);
    } finally {
      database.close();
    }
  });

  it("enforces idempotent rule history keys and payload constraints", () => {
    const database = new DatabaseSync(":memory:");

    try {
      applyMailboxMigrations(makeStorage(database));
      database.exec(`
        INSERT INTO folder (id, name, kind, created_at, updated_at)
          VALUES ('inbox', 'Inbox', 'inbox', 0, 0);
        INSERT INTO message (id, folder_id) VALUES ('message-1', 'inbox');
        INSERT INTO inbound_processing
          (id, status, message_id, request_key, attempt_count, created_at, updated_at, version)
          VALUES ('ingest-1', 'ready', 'message-1', '{}', 1, 0, 0, 1);
        INSERT INTO filter_rule (id) VALUES ('rule-1');
        INSERT INTO rule_evaluation
          (inbound_ingest_id, message_id, engine_version, evaluated_at)
          VALUES ('ingest-1', 'message-1', 1, 0);
        INSERT INTO rule_application
          (inbound_ingest_id, message_id, rule_id, rule_version, action_index, action_json, outcome, applied_at)
          VALUES ('ingest-1', 'message-1', 'rule-1', 1, 0, '{"_tag":"SetRead","read":true}', 'applied', 0);
      `);

      expect(() =>
        database
          .prepare(
            `INSERT INTO rule_application
              (inbound_ingest_id, message_id, rule_id, rule_version, action_index, action_json, outcome, applied_at)
              VALUES ('ingest-1', 'message-1', 'rule-1', 1, 0, '{"_tag":"SetRead","read":true}', 'applied', 0)`
          )
          .run()
      ).toThrow("UNIQUE constraint failed");
      expect(() =>
        database
          .prepare(
            `INSERT INTO rule_application
              (inbound_ingest_id, message_id, rule_id, rule_version, action_index, action_json, outcome, applied_at)
              VALUES ('ingest-1', 'message-1', 'rule-1', 1, 1, '[]', 'applied', 0)`
          )
          .run()
      ).toThrow("CHECK constraint failed");
      expect(() =>
        database
          .prepare("UPDATE filter_rule SET priority = -1 WHERE id = 'rule-1'")
          .run()
      ).toThrow("CHECK constraint failed");
      expect(() =>
        database
          .prepare(
            "UPDATE filter_rule SET stop_processing = 1, ai_instruction = 'Classify this message' WHERE id = 'rule-1'"
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
                AND name IN ('mailbox_metadata', 'folder', 'message', 'attachment', 'draft', 'draft_attachment', 'filter_rule', 'inbound_processing', 'label', 'mailbox_operation', 'message_label', 'message_search', 'outbound_delivery', 'rule_application', 'rule_evaluation')
              ORDER BY name`
          )
          .all()
          .map((row) => row.name)
      ).toStrictEqual([
        "attachment",
        "draft",
        "draft_attachment",
        "filter_rule",
        "folder",
        "inbound_processing",
        "label",
        "mailbox_metadata",
        "mailbox_operation",
        "message",
        "message_label",
        "message_search",
        "outbound_delivery",
        "rule_application",
        "rule_evaluation",
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
        INSERT INTO filter_rule (id, version) VALUES ('legacy-rule', 3);
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
      expect({
        ...database
          .prepare(
            "SELECT id, version, name, enabled, priority, stop_processing, created_at, updated_at FROM filter_rule WHERE id = 'legacy-rule'"
          )
          .get(),
      }).toStrictEqual({
        id: "legacy-rule",
        version: 3,
        name: "Migrated rule",
        enabled: 0,
        priority: 0,
        stop_processing: 0,
        created_at: 0,
        updated_at: 0,
      });
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
