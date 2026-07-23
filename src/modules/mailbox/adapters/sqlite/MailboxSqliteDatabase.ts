import * as SqliteClient from "@effect/sql-sqlite-do/SqliteClient";
import * as Cloudflare from "alchemy/Cloudflare";
import * as DrizzleDo from "drizzle-orm/effect-sqlite-do";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { applyMailboxMigrations } from "./MailboxSqliteMigrations";
import { mailboxRelations } from "./MailboxSqliteSchema";

export type MailboxDatabase = DrizzleDo.EffectSQLiteDoDatabase<
  typeof mailboxRelations
> & {
  readonly $client: SqliteClient.SqliteClient;
};

/** Effect-native Drizzle client scoped to one mailbox Durable Object. */
export const MailboxDatabase = Context.Service<MailboxDatabase>(
  "cloudflare-inbox/MailboxDatabase"
);

export const MailboxDatabaseSqliteLayer = Layer.unwrap(
  Effect.gen(function* () {
    const state = yield* Cloudflare.DurableObjectState;
    const { storage } = state.raw;

    yield* Effect.sync(() => applyMailboxMigrations(storage));
    const clientLayer = SqliteClient.layer({ storage });

    return Layer.effect(
      MailboxDatabase,
      DrizzleDo.makeWithDefaults({ relations: mailboxRelations, storage })
    ).pipe(Layer.provide(clientLayer));
  })
);
