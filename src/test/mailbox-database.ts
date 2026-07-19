import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import * as SqliteDo from "@effect/sql-sqlite-do/SqliteClient";
import * as SqliteNode from "@effect/sql-sqlite-node/SqliteClient";
import * as DrizzleNode from "drizzle-orm/effect-sqlite-node";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { MailboxId } from "../mailboxes/core";
import { applyMailboxMigrations } from "../mailboxes/sqlite-migrations";
import { mailboxRelations } from "../mailboxes/sqlite-schema";
import {
  MailboxDatabase,
  MailboxDirectoryStoreLive,
  MailboxDraftStoreLive,
  MailboxIdentity,
  MailboxMessageStoreLive,
  MailboxOutboundStoreLive,
  MailboxResourceIndexLive,
  MailboxRuntime,
} from "../mailboxes/sqlite-services";
import type { MailboxRuntime as MailboxRuntimeType } from "../mailboxes/sqlite-services";

const directory = mkdtempSync(path.join(tmpdir(), "cloudflare-inbox-mailbox-"));
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
migrationDatabase.close();

const SqliteLive = SqliteNode.layer({ filename, disableWAL: true });

export const MailboxDatabaseTest = Layer.effect(
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

export const mailboxStoresTestLayer = (
  mailboxId: MailboxId,
  runtime: MailboxRuntimeType
) => {
  const dependencies = Layer.merge(
    Layer.succeed(MailboxIdentity, MailboxIdentity.of({ mailboxId })),
    Layer.succeed(MailboxRuntime, runtime)
  );
  return Layer.mergeAll(
    MailboxResourceIndexLive,
    MailboxDirectoryStoreLive,
    MailboxMessageStoreLive,
    MailboxDraftStoreLive,
    MailboxOutboundStoreLive
  ).pipe(Layer.provide(dependencies));
};
