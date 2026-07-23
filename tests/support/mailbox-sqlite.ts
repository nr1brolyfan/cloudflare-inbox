import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import * as SqliteDo from "@effect/sql-sqlite-do/SqliteClient";
import * as SqliteNode from "@effect/sql-sqlite-node/SqliteClient";
import * as DrizzleNode from "drizzle-orm/effect-sqlite-node";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { MailboxDoHandlerLayer } from "#/modules/mailbox/adapters/durable-object/MailboxDoHandler";
import { MailboxDirectoryStoreSqliteLayer } from "#/modules/mailbox/adapters/sqlite/MailboxDirectoryStoreSqlite";
import { MailboxDoStoreSqliteLayer } from "#/modules/mailbox/adapters/sqlite/MailboxDoStoreSqlite";
import { MailboxDraftAttachmentStoreSqliteLayer } from "#/modules/mailbox/adapters/sqlite/MailboxDraftAttachmentStoreSqlite";
import { MailboxDraftStoreSqliteLayer } from "#/modules/mailbox/adapters/sqlite/MailboxDraftStoreSqlite";
import { MailboxInboundStoreSqliteLayer } from "#/modules/mailbox/adapters/sqlite/MailboxInboundStoreSqlite";
import { MailboxMessageStoreSqliteLayer } from "#/modules/mailbox/adapters/sqlite/MailboxMessageStoreSqlite";
import { MailboxOperationStoreSqliteLayer } from "#/modules/mailbox/adapters/sqlite/MailboxOperationStoreSqlite";
import { MailboxOutboundStoreSqliteLayer } from "#/modules/mailbox/adapters/sqlite/MailboxOutboundStoreSqlite";
import { MailboxResourceIndexSqliteLayer } from "#/modules/mailbox/adapters/sqlite/MailboxResourceIndexSqlite";
import { MailboxDatabase } from "#/modules/mailbox/adapters/sqlite/MailboxSqliteDatabase";
import { applyMailboxMigrations } from "#/modules/mailbox/adapters/sqlite/MailboxSqliteMigrations";
import { mailboxRelations } from "#/modules/mailbox/adapters/sqlite/MailboxSqliteSchema";
import { MailboxOutboundAlarmScheduler } from "#/modules/mailbox/application/MailboxOutboundAlarmScheduler";

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
export const MailboxDatabaseTestLayer = Layer.unwrap(
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
export const MailboxStoresTestLayer = Layer.mergeAll(
  MailboxResourceIndexSqliteLayer,
  MailboxDirectoryStoreSqliteLayer,
  MailboxMessageStoreSqliteLayer,
  MailboxInboundStoreSqliteLayer,
  MailboxDraftStoreSqliteLayer,
  MailboxDraftAttachmentStoreSqliteLayer,
  MailboxOutboundStoreSqliteLayer
).pipe(Layer.provide(MailboxOperationStoreSqliteLayer));

/** SQLite stores plus the in-process Durable Object protocol handler. */
const MailboxOutboundAlarmTestLayer = Layer.succeed(
  MailboxOutboundAlarmScheduler,
  MailboxOutboundAlarmScheduler.of({
    nextScheduledAt: Effect.succeed(null),
    reconcile: Effect.void,
  })
);
const MailboxDoStoreTestLayer = MailboxDoStoreSqliteLayer.pipe(
  Layer.provide(MailboxOutboundAlarmTestLayer),
  Layer.provide(MailboxStoresTestLayer)
);

export const MailboxDoHandlerTestLayer = Layer.merge(
  MailboxDoHandlerLayer.pipe(Layer.provide(MailboxDoStoreTestLayer)),
  MailboxStoresTestLayer
);
