// Generated from @effect-auth/core@0.1.0-alpha.19.
// Do not edit manually; run `bun run generate:auth-schema`.

import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const authTotpFactor = sqliteTable(
  "auth_totp_factor",
  {
    id: text("id").notNull(),
    userId: text("user_id").notNull(),
    secret: text("secret").notNull(),
    algorithm: text("algorithm").notNull(),
    digits: integer("digits").notNull(),
    period: integer("period").notNull(),
    createdAt: integer("created_at").notNull(),
    confirmedAt: integer("confirmed_at"),
    lastUsedAt: integer("last_used_at"),
    lastAcceptedCounter: integer("last_accepted_counter"),
    revokedAt: integer("revoked_at"),
    metadata: text("metadata"),
  },
  (t) => [
    primaryKey({ name: "auth_totp_factor_pkey", columns: [t.id] }),
    index("auth_totp_factor_user_id_idx").on(t.userId),
    index("auth_totp_factor_confirmed_at_idx").on(t.confirmedAt),
    index("auth_totp_factor_revoked_at_idx").on(t.revokedAt),
  ],
);
