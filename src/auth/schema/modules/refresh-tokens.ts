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

export const authRefreshToken = sqliteTable(
  "auth_refresh_token",
  {
    id: text("id").notNull(),
    familyId: text("family_id").notNull(),
    userId: text("user_id").notNull(),
    secretHash: text("secret_hash").notNull(),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    lastUsedAt: integer("last_used_at"),
    rotatedAt: integer("rotated_at"),
    replacedById: text("replaced_by_id"),
    revokedAt: integer("revoked_at"),
    reuseDetectedAt: integer("reuse_detected_at"),
    metadata: text("metadata"),
  },
  (t) => [
    primaryKey({ name: "auth_refresh_token_pkey", columns: [t.id] }),
    uniqueIndex("auth_refresh_token_secret_hash_idx").on(t.secretHash),
    index("auth_refresh_token_family_id_idx").on(t.familyId),
    index("auth_refresh_token_user_id_idx").on(t.userId),
    index("auth_refresh_token_expires_at_idx").on(t.expiresAt),
    index("auth_refresh_token_rotated_at_idx").on(t.rotatedAt),
    index("auth_refresh_token_revoked_at_idx").on(t.revokedAt),
  ],
);
