// Generated from @effect-auth/core@0.1.0-alpha.19.
// Do not edit manually; run `bun run generate:auth-schema`.

import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const authRecoveryCode = sqliteTable(
  "auth_recovery_code",
  {
    id: text("id").notNull(),
    userId: text("user_id").notNull(),
    codeHash: text("code_hash").notNull(),
    createdAt: integer("created_at").notNull(),
    usedAt: integer("used_at"),
    revokedAt: integer("revoked_at"),
    metadata: text("metadata"),
  },
  (t) => [
    primaryKey({ name: "auth_recovery_code_pkey", columns: [t.id] }),
    index("auth_recovery_code_user_id_idx").on(t.userId),
    index("auth_recovery_code_used_at_idx").on(t.usedAt),
    index("auth_recovery_code_revoked_at_idx").on(t.revokedAt),
  ],
);
