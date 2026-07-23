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
    index("app_mailbox_address_recovery_comparison_idx").on(
      sql`lower(${t.normalizedAddress})`
    ),
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
