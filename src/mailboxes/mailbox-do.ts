import * as Cloudflare from "alchemy/Cloudflare";
import { sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { MailboxDoHandler, MailboxDoHandlerLive } from "./do-handler";
import {
  MailboxAlarmStorageLive,
  MailboxOutboundAlarmScheduler,
  MailboxOutboundAlarmSchedulerLive,
} from "./outbound-alarm-live";
import { mailboxSchemaVersion } from "./sqlite-migrations";
import { mailboxSchemaMigration } from "./sqlite-schema";
import {
  MailboxDatabase,
  MailboxDatabaseLive,
  MailboxDirectoryStore,
  MailboxDirectoryStoreLive,
  MailboxDraftStoreLive,
  MailboxDraftAttachmentStoreLive,
  MailboxIdentityLive,
  MailboxInboundStoreLive,
  MailboxMessageStoreLive,
  MailboxOperationStoreLive,
  MailboxOutboundStoreLive,
  MailboxResourceIndex,
  MailboxResourceIndexLive,
  MailboxRuntimeLive,
} from "./sqlite-services";

const mailboxDoImplementation = Effect.gen(function* () {
  const database = yield* MailboxDatabase;
  const directoryStore = yield* MailboxDirectoryStore;
  const resourceIndex = yield* MailboxResourceIndex;
  const handler = yield* MailboxDoHandler;
  const outboundAlarm = yield* MailboxOutboundAlarmScheduler;

  yield* resourceIndex.initialize;
  yield* directoryStore.initialize;
  yield* outboundAlarm.reconcile;

  return {
    executeDirectory: handler.executeDirectory,
    executeMailData: handler.executeMailData,
    resolveMailResource: handler.resolveMailResource,
    alarm: () => outboundAlarm.reconcile,
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

const MailboxInfrastructureLive = Layer.mergeAll(
  MailboxDatabaseLive,
  MailboxRuntimeLive,
  MailboxIdentityLive
);

const MailboxStoresLive = Layer.mergeAll(
  MailboxResourceIndexLive,
  MailboxDirectoryStoreLive,
  MailboxMessageStoreLive,
  MailboxInboundStoreLive,
  MailboxDraftStoreLive,
  MailboxDraftAttachmentStoreLive,
  MailboxOutboundStoreLive
).pipe(
  Layer.provide(MailboxOperationStoreLive),
  Layer.provide(MailboxInfrastructureLive)
);

const MailboxSqliteLive = Layer.merge(
  MailboxInfrastructureLive,
  MailboxStoresLive
);

const MailboxOutboundAlarmLive = MailboxOutboundAlarmSchedulerLive.pipe(
  Layer.provide(MailboxAlarmStorageLive),
  Layer.provide(MailboxInfrastructureLive)
);

const MailboxHandlerLive = MailboxDoHandlerLive.pipe(
  Layer.provide(Layer.merge(MailboxSqliteLive, MailboxOutboundAlarmLive))
);

const mailboxDoLive = mailboxDoImplementation.pipe(
  Effect.orDie,
  Effect.provide(
    Layer.mergeAll(
      MailboxSqliteLive,
      MailboxHandlerLive,
      MailboxOutboundAlarmLive
    )
  )
);

/** SQLite-backed data-plane object with migrations completed before RPC starts. */
export class MailboxDO extends Cloudflare.DurableObject<MailboxDO>()(
  "MailboxDO",
  Effect.succeed(mailboxDoLive)
) {}

export type MailboxDONamespace = Effect.Success<typeof MailboxDO>;
