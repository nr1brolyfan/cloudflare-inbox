import * as SqliteClient from "@effect/sql-sqlite-do/SqliteClient";
import * as Cloudflare from "alchemy/Cloudflare";
import * as DrizzleDo from "drizzle-orm/effect-sqlite-do";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { MailboxDatabase } from "./mailbox-database";
import { applyMailboxMigrations } from "./mailbox-migrations";
import { mailboxRelations } from "./mailbox-schema";

export const MailboxDatabaseLive = Layer.unwrap(
  Effect.gen(function* () {
    const state = yield* Cloudflare.DurableObjectState;
    const { storage } = state.raw;

    yield* Effect.sync(() => applyMailboxMigrations(storage));
    const clientLive = SqliteClient.layer({ storage });

    return Layer.effect(
      MailboxDatabase,
      DrizzleDo.makeWithDefaults({ relations: mailboxRelations, storage })
    ).pipe(Layer.provide(clientLive));
  })
);
