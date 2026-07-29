// Generated from @effect-auth/core@0.1.0-alpha.20.
// Do not edit manually; run `bun run generate:auth-schema`.

import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const authSecurityTimelineCardinalityMigrationGuard = sqliteTable(
  "auth_security_timeline_cardinality_migration_guard",
  {
    version: integer("version").notNull(),
  },
  (t) => [
    primaryKey({
      name: "auth_security_timeline_cardinality_migration_guard_pkey",
      columns: [t.version],
    }),
    check("auth_security_timeline_cardinality_migration_guard_version_check", sql`version = 1`),
  ],
);

export const authSecurityTimelineQuarantine = sqliteTable(
  "auth_security_timeline_quarantine",
  {
    id: text("id"),
    userId: text("user_id"),
    type: text("type"),
    category: text("category"),
    severity: text("severity"),
    occurredAt: integer("occurred_at"),
    summary: text("summary"),
    actor: text("actor"),
    request: text("request"),
    metadata: text("metadata"),
    canonicalEvent: text("canonical_event"),
    canonicalMetadata: text("canonical_metadata"),
    metadataBytes: integer("metadata_bytes"),
    reason: text("reason").notNull(),
  },
  (_t) => [],
);

export const authSecurityTimeline = sqliteTable(
  "auth_security_timeline",
  {
    id: text("id").notNull(),
    userId: text("user_id").notNull(),
    type: text("type").notNull(),
    category: text("category").notNull(),
    severity: text("severity").notNull(),
    occurredAt: integer("occurred_at").notNull(),
    summary: text("summary").notNull(),
    actor: text("actor"),
    request: text("request"),
    metadata: text("metadata"),
    canonicalEvent: text("canonical_event").notNull(),
    canonicalMetadata: text("canonical_metadata"),
    normalizationVersion: integer("normalization_version").notNull(),
    eventBytes: integer("event_bytes").notNull(),
    metadataBytes: integer("metadata_bytes").notNull(),
  },
  (t) => [
    primaryKey({ name: "auth_security_timeline_pkey", columns: [t.id] }),
    check(
      "auth_security_timeline_id_check",
      sql`typeof(id) = 'text' and length(cast(id as blob)) between 1 and 256`,
    ),
    check(
      "auth_security_timeline_user_id_check",
      sql`typeof(user_id) = 'text' and length(cast(user_id as blob)) between 1 and 256`,
    ),
    check(
      "auth_security_timeline_type_check",
      sql`type in ('auth.login.succeeded','auth.login.failed','auth.session.revoked','auth.session.assurance_changed','auth.session.step_up_completed','auth.session.primary_reauthenticated','auth.session.recovery_remediation.entered','auth.session.recovery_remediation.completed','auth.risk.assessed','auth.policy.denied','auth.identity.added','auth.identity.replaced','auth.identity.revoked','auth.identity.primary_changed','auth.oauth.account.linked','auth.oauth.account.unlinked','auth.oauth.link_confirmation.started','auth.oauth.link_confirmation.confirmed','auth.oauth.provider_token.refreshed','auth.oauth.provider_token.revoked','auth.passkey.credential.revoked','auth.totp.enrollment.started','auth.totp.factor.confirmed','auth.totp.factor.verified','auth.totp.factor.revoked','auth.recovery_code.generated','auth.recovery_code.verified','auth.recovery_code.revoked','auth.api_key.created','auth.api_key.verified','auth.api_key.revoked','auth.api_key.verification_failed','auth.refresh_token.issued','auth.refresh_token.rotated','auth.refresh_token.reuse_detected','auth.refresh_token.revoked','auth.incident_action.executed','auth.jwt.introspected','auth.jwt.revoked','auth.permission_definition.created','auth.permission_definition.updated','auth.permission_definition.disabled','auth.permission_definition.enabled','auth.permission_definition.deleted','auth.role_definition.created','auth.role_definition.updated','auth.role_definition.disabled','auth.role_definition.enabled','auth.role_definition.deleted','auth.permission.granted','auth.permission.revoked','auth.role.granted','auth.role.revoked','auth.role_permission.assigned','auth.role_permission.removed')`,
    ),
    check(
      "auth_security_timeline_category_check",
      sql`category in ('api_key','auth','authorization','incident','identity','jwt','mfa','oauth','policy','refresh_token','risk','session')`,
    ),
    check("auth_security_timeline_severity_check", sql`severity in ('info','warning','critical')`),
    check(
      "auth_security_timeline_occurred_at_check",
      sql`typeof(occurred_at) = 'integer' and occurred_at between 0 and 9007199254740991`,
    ),
    check(
      "auth_security_timeline_summary_check",
      sql`typeof(summary) = 'text' and length(cast(summary as blob)) between 1 and 128`,
    ),
    check(
      "auth_security_timeline_metadata_check",
      sql`metadata is null or (json_valid(metadata) = 1 and length(cast(metadata as blob)) <= 16384)`,
    ),
    check(
      "auth_security_timeline_canonical_event_check",
      sql`json_valid(canonical_event) = 1 and json_extract(canonical_event, '$.id') is id and json_extract(canonical_event, '$.userId') is user_id and json_extract(canonical_event, '$.type') is type and json_extract(canonical_event, '$.category') is category and json_extract(canonical_event, '$.severity') is severity and json_extract(canonical_event, '$.occurredAt') is occurred_at and json_extract(canonical_event, '$.summary') is summary`,
    ),
    check("auth_security_timeline_normalization_version_check", sql`normalization_version = 1`),
    check(
      "auth_security_timeline_event_bytes_check",
      sql`typeof(event_bytes) = 'integer' and event_bytes between 1 and 32768 and event_bytes = length(cast(canonical_event as blob))`,
    ),
    check(
      "auth_security_timeline_metadata_bytes_check",
      sql`typeof(metadata_bytes) = 'integer' and metadata_bytes between 0 and 16384`,
    ),
    check(
      "auth_security_timeline_state_check",
      sql`(metadata is null and canonical_metadata is null and metadata_bytes = 0) or (metadata is not null and canonical_metadata = metadata and json_valid(canonical_metadata) = 1 and metadata_bytes = length(cast(canonical_metadata as blob)))`,
    ),
    index("auth_security_timeline_user_occurred_at_idx").on(t.userId, t.occurredAt, t.id),
    index("auth_security_timeline_occurred_at_idx").on(t.occurredAt, t.id),
    index("auth_security_timeline_user_type_idx").on(t.userId, t.type, t.occurredAt, t.id),
    index("auth_security_timeline_user_category_idx").on(t.userId, t.category, t.occurredAt, t.id),
  ],
);
