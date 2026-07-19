// Generated from @effect-auth/core@0.1.0-alpha.19.
// Do not edit manually; run `bun run generate:auth-schema`.

import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const authWebhookOutbox = sqliteTable(
  "auth_webhook_outbox",
  {
    id: text("id").notNull(),
    endpointKey: text("endpoint_key").notNull(),
    event: text("event").notNull(),
    status: text("status").notNull(),
    attempts: integer("attempts").notNull(),
    nextAttemptAt: integer("next_attempt_at").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    deliveredAt: integer("delivered_at"),
    lastError: text("last_error"),
  },
  (t) => [
    primaryKey({ name: "auth_webhook_outbox_pkey", columns: [t.id] }),
    index("auth_webhook_outbox_due_idx").on(t.nextAttemptAt, t.status),
    index("auth_webhook_outbox_endpoint_due_idx").on(t.endpointKey, t.nextAttemptAt),
    index("auth_webhook_outbox_status_idx").on(t.status),
  ],
);

export const authWebhookReplay = sqliteTable(
  "auth_webhook_replay",
  {
    id: text("id").notNull(),
    expiresAt: integer("expires_at").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    primaryKey({ name: "auth_webhook_replay_pkey", columns: [t.id] }),
    index("auth_webhook_replay_expires_at_idx").on(t.expiresAt),
  ],
);
