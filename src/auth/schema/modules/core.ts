// Generated from @effect-auth/core@0.1.0-alpha.20.
// Do not edit manually; run `bun run generate:auth-schema`.

import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const authUser = sqliteTable(
  "auth_user",
  {
    id: text("id").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    disabledAt: integer("disabled_at"),
    metadata: text("metadata"),
  },
  (t) => [primaryKey({ name: "auth_user_pkey", columns: [t.id] })],
);

export const authUserIdentity = sqliteTable(
  "auth_user_identity",
  {
    id: text("id").notNull(),
    userId: text("user_id").notNull(),
    scopeType: text("scope_type").notNull(),
    scopeId: text("scope_id").notNull(),
    kind: text("kind").notNull(),
    value: text("value").notNull(),
    normalizedValue: text("normalized_value").notNull(),
    verifiedAt: integer("verified_at"),
    isPrimaryLogin: integer("is_primary_login").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    revokedAt: integer("revoked_at"),
    replacedById: text("replaced_by_id"),
    metadata: text("metadata"),
  },
  (t) => [
    primaryKey({ name: "auth_user_identity_pkey", columns: [t.id] }),
    uniqueIndex("auth_user_identity_active_value_idx")
      .on(t.scopeType, t.scopeId, t.kind, t.normalizedValue)
      .where(sql`revoked_at is null`),
    index("auth_user_identity_user_id_idx").on(t.userId),
    index("auth_user_identity_replaced_by_id_idx").on(t.replacedById),
    uniqueIndex("auth_user_identity_active_primary_idx")
      .on(t.userId)
      .where(sql`revoked_at is null and is_primary_login = 1`),
  ],
);
