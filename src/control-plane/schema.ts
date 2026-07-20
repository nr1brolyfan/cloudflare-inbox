import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const appMailbox = sqliteTable(
  "app_mailbox",
  {
    id: text("id").notNull(),
    displayName: text("display_name").notNull(),
    status: text("status", {
      enum: ["active", "suspended", "deleting", "deleted"],
    })
      .notNull()
      .default("active"),
    createdByUserId: text("created_by_user_id").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    deletedAt: integer("deleted_at"),
    version: integer("version").notNull().default(1),
  },
  (t) => [
    primaryKey({ name: "app_mailbox_pkey", columns: [t.id] }),
    check("app_mailbox_id_check", sql`length(id) between 1 and 128`),
    check(
      "app_mailbox_display_name_check",
      sql`length(display_name) between 1 and 200`
    ),
    check(
      "app_mailbox_status_check",
      sql`status in ('active', 'suspended', 'deleting', 'deleted')`
    ),
    check(
      "app_mailbox_created_by_user_id_check",
      sql`length(created_by_user_id) between 1 and 128`
    ),
    check("app_mailbox_created_at_check", sql`created_at >= 0`),
    check("app_mailbox_updated_at_check", sql`updated_at >= created_at`),
    check(
      "app_mailbox_deleted_at_check",
      sql`deleted_at is null or deleted_at >= created_at`
    ),
    check("app_mailbox_version_check", sql`version >= 1`),
    check(
      "app_mailbox_deleted_state",
      sql`(status = 'deleted' and deleted_at is not null)
        or (status <> 'deleted' and deleted_at is null)`
    ),
    index("app_mailbox_active_idx")
      .on(t.status, t.id)
      .where(sql`deleted_at is null`),
    index("app_mailbox_creator_idx").on(t.createdByUserId, t.createdAt),
    uniqueIndex("app_mailbox_singleton_idx").on(sql`(1)`),
  ]
);

export const appMailboxAddress = sqliteTable(
  "app_mailbox_address",
  {
    mailboxId: text("mailbox_id")
      .notNull()
      .references(() => appMailbox.id, { onDelete: "cascade" }),
    id: text("id").notNull(),
    address: text("address").notNull(),
    normalizedAddress: text("normalized_address").notNull(),
    displayName: text("display_name"),
    isPrimary: integer("is_primary", { mode: "boolean" })
      .notNull()
      .default(false),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    version: integer("version").notNull().default(1),
  },
  (t) => [
    primaryKey({
      name: "app_mailbox_address_pkey",
      columns: [t.mailboxId, t.id],
    }),
    check("app_mailbox_address_id_check", sql`length(id) between 1 and 128`),
    check(
      "app_mailbox_address_address_check",
      sql`length(address) between 3 and 320 and address = trim(address)`
    ),
    check(
      "app_mailbox_address_normalized_address_check",
      sql`length(normalized_address) between 3 and 320
        and normalized_address = trim(normalized_address)`
    ),
    check("app_mailbox_address_primary_check", sql`is_primary in (0, 1)`),
    check("app_mailbox_address_enabled_check", sql`enabled in (0, 1)`),
    check("app_mailbox_address_created_at_check", sql`created_at >= 0`),
    check(
      "app_mailbox_address_updated_at_check",
      sql`updated_at >= created_at`
    ),
    check("app_mailbox_address_version_check", sql`version >= 1`),
    check(
      "app_mailbox_address_primary_enabled",
      sql`is_primary = 0 or enabled = 1`
    ),
    uniqueIndex("app_mailbox_address_route_idx").on(t.normalizedAddress),
    uniqueIndex("app_mailbox_address_primary_idx")
      .on(t.mailboxId)
      .where(sql`${t.isPrimary} = 1`),
  ]
);

export const appMailboxMember = sqliteTable(
  "app_mailbox_member",
  {
    mailboxId: text("mailbox_id")
      .notNull()
      .references(() => appMailbox.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    revokedAt: integer("revoked_at"),
  },
  (t) => [
    primaryKey({
      name: "app_mailbox_member_pkey",
      columns: [t.mailboxId, t.userId],
    }),
    check(
      "app_mailbox_member_user_id_check",
      sql`length(user_id) between 1 and 128`
    ),
    check("app_mailbox_member_created_at_check", sql`created_at >= 0`),
    check("app_mailbox_member_updated_at_check", sql`updated_at >= created_at`),
    check(
      "app_mailbox_member_revoked_at_check",
      sql`revoked_at is null or revoked_at >= created_at`
    ),
    index("app_mailbox_member_user_active_idx")
      .on(t.userId, t.mailboxId)
      .where(sql`revoked_at is null`),
  ]
);

export const appUserPreference = sqliteTable(
  "app_user_preference",
  {
    userId: text("user_id").notNull(),
    defaultMailboxId: text("default_mailbox_id").references(
      () => appMailbox.id,
      {
        onDelete: "set null",
      }
    ),
    settingsJson: text("settings_json").notNull().default("{}"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    version: integer("version").notNull().default(1),
  },
  (t) => [
    primaryKey({ name: "app_user_preference_pkey", columns: [t.userId] }),
    check(
      "app_user_preference_user_id_check",
      sql`length(user_id) between 1 and 128`
    ),
    check(
      "app_user_preference_settings_json_check",
      sql`length(settings_json) <= 65536
        and json_valid(settings_json)
        and json_type(settings_json) = 'object'`
    ),
    check("app_user_preference_created_at_check", sql`created_at >= 0`),
    check(
      "app_user_preference_updated_at_check",
      sql`updated_at >= created_at`
    ),
    check("app_user_preference_version_check", sql`version >= 1`),
  ]
);

export const appAuthorizationGuard = sqliteTable(
  "app_authorization_guard",
  {
    nonce: text("nonce").notNull(),
  },
  (t) => [
    primaryKey({ name: "app_authorization_guard_pkey", columns: [t.nonce] }),
    check(
      "app_authorization_guard_nonce_check",
      sql`length(nonce) between 1 and 128`
    ),
  ]
);

export const appDevEmailMessage = sqliteTable(
  "app_dev_email_message",
  {
    id: text("id").notNull(),
    kind: text("kind").notNull(),
    recipient: text("recipient").notNull(),
    messageJson: text("message_json").notNull(),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (t) => [
    primaryKey({ name: "app_dev_email_message_pkey", columns: [t.id] }),
    index("app_dev_email_message_created_at_idx").on(sql`${t.createdAt} desc`),
    index("app_dev_email_message_recipient_created_at_idx").on(
      t.recipient,
      sql`${t.createdAt} desc`
    ),
  ]
);

export const appAiToolAudit = sqliteTable(
  "app_ai_tool_audit",
  {
    id: text("id").primaryKey(),
    principalType: text("principal_type").notNull(),
    principalId: text("principal_id").notNull(),
    mailboxId: text("mailbox_id").notNull(),
    source: text("source", { enum: ["interactive-session"] }).notNull(),
    runId: text("run_id").notNull(),
    callId: text("call_id").notNull(),
    toolName: text("tool_name").notNull(),
    toolKind: text("tool_kind", {
      enum: ["mutation", "read", "unknown"],
    }).notNull(),
    outcome: text("outcome", {
      enum: ["failed", "rejected", "succeeded"],
    }).notNull(),
    reason: text("reason").notNull(),
    recordedAt: integer("recorded_at").notNull(),
    retainUntil: integer("retain_until").notNull(),
  },
  (t) => [
    check(
      "app_ai_tool_audit_id_check",
      sql`length(id) = 85
        and substr(id, 1, 21) = 'ai-tool-audit-sha256:'
        and substr(id, 22) not glob '*[^0-9a-f]*'`
    ),
    check(
      "app_ai_tool_audit_principal_type_check",
      sql`length(principal_type) between 1 and 64`
    ),
    check(
      "app_ai_tool_audit_principal_id_check",
      sql`length(principal_id) between 1 and 256`
    ),
    check(
      "app_ai_tool_audit_mailbox_id_check",
      sql`length(mailbox_id) between 1 and 128`
    ),
    check(
      "app_ai_tool_audit_source_check",
      sql`source = 'interactive-session'`
    ),
    check(
      "app_ai_tool_audit_run_id_check",
      sql`length(run_id) between 1 and 128`
    ),
    check(
      "app_ai_tool_audit_call_id_check",
      sql`length(call_id) between 1 and 128`
    ),
    check(
      "app_ai_tool_audit_tool_name_check",
      sql`length(tool_name) between 1 and 64`
    ),
    check(
      "app_ai_tool_audit_tool_kind_check",
      sql`tool_kind in ('mutation', 'read', 'unknown')`
    ),
    check(
      "app_ai_tool_audit_outcome_check",
      sql`outcome in ('failed', 'rejected', 'succeeded')`
    ),
    check(
      "app_ai_tool_audit_reason_check",
      sql`length(reason) between 1 and 64`
    ),
    check("app_ai_tool_audit_recorded_at_check", sql`recorded_at >= 0`),
    check(
      "app_ai_tool_audit_retain_until_check",
      sql`retain_until > recorded_at`
    ),
    index("app_ai_tool_audit_retention_idx").on(t.retainUntil),
    index("app_ai_tool_audit_mailbox_time_idx").on(
      t.mailboxId,
      sql`${t.recordedAt} desc`
    ),
  ]
);
