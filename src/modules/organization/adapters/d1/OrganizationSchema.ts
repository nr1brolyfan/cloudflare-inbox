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

export const appOrganization = sqliteTable(
  "app_organization",
  {
    id: text("id").notNull(),
    status: text("status", { enum: ["active", "suspended"] })
      .notNull()
      .default("active"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    version: integer("version").notNull().default(1),
  },
  (t) => [
    primaryKey({ name: "app_organization_pkey", columns: [t.id] }),
    check(
      "app_organization_id_check",
      sql`typeof(id) = 'text'
        and length(id) between 1 and 128
        and length(cast(id as blob)) = length(id)
        and id not glob '*[^A-Za-z0-9_-]*'`
    ),
    check(
      "app_organization_status_check",
      sql`status in ('active', 'suspended')`
    ),
    check(
      "app_organization_created_at_check",
      sql`typeof(created_at) = 'integer'
        and created_at between 0 and 9007199254740991`
    ),
    check(
      "app_organization_updated_at_check",
      sql`typeof(updated_at) = 'integer'
        and updated_at between created_at and 9007199254740991`
    ),
    check(
      "app_organization_version_check",
      sql`typeof(version) = 'integer'
        and version between 1 and 9007199254740991`
    ),
    index("app_organization_status_idx").on(t.status, t.id),
  ]
);

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

export const appMailboxAdministrationReceipt = sqliteTable(
  "app_mailbox_administration_receipt",
  {
    operationId: text("operation_id").primaryKey(),
    operationKind: text("operation_kind", {
      enum: ["bootstrap-owner", "rename"],
    }).notNull(),
    actorUserId: text("actor_user_id").notNull(),
    mailboxId: text("mailbox_id").notNull(),
    displayName: text("display_name").notNull(),
    expectedVersion: integer("expected_version"),
    resultMailboxId: text("result_mailbox_id").notNull(),
    resultDisplayName: text("result_display_name").notNull(),
    resultStatus: text("result_status", { enum: ["active"] }).notNull(),
    resultCreatedByUserId: text("result_created_by_user_id").notNull(),
    resultCreatedAt: integer("result_created_at").notNull(),
    resultUpdatedAt: integer("result_updated_at").notNull(),
    resultVersion: integer("result_version").notNull(),
    committedAt: integer("committed_at").notNull(),
    schemaVersion: integer("schema_version").notNull(),
  },
  (t) => [
    check(
      "app_mailbox_administration_receipt_operation_id_check",
      sql`length(operation_id) = 36
        and operation_id = lower(trim(operation_id))
        and substr(operation_id, 9, 1) = '-'
        and substr(operation_id, 14, 1) = '-'
        and substr(operation_id, 15, 1) = '4'
        and substr(operation_id, 19, 1) = '-'
        and substr(operation_id, 20, 1) in ('8', '9', 'a', 'b')
        and substr(operation_id, 24, 1) = '-'
        and length(replace(operation_id, '-', '')) = 32
        and replace(operation_id, '-', '') not glob '*[^0-9a-f]*'`
    ),
    check(
      "app_mailbox_administration_receipt_kind_check",
      sql`operation_kind in ('bootstrap-owner', 'rename')`
    ),
    check(
      "app_mailbox_administration_receipt_actor_check",
      sql`length(actor_user_id) between 1 and 128
        and actor_user_id = trim(actor_user_id)`
    ),
    check(
      "app_mailbox_administration_receipt_intent_check",
      sql`length(mailbox_id) between 1 and 128
        and length(display_name) between 1 and 200
        and ((operation_kind = 'bootstrap-owner' and expected_version is null)
          or (operation_kind = 'rename' and expected_version >= 1))`
    ),
    check(
      "app_mailbox_administration_receipt_result_check",
      sql`result_mailbox_id = mailbox_id
        and result_display_name = display_name
        and result_status = 'active'
        and length(result_created_by_user_id) between 1 and 128
        and result_created_at >= 0
        and result_updated_at >= result_created_at
        and result_version >= 1
        and committed_at = result_updated_at
        and schema_version = 1`
    ),
    index("app_mailbox_administration_receipt_actor_operation_idx").on(
      t.actorUserId,
      t.operationId
    ),
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
