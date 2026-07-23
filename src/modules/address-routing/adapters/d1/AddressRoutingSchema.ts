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

import { appMailbox } from "#/modules/organization/adapters/d1/OrganizationSchema";

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
