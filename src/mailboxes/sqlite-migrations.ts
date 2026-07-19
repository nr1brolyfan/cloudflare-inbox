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
  {
    version: 4,
    statements: [
      `ALTER TABLE message ADD COLUMN thread_id TEXT NOT NULL DEFAULT 'legacy' CHECK (length(thread_id) BETWEEN 1 AND 128 AND thread_id = trim(thread_id))`,
      `ALTER TABLE message ADD COLUMN direction TEXT NOT NULL DEFAULT 'inbound' CHECK (direction IN ('inbound', 'outbound'))`,
      `ALTER TABLE message ADD COLUMN outbound_delivery_id TEXT`,
      `ALTER TABLE message ADD COLUMN subject TEXT NOT NULL DEFAULT '' CHECK (length(subject) <= 998)`,
      `ALTER TABLE message ADD COLUMN sender_json TEXT CHECK (sender_json IS NULL OR json_valid(sender_json))`,
      `ALTER TABLE message ADD COLUMN recipients_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(recipients_json))`,
      `ALTER TABLE message ADD COLUMN snippet TEXT NOT NULL DEFAULT '' CHECK (length(snippet) <= 500)`,
      `ALTER TABLE message ADD COLUMN activity_at INTEGER NOT NULL DEFAULT 0 CHECK (activity_at >= 0)`,
      `ALTER TABLE message ADD COLUMN starred INTEGER NOT NULL DEFAULT 0 CHECK (starred IN (0, 1))`,
      `ALTER TABLE message ADD COLUMN needs_reply INTEGER NOT NULL DEFAULT 0 CHECK (needs_reply IN (0, 1))`,
      `ALTER TABLE message ADD COLUMN size INTEGER NOT NULL DEFAULT 0 CHECK (size >= 0)`,
      `ALTER TABLE message ADD COLUMN rfc_message_id TEXT`,
      `ALTER TABLE message ADD COLUMN in_reply_to TEXT`,
      `ALTER TABLE message ADD COLUMN references_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(references_json))`,
      `ALTER TABLE message ADD COLUMN to_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(to_json))`,
      `ALTER TABLE message ADD COLUMN cc_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(cc_json))`,
      `ALTER TABLE message ADD COLUMN bcc_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(bcc_json))`,
      `ALTER TABLE message ADD COLUMN text_body TEXT`,
      `ALTER TABLE message ADD COLUMN html_body TEXT`,
      `ALTER TABLE message ADD COLUMN header_date INTEGER CHECK (header_date IS NULL OR header_date >= 0)`,
      `ALTER TABLE message ADD COLUMN received_at INTEGER CHECK (received_at IS NULL OR received_at >= 0)`,
      `ALTER TABLE message ADD COLUMN scheduled_at INTEGER CHECK (scheduled_at IS NULL OR scheduled_at >= 0)`,
      `ALTER TABLE message ADD COLUMN accepted_at INTEGER CHECK (accepted_at IS NULL OR accepted_at >= 0)`,
      `ALTER TABLE message ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0 CHECK (created_at >= 0)`,
      `ALTER TABLE message ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0 CHECK (updated_at >= created_at)`,
      `ALTER TABLE attachment ADD COLUMN file_name TEXT NOT NULL DEFAULT 'attachment' CHECK (length(file_name) BETWEEN 1 AND 255)`,
      `ALTER TABLE attachment ADD COLUMN mime_type TEXT NOT NULL DEFAULT 'application/octet-stream' CHECK (length(mime_type) BETWEEN 3 AND 255)`,
      `ALTER TABLE attachment ADD COLUMN size INTEGER NOT NULL DEFAULT 0 CHECK (size >= 0)`,
      `ALTER TABLE attachment ADD COLUMN content_id TEXT`,
      `ALTER TABLE attachment ADD COLUMN disposition TEXT NOT NULL DEFAULT 'attachment' CHECK (disposition IN ('attachment', 'inline'))`,
      `ALTER TABLE draft ADD COLUMN thread_id TEXT`,
      `ALTER TABLE draft ADD COLUMN in_reply_to_message_id TEXT`,
      `ALTER TABLE draft ADD COLUMN to_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(to_json))`,
      `ALTER TABLE draft ADD COLUMN cc_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(cc_json))`,
      `ALTER TABLE draft ADD COLUMN bcc_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(bcc_json))`,
      `ALTER TABLE draft ADD COLUMN subject TEXT NOT NULL DEFAULT '' CHECK (length(subject) <= 998)`,
      `ALTER TABLE draft ADD COLUMN text_body TEXT`,
      `ALTER TABLE draft ADD COLUMN html_body TEXT`,
      `ALTER TABLE draft ADD COLUMN attachment_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(attachment_ids_json))`,
      `ALTER TABLE draft ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0 CHECK (created_at >= 0)`,
      `ALTER TABLE draft ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0 CHECK (updated_at >= created_at)`,
      `CREATE TABLE message_label (
        message_id TEXT NOT NULL REFERENCES message(id) ON UPDATE CASCADE ON DELETE CASCADE,
        label_id TEXT NOT NULL REFERENCES label(id) ON UPDATE CASCADE ON DELETE RESTRICT,
        PRIMARY KEY (message_id, label_id)
      ) WITHOUT ROWID, STRICT`,
      `CREATE TABLE outbound_delivery (
        id TEXT PRIMARY KEY NOT NULL CHECK (length(id) BETWEEN 1 AND 128 AND id = trim(id)),
        resend_of TEXT REFERENCES outbound_delivery(id) ON UPDATE CASCADE ON DELETE RESTRICT,
        message_id TEXT NOT NULL UNIQUE REFERENCES message(id) ON UPDATE CASCADE ON DELETE RESTRICT,
        status TEXT NOT NULL CHECK (status IN ('scheduled', 'sending', 'accepted', 'delivered', 'bounced', 'cancelled', 'failed', 'indeterminate')),
        send_at INTEGER NOT NULL CHECK (send_at >= 0),
        accepted_at INTEGER CHECK (accepted_at IS NULL OR accepted_at >= 0),
        delivered_at INTEGER CHECK (delivered_at IS NULL OR delivered_at >= 0),
        bounced_at INTEGER CHECK (bounced_at IS NULL OR bounced_at >= 0),
        cancelled_at INTEGER CHECK (cancelled_at IS NULL OR cancelled_at >= 0),
        failure_code TEXT,
        failure_at INTEGER CHECK (failure_at IS NULL OR failure_at >= 0),
        attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
        created_at INTEGER NOT NULL CHECK (created_at >= 0),
        updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
        version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
        deleted_at INTEGER CHECK (deleted_at IS NULL OR deleted_at >= 0)
      ) STRICT`,
      `CREATE INDEX message_active_activity_idx ON message(activity_at DESC, id DESC) WHERE deleted_at IS NULL`,
      `CREATE INDEX message_active_thread_idx ON message(thread_id, activity_at, id) WHERE deleted_at IS NULL`,
      `CREATE INDEX message_label_label_idx ON message_label(label_id, message_id)`,
      `CREATE INDEX outbound_delivery_status_send_idx ON outbound_delivery(status, send_at, id) WHERE deleted_at IS NULL`,
    ],
  },
  {
    version: 5,
    statements: [
      `CREATE VIRTUAL TABLE message_search USING fts5(
        subject,
        sender_json,
        recipients_json,
        snippet,
        text_body,
        html_body,
        to_json,
        cc_json,
        bcc_json,
        content='message',
        content_rowid='rowid',
        tokenize='unicode61'
      )`,
      `INSERT INTO message_search(
        rowid,
        subject,
        sender_json,
        recipients_json,
        snippet,
        text_body,
        html_body,
        to_json,
        cc_json,
        bcc_json
      )
      SELECT
        rowid,
        subject,
        coalesce(sender_json, ''),
        recipients_json,
        snippet,
        coalesce(text_body, ''),
        coalesce(html_body, ''),
        to_json,
        cc_json,
        bcc_json
      FROM message
      WHERE deleted_at IS NULL`,
      `CREATE TRIGGER message_search_ai AFTER INSERT ON message
      WHEN new.deleted_at IS NULL
      BEGIN
        INSERT INTO message_search(
          rowid,
          subject,
          sender_json,
          recipients_json,
          snippet,
          text_body,
          html_body,
          to_json,
          cc_json,
          bcc_json
        ) VALUES (
          new.rowid,
          new.subject,
          coalesce(new.sender_json, ''),
          new.recipients_json,
          new.snippet,
          coalesce(new.text_body, ''),
          coalesce(new.html_body, ''),
          new.to_json,
          new.cc_json,
          new.bcc_json
        );
      END`,
      `CREATE TRIGGER message_search_ad AFTER DELETE ON message
      WHEN old.deleted_at IS NULL
      BEGIN
        INSERT INTO message_search(
          message_search,
          rowid,
          subject,
          sender_json,
          recipients_json,
          snippet,
          text_body,
          html_body,
          to_json,
          cc_json,
          bcc_json
        ) VALUES (
          'delete',
          old.rowid,
          old.subject,
          coalesce(old.sender_json, ''),
          old.recipients_json,
          old.snippet,
          coalesce(old.text_body, ''),
          coalesce(old.html_body, ''),
          old.to_json,
          old.cc_json,
          old.bcc_json
        );
      END`,
      `CREATE TRIGGER message_search_au AFTER UPDATE ON message
      WHEN old.deleted_at IS NULL OR new.deleted_at IS NULL
      BEGIN
        INSERT INTO message_search(
          message_search,
          rowid,
          subject,
          sender_json,
          recipients_json,
          snippet,
          text_body,
          html_body,
          to_json,
          cc_json,
          bcc_json
        )
        SELECT
          'delete',
          old.rowid,
          old.subject,
          coalesce(old.sender_json, ''),
          old.recipients_json,
          old.snippet,
          coalesce(old.text_body, ''),
          coalesce(old.html_body, ''),
          old.to_json,
          old.cc_json,
          old.bcc_json
        WHERE old.deleted_at IS NULL;

        INSERT INTO message_search(
          rowid,
          subject,
          sender_json,
          recipients_json,
          snippet,
          text_body,
          html_body,
          to_json,
          cc_json,
          bcc_json
        )
        SELECT
          new.rowid,
          new.subject,
          coalesce(new.sender_json, ''),
          new.recipients_json,
          new.snippet,
          coalesce(new.text_body, ''),
          coalesce(new.html_body, ''),
          new.to_json,
          new.cc_json,
          new.bcc_json
        WHERE new.deleted_at IS NULL;
      END`,
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
