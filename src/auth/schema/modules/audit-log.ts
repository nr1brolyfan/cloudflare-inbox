// Generated from @effect-auth/core@0.1.0-alpha.20.
// Do not edit manually; run `bun run generate:auth-schema`.

import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
    normalizationVersion: integer("normalization_version").notNull(),
    eventBytes: integer("event_bytes").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    check(
      "auth_audit_log_id_check",
      sql`id is null or (typeof(id) = 'text' and length(cast(id as blob)) between 1 and 256)`,
    ),
    check(
      "auth_audit_log_type_check",
      sql`typeof(type) = 'text' and length(cast(type as blob)) between 1 and 128`,
    ),
    check(
      "auth_audit_log_user_id_check",
      sql`user_id is null or (typeof(user_id) = 'text' and length(cast(user_id as blob)) between 1 and 256)`,
    ),
    check(
      "auth_audit_log_actor_user_id_check",
      sql`actor_user_id is null or (typeof(actor_user_id) = 'text' and length(cast(actor_user_id as blob)) between 1 and 256)`,
    ),
    check(
      "auth_audit_log_occurred_at_check",
      sql`typeof(occurred_at) = 'integer' and occurred_at between 0 and 9007199254740991`,
    ),
    check(
      "auth_audit_log_request_ip_hash_check",
      sql`request_ip_hash is null or (typeof(request_ip_hash) = 'text' and length(cast(request_ip_hash as blob)) between 1 and 256)`,
    ),
    check(
      "auth_audit_log_request_user_agent_hash_check",
      sql`request_user_agent_hash is null or (typeof(request_user_agent_hash) = 'text' and length(cast(request_user_agent_hash as blob)) between 1 and 256)`,
    ),
    check(
      "auth_audit_log_event_check",
      sql`json_valid(event) = 1 and json_extract(event, '$.type') is type and json_extract(event, '$.occurredAt') is occurred_at`,
    ),
    check("auth_audit_log_normalization_version_check", sql`normalization_version = 1`),
    check(
      "auth_audit_log_event_bytes_check",
      sql`typeof(event_bytes) = 'integer' and event_bytes between 1 and 65536 and event_bytes = length(cast(event as blob))`,
    ),
    check(
      "auth_audit_log_created_at_check",
      sql`typeof(created_at) = 'integer' and created_at between 0 and 9007199254740991`,
    ),
    check(
      "auth_audit_log_custom_type_check",
      sql`type not like 'app.%' or (length(type) <= 128 and substr(type, 5, 1) glob '[a-z0-9]' and substr(type, 5) not glob '*[^a-z0-9_.-]*')`,
    ),
    index("auth_audit_log_id_idx").on(t.id),
    index("auth_audit_log_user_occurred_at_idx").on(t.userId, t.occurredAt),
    index("auth_audit_log_actor_user_occurred_at_idx").on(t.actorUserId, t.occurredAt),
    index("auth_audit_log_type_occurred_at_idx").on(t.type, t.occurredAt),
    index("auth_audit_log_occurred_at_idx").on(t.occurredAt),
  ],
);

export const authAuditLogQuarantine = sqliteTable(
  "auth_audit_log_quarantine",
  {
    storageId: integer("storage_id"),
    id: text("id"),
    type: text("type"),
    userId: text("user_id"),
    actorUserId: text("actor_user_id"),
    occurredAt: integer("occurred_at"),
    requestIpHash: text("request_ip_hash"),
    requestUserAgentHash: text("request_user_agent_hash"),
    event: text("event"),
    createdAt: integer("created_at"),
    reason: text("reason").notNull(),
  },
  (_t) => [],
);
