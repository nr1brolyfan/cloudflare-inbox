// Generated from @effect-auth/core@0.1.0-alpha.20.
// Do not edit manually; run `bun run generate:auth-schema`.

import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
    canonicalEvent: text("canonical_event").notNull(),
    canonicalPayload: text("canonical_payload").notNull(),
    normalizationVersion: integer("normalization_version").notNull(),
    eventBytes: integer("event_bytes").notNull(),
    payloadBytes: integer("payload_bytes").notNull(),
  },
  (t) => [
    primaryKey({ name: "auth_webhook_outbox_pkey", columns: [t.id] }),
    check(
      "auth_webhook_outbox_id_check",
      sql`typeof(id) = 'text' and length(cast(id as blob)) between 1 and 256`,
    ),
    check(
      "auth_webhook_outbox_endpoint_key_check",
      sql`typeof(endpoint_key) = 'text' and length(cast(endpoint_key as blob)) between 1 and 128 and substr(endpoint_key, 1, 1) glob '[A-Za-z0-9]' and endpoint_key not glob '*[^A-Za-z0-9_.:-]*'`,
    ),
    check(
      "auth_webhook_outbox_status_check",
      sql`status in ('pending', 'failed', 'delivered', 'dead_lettered')`,
    ),
    check(
      "auth_webhook_outbox_attempts_check",
      sql`typeof(attempts) = 'integer' and attempts between 0 and 100`,
    ),
    check(
      "auth_webhook_outbox_next_attempt_at_check",
      sql`typeof(next_attempt_at) = 'integer' and next_attempt_at between 0 and 9007199254740991`,
    ),
    check(
      "auth_webhook_outbox_created_at_check",
      sql`typeof(created_at) = 'integer' and created_at between 0 and 9007199254740991`,
    ),
    check(
      "auth_webhook_outbox_updated_at_check",
      sql`typeof(updated_at) = 'integer' and updated_at between 0 and 9007199254740991`,
    ),
    check(
      "auth_webhook_outbox_delivered_at_check",
      sql`delivered_at is null or (typeof(delivered_at) = 'integer' and delivered_at between 0 and 9007199254740991)`,
    ),
    check(
      "auth_webhook_outbox_last_error_check",
      sql`last_error is null or last_error in ('endpoint_not_found', 'endpoint_resolution_failed', 'dispatch_failed', 'max_attempts', 'invalid_retry')`,
    ),
    check(
      "auth_webhook_outbox_canonical_event_check",
      sql`json_valid(canonical_event) = 1 and event = canonical_event`,
    ),
    check(
      "auth_webhook_outbox_canonical_payload_check",
      sql`json_valid(canonical_payload) = 1 and json_extract(canonical_payload, '$') is json_extract(canonical_event, '$.payload')`,
    ),
    check("auth_webhook_outbox_normalization_version_check", sql`normalization_version = 1`),
    check(
      "auth_webhook_outbox_event_bytes_check",
      sql`typeof(event_bytes) = 'integer' and event_bytes between 1 and 98304 and event_bytes = length(cast(canonical_event as blob))`,
    ),
    check(
      "auth_webhook_outbox_payload_bytes_check",
      sql`typeof(payload_bytes) = 'integer' and payload_bytes between 1 and 65536 and payload_bytes = length(cast(canonical_payload as blob))`,
    ),
    check(
      "auth_webhook_outbox_state_check",
      sql`json_extract(canonical_event, '$.id') is not null and length(cast(json_extract(canonical_event, '$.id') as blob)) between 1 and 256`,
    ),
    check(
      "auth_webhook_outbox_state_check",
      sql`json_extract(canonical_event, '$.type') is not null and length(cast(json_extract(canonical_event, '$.type') as blob)) between 1 and 128`,
    ),
    check(
      "auth_webhook_outbox_state_check",
      sql`json_extract(canonical_event, '$.occurredAt') between 0 and 9007199254740991`,
    ),
    check(
      "auth_webhook_outbox_state_check",
      sql`(status = 'delivered' and delivered_at is not null and last_error is null) or (status != 'delivered' and delivered_at is null)`,
    ),
    index("auth_webhook_outbox_due_idx").on(t.nextAttemptAt, t.status),
    index("auth_webhook_outbox_endpoint_due_idx").on(t.endpointKey, t.nextAttemptAt),
    index("auth_webhook_outbox_status_idx").on(t.status),
  ],
);

export const authWebhookOutboxQuarantine = sqliteTable(
  "auth_webhook_outbox_quarantine",
  {
    id: text("id"),
    endpointKey: text("endpoint_key"),
    event: text("event"),
    status: text("status"),
    attempts: integer("attempts"),
    nextAttemptAt: integer("next_attempt_at"),
    createdAt: integer("created_at"),
    updatedAt: integer("updated_at"),
    deliveredAt: integer("delivered_at"),
    lastError: text("last_error"),
    reason: text("reason").notNull(),
  },
  (_t) => [],
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
    check(
      "auth_webhook_replay_id_check",
      sql`typeof(id) = 'text' and length(cast(id as blob)) between 1 and 256`,
    ),
    check(
      "auth_webhook_replay_expires_at_check",
      sql`typeof(expires_at) = 'integer' and expires_at between 0 and 9007199254740991`,
    ),
    check(
      "auth_webhook_replay_created_at_check",
      sql`typeof(created_at) = 'integer' and created_at between 0 and 9007199254740991`,
    ),
    check("auth_webhook_replay_state_check", sql`expires_at > created_at`),
    index("auth_webhook_replay_expires_at_idx").on(t.expiresAt),
  ],
);

export const authWebhookReplayQuarantine = sqliteTable(
  "auth_webhook_replay_quarantine",
  {
    id: text("id"),
    expiresAt: integer("expires_at"),
    createdAt: integer("created_at"),
    reason: text("reason").notNull(),
  },
  (_t) => [],
);
