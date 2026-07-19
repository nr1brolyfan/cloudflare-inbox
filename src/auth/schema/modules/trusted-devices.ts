// Generated from @effect-auth/core@0.1.0-alpha.19.
// Do not edit manually; run `bun run generate:auth-schema`.

import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const authTrustedDevice = sqliteTable(
  "auth_trusted_device",
  {
    userId: text("user_id").notNull(),
    tokenHash: text("token_hash").notNull(),
    createdAt: integer("created_at").notNull(),
    lastSeenAt: integer("last_seen_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    metadata: text("metadata"),
  },
  (t) => [
    primaryKey({ name: "auth_trusted_device_pkey", columns: [t.userId, t.tokenHash] }),
    index("auth_trusted_device_user_id_idx").on(t.userId),
    index("auth_trusted_device_expires_at_idx").on(t.expiresAt),
  ],
);
