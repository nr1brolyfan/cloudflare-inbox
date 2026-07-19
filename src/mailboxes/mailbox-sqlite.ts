export type MailboxSqlBinding = string | number | null;

export interface MailboxSqlCursor {
  readonly toArray: () => readonly Readonly<Record<string, unknown>>[];
}

export interface MailboxSql {
  readonly exec: (
    query: string,
    ...bindings: MailboxSqlBinding[]
  ) => MailboxSqlCursor;
}

export interface MailboxSqlStorage {
  readonly sql: MailboxSql;
  /** Cloudflare SQLite transactions are synchronous, so domain failures return as Result data. */
  readonly transactionSync: <A>(run: () => A) => A;
}
