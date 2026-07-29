// Generated from @effect-auth/core@0.1.0-alpha.20.
// Do not edit manually; run `bun run generate:auth-schema`.

import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const authApiKey = sqliteTable(
  "auth_api_key",
  {
    id: text("id").notNull(),
    userId: text("user_id").notNull(),
    prefix: text("prefix").notNull(),
    secretHash: text("secret_hash").notNull(),
    scopes: text("scopes").notNull(),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at"),
    lastUsedAt: integer("last_used_at"),
    revokedAt: integer("revoked_at"),
    metadata: text("metadata"),
  },
  (t) => [
    primaryKey({ name: "auth_api_key_pkey", columns: [t.id] }),
    uniqueIndex("auth_api_key_prefix_idx").on(t.prefix),
    index("auth_api_key_user_id_idx").on(t.userId),
    index("auth_api_key_expires_at_idx").on(t.expiresAt),
    index("auth_api_key_revoked_at_idx").on(t.revokedAt),
  ],
);
