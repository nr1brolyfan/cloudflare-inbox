// Generated from @effect-auth/core@0.1.0-alpha.20.
// Do not edit manually; run `bun run generate:auth-schema`.

import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
    check(
      "auth_jwt_revocation_jwt_id_check",
      sql`typeof(jwt_id) = 'text' and length(cast(jwt_id as blob)) between 1 and 256 and jwt_id not glob '*[^A-Za-z0-9._~-]*'`,
    ),
    check(
      "auth_jwt_revocation_revoked_at_check",
      sql`typeof(revoked_at) = 'integer' and revoked_at between 0 and 9007199254740991`,
    ),
    check(
      "auth_jwt_revocation_expires_at_check",
      sql`expires_at is null or (typeof(expires_at) = 'integer' and expires_at between 0 and 9007199254740991 and expires_at > revoked_at)`,
    ),
    check(
      "auth_jwt_revocation_reason_check",
      sql`reason is null or (typeof(reason) = 'text' and length(cast(reason as blob)) between 1 and 64 and reason not glob '*[^A-Za-z0-9._~-]*')`,
    ),
    index("auth_jwt_revocation_expires_at_idx").on(t.expiresAt),
  ],
);

export const authJwtRevocationQuarantine = sqliteTable(
  "auth_jwt_revocation_quarantine",
  {
    jwtId: text("jwt_id"),
    revokedAt: integer("revoked_at"),
    expiresAt: integer("expires_at"),
    reason: text("reason"),
    quarantineReason: text("quarantine_reason").notNull(),
  },
  (_t) => [],
);
