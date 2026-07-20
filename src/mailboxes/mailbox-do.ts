import * as Cloudflare from "alchemy/Cloudflare";
import { sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  CloudflareOutboundEmailProviderLive,
  MailboxEmailSendClient,
} from "./cloudflare-email-sending-live";
import { MailboxDoHandler, MailboxDoHandlerLive } from "./do-handler";
import {
  MailboxDoOutboundBindings,
  MailboxDoOutboundBindingsLive,
} from "./mailbox-do-outbound-bindings-live";
import { MailboxOutboundDispatcherWithStorageLive } from "./mailbox-outbound-dispatcher";
import {
  MailboxOutboundAlarmDispatch,
  MailboxOutboundAlarmDispatchLive,
} from "./outbound-alarm-dispatch-live";
import {
  MailboxAlarmStorageLive,
  MailboxOutboundAlarmScheduler,
  MailboxOutboundAlarmSchedulerLive,
} from "./outbound-alarm-live";
import { OutboundDraftAttachmentR2ReadClient } from "./outbound-draft-attachment-reader-r2-live";
import { MailboxOutboundLifecycleStoreSqliteLive } from "./outbound-lifecycle-store-sqlite-live";
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
  const outboundAlarmDispatch = yield* MailboxOutboundAlarmDispatch;

  yield* resourceIndex.initialize;
  yield* directoryStore.initialize;
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

const mailboxDoLive = Effect.gen(function* () {
  const bindings = yield* MailboxDoOutboundBindings;
  const outboundAttachmentClientLive = Layer.succeed(
    OutboundDraftAttachmentR2ReadClient,
    OutboundDraftAttachmentR2ReadClient.of({
      get: (key) =>
        bindings.rawMessages.pipe(
          Effect.flatMap((rawMessages) =>
            Effect.tryPromise({
              try: () => rawMessages.get(key),
              catch: (cause) => cause,
            })
          ),
          Effect.map((object) => {
            if (object === null) {
              return null;
            }
            const checksum = object.checksums.sha256;
            return {
              arrayBuffer: () =>
                Effect.tryPromise({
                  try: () => object.arrayBuffer(),
                  catch: (cause) => cause,
                }),
              contentType: object.httpMetadata?.contentType,
              customMetadata: object.customMetadata ?? {},
              sha256:
                checksum === undefined
                  ? undefined
                  : [...new Uint8Array(checksum)]
                      .map((byte) => byte.toString(16).padStart(2, "0"))
                      .join(""),
              size: object.size,
            };
          })
        ),
    })
  );
  const emailSendClientLive = Layer.succeed(
    MailboxEmailSendClient,
    MailboxEmailSendClient.of({
      send: (message) =>
        bindings.email.pipe(
          Effect.flatMap((email) =>
            Effect.tryPromise({
              try: () => email.send(message),
              catch: (cause) =>
                new Cloudflare.Email.SendEmailError({
                  cause,
                  message:
                    cause instanceof Error
                      ? cause.message
                      : "Unknown send_email error",
                }),
            })
          )
        ),
    })
  );
  const outboundProviderLive = CloudflareOutboundEmailProviderLive.pipe(
    Layer.provide(emailSendClientLive)
  );
  const outboundLifecycleLive = MailboxOutboundLifecycleStoreSqliteLive.pipe(
    Layer.provide(MailboxInfrastructureLive)
  );
  const outboundDispatcherLive = MailboxOutboundDispatcherWithStorageLive.pipe(
    Layer.provide(
      Layer.mergeAll(
        MailboxInfrastructureLive,
        outboundAttachmentClientLive,
        outboundProviderLive
      )
    )
  );
  const outboundAlarmDispatchLive = MailboxOutboundAlarmDispatchLive.pipe(
    Layer.provide(
      Layer.mergeAll(
        MailboxOutboundAlarmLive,
        outboundLifecycleLive,
        outboundDispatcherLive
      )
    )
  );

  return mailboxDoImplementation.pipe(
    Effect.orDie,
    Effect.provide(
      Layer.mergeAll(
        MailboxSqliteLive,
        MailboxHandlerLive,
        MailboxOutboundAlarmLive,
        outboundAlarmDispatchLive
      )
    )
  );
}).pipe(Effect.provide(MailboxDoOutboundBindingsLive), Effect.orDie);

/** SQLite-backed data-plane object with migrations completed before RPC starts. */
export class MailboxDO extends Cloudflare.DurableObject<MailboxDO>()(
  "MailboxDO",
  mailboxDoLive
) {}

export type MailboxDONamespace = Effect.Success<typeof MailboxDO>;
