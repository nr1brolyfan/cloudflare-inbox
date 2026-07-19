// Generated from @effect-auth/core@0.1.0-alpha.19.
// Do not edit manually; run `bun run generate:auth-schema`.

import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const authJwtRevocation = sqliteTable(
  "auth_jwt_revocation",
  {
    jwtId: text("jwt_id").notNull(),
    revokedAt: integer("revoked_at").notNull(),
    expiresAt: integer("expires_at"),
    reason: text("reason"),
  },
  (t) => [
    primaryKey({ name: "auth_jwt_revocation_pkey", columns: [t.jwtId] }),
    index("auth_jwt_revocation_expires_at_idx").on(t.expiresAt),
  ],
);
