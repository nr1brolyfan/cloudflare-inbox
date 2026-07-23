import * as Layer from "effect/Layer";

import { MailboxDoHandlerLayer } from "#/modules/mailbox/adapters/durable-object/MailboxDoHandler";
import { MailboxIdentityDoLayer } from "#/modules/mailbox/adapters/durable-object/MailboxIdentityDo";
import { OutboundEmailProviderCloudflareLayer } from "#/modules/mailbox/adapters/email/OutboundEmailProviderCloudflare";
import { MailboxDoStoreSqliteLayer } from "#/modules/mailbox/adapters/sqlite/MailboxDoStoreSqlite";
import { MailboxOutboundAlarmLayer } from "#/modules/mailbox/layers/MailboxOutboundAlarmLayer";
import { MailboxOutboundDispatcherLayer } from "#/modules/mailbox/layers/MailboxOutboundDispatcherLayer";
import { MailboxSqliteLayer } from "#/modules/mailbox/layers/MailboxSqliteLayer";

import {
  MailboxDoEmailSendClientLayer,
  MailboxDoOutboundAttachmentR2ClientLayer,
} from "./MailboxDoBindings";

const MailboxDoPersistenceLayer = Layer.merge(
  MailboxIdentityDoLayer,
  MailboxSqliteLayer.pipe(Layer.provide(MailboxIdentityDoLayer))
);

const MailboxDoOutboundAdaptersLayer = Layer.merge(
  MailboxDoOutboundAttachmentR2ClientLayer,
  OutboundEmailProviderCloudflareLayer.pipe(
    Layer.provide(MailboxDoEmailSendClientLayer)
  )
);

const MailboxDoOutboundDispatcherApplicationLayer =
  MailboxOutboundDispatcherLayer.pipe(
    Layer.provide(
      Layer.merge(MailboxDoPersistenceLayer, MailboxDoOutboundAdaptersLayer)
    )
  );

const MailboxDoOutboundAlarmApplicationLayer = MailboxOutboundAlarmLayer.pipe(
  Layer.provide(
    Layer.merge(
      MailboxDoPersistenceLayer,
      MailboxDoOutboundDispatcherApplicationLayer
    )
  )
);

const MailboxDoStoreApplicationLayer = MailboxDoStoreSqliteLayer.pipe(
  Layer.provide(
    Layer.merge(
      MailboxDoPersistenceLayer,
      MailboxDoOutboundAlarmApplicationLayer
    )
  )
);

const MailboxDoHandlerApplicationLayer = MailboxDoHandlerLayer.pipe(
  Layer.provide(
    Layer.merge(MailboxDoPersistenceLayer, MailboxDoStoreApplicationLayer)
  )
);

/** One closed, activation-scoped graph for the mailbox Durable Object. */
export const MailboxDoApplicationLayer = Layer.mergeAll(
  MailboxDoPersistenceLayer,
  MailboxDoOutboundAdaptersLayer,
  MailboxDoOutboundDispatcherApplicationLayer,
  MailboxDoOutboundAlarmApplicationLayer,
  MailboxDoStoreApplicationLayer,
  MailboxDoHandlerApplicationLayer
);
