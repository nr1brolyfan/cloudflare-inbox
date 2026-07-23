import * as Layer from "effect/Layer";

import { OutboundDraftAttachmentBlobReaderR2Layer } from "#/modules/mailbox/adapters/r2/OutboundDraftAttachmentBlobReaderR2";
import { MailboxOutboundDispatchStoreSqliteLayer } from "#/modules/mailbox/adapters/sqlite/MailboxOutboundDispatchStoreSqlite";
import { MailboxOutboundDispatcher } from "#/modules/mailbox/application/MailboxOutboundDispatcher";

/** Dispatcher with mailbox-local snapshot and verified attachment storage adapters. */
export const MailboxOutboundDispatcherLayer =
  MailboxOutboundDispatcher.layerNoDeps.pipe(
    Layer.provide(
      Layer.merge(
        MailboxOutboundDispatchStoreSqliteLayer,
        OutboundDraftAttachmentBlobReaderR2Layer
      )
    )
  );
