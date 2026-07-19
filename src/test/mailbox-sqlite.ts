import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import * as SqliteDo from "@effect/sql-sqlite-do/SqliteClient";
import * as SqliteNode from "@effect/sql-sqlite-node/SqliteClient";
import * as DrizzleNode from "drizzle-orm/effect-sqlite-node";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { MailboxDoHandlerLive } from "../mailboxes/do-handler";
import { applyMailboxMigrations } from "../mailboxes/sqlite-migrations";
import { mailboxRelations } from "../mailboxes/sqlite-schema";
import {
  MailboxDatabase,
  MailboxDirectoryStoreLive,
  MailboxDraftStoreLive,
  MailboxMessageStoreLive,
  MailboxOperationStoreLive,
  MailboxOutboundStoreLive,
  MailboxResourceIndexLive,
} from "../mailboxes/sqlite-services";

const acquireDatabase = () => {
  const directory = mkdtempSync(
    path.join(tmpdir(), "cloudflare-inbox-mailbox-")
  );
  const filename = path.join(directory, "mailbox.sqlite");
  const migrationDatabase = new DatabaseSync(filename);

  try {
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
              const [row] = rows;
              if (rows.length !== 1 || row === undefined) {
                throw new Error(`Expected one row, received ${rows.length}`);
              }
              return row;
            },
            toArray: () => rows,
          };
        },
      },
    });
  } finally {
    migrationDatabase.close();
  }

  return { directory, filename };
};

/** Fresh migrated SQLite database whose temporary directory follows Layer scope. */
export const MailboxDatabaseTestLive = Layer.unwrap(
  Effect.acquireRelease(Effect.sync(acquireDatabase), ({ directory }) =>
    Effect.sync(() => rmSync(directory, { recursive: true, force: true }))
  ).pipe(
    Effect.map(({ filename }) =>
      Layer.effect(
        MailboxDatabase,
        Effect.gen(function* () {
          const database = yield* DrizzleNode.makeWithDefaults({
            relations: mailboxRelations,
          });
          const client = Object.assign(database.$client, {
            [SqliteDo.TypeId]: SqliteDo.TypeId,
          });
          return MailboxDatabase.of(
            Object.assign(database, { $client: client })
          );
        })
      ).pipe(Layer.provide(SqliteNode.layer({ filename, disableWAL: true })))
    )
  )
);

/** All SQLite mailbox stores; callers provide database, identity, and runtime. */
export const MailboxStoresTestLive = Layer.mergeAll(
  MailboxResourceIndexLive,
  MailboxDirectoryStoreLive,
  MailboxMessageStoreLive,
  MailboxDraftStoreLive,
  MailboxOutboundStoreLive
).pipe(Layer.provide(MailboxOperationStoreLive));

/** SQLite stores plus the in-process Durable Object protocol handler. */
export const MailboxDoHandlerTestLive = MailboxDoHandlerLive.pipe(
  Layer.provideMerge(MailboxStoresTestLive)
);
