// Generated from @effect-auth/core@0.1.0-alpha.19.
// Do not edit manually; run `bun run generate:auth-schema`.

import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const authAuditLog = sqliteTable(
  "auth_audit_log",
  {
    storageId: integer("storage_id").primaryKey({ autoIncrement: true }),
    id: text("id"),
    type: text("type").notNull(),
    userId: text("user_id"),
    actorUserId: text("actor_user_id"),
    occurredAt: integer("occurred_at").notNull(),
    requestIpHash: text("request_ip_hash"),
    requestUserAgentHash: text("request_user_agent_hash"),
    event: text("event").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("auth_audit_log_id_idx").on(t.id),
    index("auth_audit_log_user_occurred_at_idx").on(t.userId, t.occurredAt),
    index("auth_audit_log_actor_user_occurred_at_idx").on(t.actorUserId, t.occurredAt),
    index("auth_audit_log_type_occurred_at_idx").on(t.type, t.occurredAt),
    index("auth_audit_log_occurred_at_idx").on(t.occurredAt),
  ],
);
