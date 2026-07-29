// Generated from @effect-auth/core@0.1.0-alpha.20.
// Do not edit manually; run `bun run generate:auth-schema`.

import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const authSession = sqliteTable(
  "auth_session",
  {
    id: text("id").notNull(),
    userId: text("user_id").notNull(),
    secretHash: text("secret_hash").notNull(),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    authTime: integer("auth_time").notNull(),
    authenticationEvents: text("authentication_events").notNull(),
    aal: text("aal").notNull(),
    amr: text("amr").notNull(),
    mfaVerifiedAt: integer("mfa_verified_at"),
    metadata: text("metadata"),
    revokedAt: integer("revoked_at"),
    lastSeenAt: integer("last_seen_at"),
    rotatedAt: integer("rotated_at"),
  },
  (t) => [
    primaryKey({ name: "auth_session_pkey", columns: [t.id] }),
    index("auth_session_user_id_idx").on(t.userId),
    index("auth_session_expires_at_idx").on(t.expiresAt),
  ],
);
