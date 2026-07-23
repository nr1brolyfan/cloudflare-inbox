import * as Layer from "effect/Layer";

import { MailboxAlarmStorageDoLayer } from "#/modules/mailbox/adapters/durable-object/MailboxAlarmStorageDo";
import { MailboxOutboundLifecycleStoreSqliteLayer } from "#/modules/mailbox/adapters/sqlite/MailboxOutboundLifecycleStoreSqlite";
import { MailboxOutboundAlarmClockSystemLayer } from "#/modules/mailbox/adapters/system/MailboxOutboundAlarmClockSystem";
import { MailboxOutboundAlarmDispatch } from "#/modules/mailbox/application/MailboxOutboundAlarmDispatch";
import { MailboxOutboundAlarmScheduler } from "#/modules/mailbox/application/MailboxOutboundAlarmScheduler";
import { MailboxOutboundDispatcherLayer } from "#/modules/mailbox/layers/MailboxOutboundDispatcherLayer";

const MailboxOutboundLifecycleStoreLayer =
  MailboxOutboundLifecycleStoreSqliteLayer.pipe(
    Layer.provide(MailboxOutboundAlarmClockSystemLayer)
  );

const MailboxOutboundAlarmSchedulerLayer =
  MailboxOutboundAlarmScheduler.layerNoDeps.pipe(
    Layer.provide(
      Layer.mergeAll(
        MailboxAlarmStorageDoLayer,
        MailboxOutboundAlarmClockSystemLayer,
        MailboxOutboundLifecycleStoreLayer
      )
    )
  );

const MailboxOutboundAlarmDispatchLayer =
  MailboxOutboundAlarmDispatch.layerNoDeps.pipe(
    Layer.provide(
      Layer.mergeAll(
        MailboxOutboundLifecycleStoreLayer,
        MailboxOutboundAlarmSchedulerLayer,
        MailboxOutboundDispatcherLayer
      )
    )
  );

/** Complete outbound alarm graph with mailbox-local adapters selected. */
export const MailboxOutboundAlarmLayer = Layer.mergeAll(
  MailboxOutboundLifecycleStoreLayer,
  MailboxOutboundAlarmSchedulerLayer,
  MailboxOutboundAlarmDispatchLayer
);
