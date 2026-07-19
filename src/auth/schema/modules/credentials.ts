// Generated from @effect-auth/core@0.1.0-alpha.19.
// Do not edit manually; run `bun run generate:auth-schema`.

import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const authCredential = sqliteTable(
  "auth_credential",
  {
    id: text("id").notNull(),
    userId: text("user_id").notNull(),
    type: text("type").notNull(),
    passwordHash: text("password_hash"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    revokedAt: integer("revoked_at"),
    metadata: text("metadata"),
  },
  (t) => [
    primaryKey({ name: "auth_credential_pkey", columns: [t.id] }),
    index("auth_credential_user_id_idx").on(t.userId),
    uniqueIndex("auth_credential_user_type_idx").on(t.userId, t.type),
  ],
);
