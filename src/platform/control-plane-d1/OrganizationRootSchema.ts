import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

/** Stable tenant-root table shared by collaborating control-plane schemas. */
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
