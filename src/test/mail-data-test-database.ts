import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import * as SqliteDo from "@effect/sql-sqlite-do/SqliteClient";
import * as SqliteNode from "@effect/sql-sqlite-node/SqliteClient";
import * as DrizzleNode from "drizzle-orm/effect-sqlite-node";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { MailboxDatabase } from "../mailboxes/mailbox-database";
import { applyMailboxMigrations } from "../mailboxes/mailbox-migrations";
import { mailboxRelations } from "../mailboxes/mailbox-schema";

export const makeMailDataTestDatabase = () => {
  const directory = mkdtempSync(
    path.join(tmpdir(), "cloudflare-inbox-mail-data-")
  );
  const filename = path.join(directory, "mailbox.sqlite");
  const migrationDatabase = new DatabaseSync(filename);

  applyMailboxMigrations({
    transactionSync: (run) => run(),
    sql: {
      exec: (query, ...bindings) => {
        const statement = migrationDatabase.prepare(query);
        const rows = /^\s*(?:SELECT|WITH|PRAGMA)/iu.test(query)
          ? statement.all(...bindings)
          : (statement.run(...bindings), []);
        return {
          one: () => {
            if (rows.length !== 1) {
              throw new Error(`Expected one row, received ${rows.length}`);
            }
            const [row] = rows;
            if (row === undefined) {
              throw new Error("Expected one row");
            }
            return row;
          },
          toArray: () => rows,
        };
      },
    },
  });
  migrationDatabase.close();

  const SqliteLive = SqliteNode.layer({ filename, disableWAL: true });
  const DatabaseLive = Layer.effect(
    MailboxDatabase,
    Effect.gen(function* () {
      const database = yield* DrizzleNode.makeWithDefaults({
        relations: mailboxRelations,
      });
      const client = Object.assign(database.$client, {
        [SqliteDo.TypeId]: SqliteDo.TypeId,
      });
      return MailboxDatabase.of(Object.assign(database, { $client: client }));
    })
  ).pipe(Layer.provide(SqliteLive));

  return <A, E>(program: Effect.Effect<A, E, MailboxDatabase>) =>
    Effect.runPromise(
      program.pipe(
        Effect.provide(DatabaseLive),
        Effect.ensuring(
          Effect.sync(() => rmSync(directory, { recursive: true, force: true }))
        )
      )
    );
};
