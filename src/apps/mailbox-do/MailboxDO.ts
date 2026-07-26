import type { RuntimeContext } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import { sql } from "drizzle-orm";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { MailboxDoStub } from "#/modules/mailbox/adapters/durable-object/MailboxDoClient";
import { MailboxDoHandler } from "#/modules/mailbox/adapters/durable-object/MailboxDoHandler";
import { MailboxDirectoryStore } from "#/modules/mailbox/adapters/sqlite/MailboxDirectoryStoreSqlite";
import { MailboxResourceIndex } from "#/modules/mailbox/adapters/sqlite/MailboxResourceIndexSqlite";
import { MailboxDatabase } from "#/modules/mailbox/adapters/sqlite/MailboxSqliteDatabase";
import { mailboxSchemaVersion } from "#/modules/mailbox/adapters/sqlite/MailboxSqliteMigrations";
import { mailboxSchemaMigration } from "#/modules/mailbox/adapters/sqlite/MailboxSqliteSchema";
import { MailboxOutboundAlarmDispatch } from "#/modules/mailbox/application/MailboxOutboundAlarmDispatch";
import { MailboxOutboundAlarmScheduler } from "#/modules/mailbox/application/MailboxOutboundAlarmScheduler";
import { MailboxOutboundLifecycleStore } from "#/modules/mailbox/ports/MailboxOutboundLifecycleStore";
import { mailboxOperationalStatusD1Layer } from "#/modules/organization/adapters/d1/MailboxOperationalStatusD1";
import {
  ControlPlaneDatabase,
  MailboxEmailSender,
  RawMessagesBucket,
} from "#/platform/cloudflare/Resources";

import { MailboxDoApplicationLayer } from "./MailboxDoApplicationLayer";
import {
  MailboxDoBindings,
  mailboxDoBindingsFromClients,
} from "./MailboxDoBindings";

const mailboxDoImplementation = Effect.gen(function* () {
  const database = yield* MailboxDatabase;
  const directoryStore = yield* MailboxDirectoryStore;
  const resourceIndex = yield* MailboxResourceIndex;
  const handler = yield* MailboxDoHandler;
  const outboundAlarm = yield* MailboxOutboundAlarmScheduler;
  const outboundAlarmDispatch = yield* MailboxOutboundAlarmDispatch;
  const outboundLifecycle = yield* MailboxOutboundLifecycleStore;

  yield* resourceIndex.initialize;
  yield* directoryStore.initialize;
  yield* outboundLifecycle.recoverStaleSending;
  yield* outboundAlarm.reconcile;

  return {
    executeDirectory: handler.executeDirectory,
    executeMailData: handler.executeMailData,
    resolveMailResource: handler.resolveMailResource,
    alarm: () => outboundAlarmDispatch.handle,
    sqliteReady: () =>
      Effect.gen(function* () {
        const [row] = yield* database
          .select({
            version: sql<number>`coalesce(max(${mailboxSchemaMigration.version}), 0)`,
          })
          .from(mailboxSchemaMigration);

        if (row?.version !== mailboxSchemaVersion) {
          return yield* Effect.die(
            new Error("MailboxDO SQLite schema is not current")
          );
        }

        return true;
      }).pipe(Effect.orDie),
  };
});

const mailboxDoRuntime = Effect.gen(function* () {
  const controlPlane = yield* Cloudflare.D1.QueryDatabase(ControlPlaneDatabase);
  const rawMessages = yield* Cloudflare.R2.ReadWriteBucket(RawMessagesBucket);
  const email = yield* Cloudflare.Email.Send(MailboxEmailSender);

  return Effect.gen(function* () {
    const providerDisabled = yield* Config.boolean(
      "MAILBOX_OUTBOUND_PROVIDER_DISABLED"
    );
    const bindings = mailboxDoBindingsFromClients(
      controlPlane,
      rawMessages,
      providerDisabled ? undefined : email
    );
    const controlPlaneDatabase = yield* bindings.controlPlane;
    const operationalStatusLayer =
      mailboxOperationalStatusD1Layer(controlPlaneDatabase);

    return yield* mailboxDoImplementation.pipe(
      Effect.provide(
        MailboxDoApplicationLayer.pipe(
          Layer.provide(operationalStatusLayer),
          Layer.provide(Layer.succeed(MailboxDoBindings, bindings))
        )
      ),
      Effect.orDie
    );
  }).pipe(Effect.orDie);
}).pipe(
  Effect.provide(Cloudflare.D1.QueryDatabaseBinding),
  Effect.provide(Cloudflare.Email.SendBinding),
  Effect.provide(Cloudflare.R2.ReadWriteBucketBinding),
  Effect.orDie
);

/** SQLite-backed data-plane object with migrations completed before RPC starts. */
export class MailboxDO extends Cloudflare.DurableObject<MailboxDO>()(
  "MailboxDO",
  mailboxDoRuntime
) {}

export interface MailboxDOStub extends MailboxDoStub {
  readonly sqliteReady: () => Effect.Effect<unknown, unknown, RuntimeContext>;
}

export interface MailboxDONamespace {
  readonly getByName: (name: string) => MailboxDOStub;
}
