import type * as SqliteClient from "@effect/sql-sqlite-do/SqliteClient";
import type * as DrizzleDo from "drizzle-orm/effect-sqlite-do";
import * as Context from "effect/Context";

import type { mailboxRelations } from "./mailbox-schema";

export type MailboxDatabase = DrizzleDo.EffectSQLiteDoDatabase<
  typeof mailboxRelations
> & {
  readonly $client: SqliteClient.SqliteClient;
};

/** Effect-native Drizzle client scoped to one mailbox Durable Object. */
export const MailboxDatabase = Context.Service<MailboxDatabase>(
  "cloudflare-inbox/MailboxDatabase"
);
