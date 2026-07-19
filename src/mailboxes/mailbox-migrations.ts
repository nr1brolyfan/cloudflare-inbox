type MigrationBinding = string | number | null;

interface MigrationCursor {
  readonly one: () => Readonly<Record<string, unknown>>;
  readonly toArray: () => readonly Readonly<Record<string, unknown>>[];
}

interface MailboxMigrationStorage {
  readonly sql: {
    readonly exec: (
      query: string,
      ...bindings: MigrationBinding[]
    ) => MigrationCursor;
  };
  readonly transactionSync: <A>(run: () => A) => A;
}

interface MailboxMigration {
  readonly version: number;
  readonly statements: readonly string[];
}

const migrations = [
  {
    version: 1,
    statements: [
      `CREATE TABLE IF NOT EXISTS mailbox_schema_migration (
        version INTEGER PRIMARY KEY NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      ) STRICT`,
    ],
  },
  {
    version: 2,
    statements: [
      `CREATE TABLE mailbox_metadata (
        singleton INTEGER PRIMARY KEY NOT NULL CHECK (singleton = 1),
        mailbox_id TEXT NOT NULL UNIQUE CHECK (
          length(mailbox_id) BETWEEN 1 AND 128 AND mailbox_id = trim(mailbox_id)
        )
      ) STRICT`,
      `CREATE TABLE folder (
        id TEXT PRIMARY KEY NOT NULL CHECK (
          length(id) BETWEEN 1 AND 128 AND id = trim(id)
        ),
        version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
        deleted_at INTEGER CHECK (deleted_at IS NULL OR deleted_at >= 0)
      ) STRICT`,
      `CREATE TABLE message (
        id TEXT PRIMARY KEY NOT NULL CHECK (
          length(id) BETWEEN 1 AND 128 AND id = trim(id)
        ),
        folder_id TEXT NOT NULL REFERENCES folder(id) ON UPDATE CASCADE ON DELETE RESTRICT,
        version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
        deleted_at INTEGER CHECK (deleted_at IS NULL OR deleted_at >= 0)
      ) STRICT`,
      `CREATE INDEX message_folder_id_idx ON message(folder_id, id)`,
      `CREATE TABLE attachment (
        id TEXT PRIMARY KEY NOT NULL CHECK (
          length(id) BETWEEN 1 AND 128 AND id = trim(id)
        ),
        message_id TEXT NOT NULL REFERENCES message(id) ON UPDATE CASCADE ON DELETE RESTRICT,
        version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
        deleted_at INTEGER CHECK (deleted_at IS NULL OR deleted_at >= 0)
      ) STRICT`,
      `CREATE INDEX attachment_message_id_idx ON attachment(message_id, id)`,
      `CREATE TABLE draft (
        id TEXT PRIMARY KEY NOT NULL CHECK (
          length(id) BETWEEN 1 AND 128 AND id = trim(id)
        ),
        version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
        deleted_at INTEGER CHECK (deleted_at IS NULL OR deleted_at >= 0)
      ) STRICT`,
      `CREATE TABLE filter_rule (
        id TEXT PRIMARY KEY NOT NULL CHECK (
          length(id) BETWEEN 1 AND 128 AND id = trim(id)
        ),
        version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
        deleted_at INTEGER CHECK (deleted_at IS NULL OR deleted_at >= 0)
      ) STRICT`,
    ],
  },
  {
    version: 3,
    statements: [
      `ALTER TABLE folder ADD COLUMN name TEXT NOT NULL DEFAULT 'Migrated folder' CHECK (
        length(name) BETWEEN 1 AND 200 AND name = trim(name)
      )`,
      `ALTER TABLE folder ADD COLUMN kind TEXT NOT NULL DEFAULT 'custom' CHECK (
        kind IN ('inbox', 'sent', 'drafts', 'scheduled', 'archive', 'spam', 'trash', 'custom')
      )`,
      `ALTER TABLE folder ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0 CHECK (created_at >= 0)`,
      `ALTER TABLE folder ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0 CHECK (
        updated_at >= created_at
      )`,
      `ALTER TABLE message ADD COLUMN read INTEGER NOT NULL DEFAULT 0 CHECK (read IN (0, 1))`,
      `CREATE TABLE label (
        id TEXT PRIMARY KEY NOT NULL CHECK (
          length(id) BETWEEN 1 AND 128 AND id = trim(id)
        ),
        name TEXT NOT NULL CHECK (
          length(name) BETWEEN 1 AND 200 AND name = trim(name)
        ),
        created_at INTEGER NOT NULL CHECK (created_at >= 0),
        updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
        version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
        deleted_at INTEGER CHECK (deleted_at IS NULL OR deleted_at >= 0)
      ) STRICT`,
      `CREATE TABLE mailbox_operation (
        operation_id TEXT PRIMARY KEY NOT NULL CHECK (
          length(operation_id) BETWEEN 1 AND 128 AND operation_id = trim(operation_id)
        ),
        operation_kind TEXT NOT NULL CHECK (length(operation_kind) BETWEEN 1 AND 128),
        request_key TEXT NOT NULL,
        resource_id TEXT NOT NULL CHECK (
          length(resource_id) BETWEEN 1 AND 128 AND resource_id = trim(resource_id)
        ),
        result_payload TEXT NOT NULL,
        created_at INTEGER NOT NULL CHECK (created_at >= 0)
      ) STRICT`,
      `CREATE INDEX folder_active_list_idx
        ON folder(kind, name COLLATE NOCASE, id) WHERE deleted_at IS NULL`,
      `CREATE INDEX folder_active_name_idx
        ON folder(name COLLATE NOCASE, id) WHERE deleted_at IS NULL`,
      `CREATE INDEX label_active_name_idx
        ON label(name COLLATE NOCASE, id) WHERE deleted_at IS NULL`,
      `CREATE INDEX message_folder_active_read_idx
        ON message(folder_id, read, id) WHERE deleted_at IS NULL`,
    ],
  },
] as const satisfies readonly MailboxMigration[];

export const mailboxSchemaVersion = migrations.length;

const pendingMigrations = (appliedVersions: readonly number[]) => {
  for (const [index, migration] of migrations.entries()) {
    if (migration.version !== index + 1) {
      throw new Error("Mailbox migrations must use contiguous versions");
    }
  }

  for (const [index, version] of appliedVersions.entries()) {
    if (migrations[index]?.version !== version) {
      throw new Error(
        `Mailbox database has unknown migration version ${version}`
      );
    }
  }

  return migrations.slice(appliedVersions.length);
};

/** Applies every pending mailbox schema version in one synchronous SQLite transaction. */
export const applyMailboxMigrations = (storage: MailboxMigrationStorage) =>
  storage.transactionSync(() => {
    const tableRow = storage.sql
      .exec(
        `SELECT EXISTS (
          SELECT 1 FROM sqlite_schema
          WHERE type = 'table' AND name = 'mailbox_schema_migration'
        ) AS present`
      )
      .one();

    if (tableRow.present !== 0 && tableRow.present !== 1) {
      throw new Error("Could not determine the mailbox migration state");
    }

    const appliedVersions =
      tableRow.present === 1
        ? storage.sql
            .exec(
              "SELECT version FROM mailbox_schema_migration ORDER BY version"
            )
            .toArray()
            .map((row) => {
              if (
                typeof row.version !== "number" ||
                !Number.isSafeInteger(row.version) ||
                row.version < 1
              ) {
                throw new Error(
                  "Mailbox database has an invalid migration version"
                );
              }

              return row.version;
            })
        : [];

    for (const migration of pendingMigrations(appliedVersions)) {
      for (const statement of migration.statements) {
        storage.sql.exec(statement);
      }
      storage.sql.exec(
        "INSERT INTO mailbox_schema_migration (version) VALUES (?)",
        migration.version
      );
    }

    return mailboxSchemaVersion;
  });
