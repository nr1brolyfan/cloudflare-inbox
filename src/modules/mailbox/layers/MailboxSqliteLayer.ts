import * as Layer from "effect/Layer";

import { MailboxContactStoreSqliteLayer } from "#/modules/mailbox/adapters/sqlite/MailboxContactStoreSqlite";
import { MailboxDirectoryStoreSqliteLayer } from "#/modules/mailbox/adapters/sqlite/MailboxDirectoryStoreSqlite";
import { MailboxDraftAttachmentStoreSqliteLayer } from "#/modules/mailbox/adapters/sqlite/MailboxDraftAttachmentStoreSqlite";
import { MailboxDraftStoreSqliteLayer } from "#/modules/mailbox/adapters/sqlite/MailboxDraftStoreSqlite";
import { MailboxInboundStoreSqliteLayer } from "#/modules/mailbox/adapters/sqlite/MailboxInboundStoreSqlite";
import { MailboxMessageStoreSqliteLayer } from "#/modules/mailbox/adapters/sqlite/MailboxMessageStoreSqlite";
import { MailboxOperationStoreSqliteLayer } from "#/modules/mailbox/adapters/sqlite/MailboxOperationStoreSqlite";
import { MailboxOutboundStoreSqliteLayer } from "#/modules/mailbox/adapters/sqlite/MailboxOutboundStoreSqlite";
import { MailboxResourceIndexSqliteLayer } from "#/modules/mailbox/adapters/sqlite/MailboxResourceIndexSqlite";
import { MailboxDatabaseSqliteLayer } from "#/modules/mailbox/adapters/sqlite/MailboxSqliteDatabase";
import { MailboxRuntimeSqliteLayer } from "#/modules/mailbox/adapters/sqlite/MailboxSqliteRuntime";

export const MailboxSqliteInfrastructureLayer = Layer.mergeAll(
  MailboxDatabaseSqliteLayer,
  MailboxRuntimeSqliteLayer
);

const MailboxSqliteStoresLayer = Layer.mergeAll(
  MailboxResourceIndexSqliteLayer,
  MailboxDirectoryStoreSqliteLayer,
  MailboxContactStoreSqliteLayer,
  MailboxMessageStoreSqliteLayer,
  MailboxInboundStoreSqliteLayer,
  MailboxDraftStoreSqliteLayer,
  MailboxDraftAttachmentStoreSqliteLayer,
  MailboxOutboundStoreSqliteLayer
).pipe(
  Layer.provide(MailboxOperationStoreSqliteLayer),
  Layer.provide(MailboxSqliteInfrastructureLayer)
);

/** Complete mailbox-local SQLite graph with synchronous migrations. */
export const MailboxSqliteLayer = Layer.merge(
  MailboxSqliteInfrastructureLayer,
  MailboxSqliteStoresLayer
);
