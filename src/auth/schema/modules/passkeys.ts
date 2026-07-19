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

export const authPasskeyCredential = sqliteTable(
  "auth_passkey_credential",
  {
    id: text("id").notNull(),
    userId: text("user_id").notNull(),
    credentialId: text("credential_id").notNull(),
    publicKey: text("public_key").notNull(),
    signCount: integer("sign_count").notNull(),
    transports: text("transports"),
    backedUp: integer("backed_up"),
    createdAt: integer("created_at").notNull(),
    lastUsedAt: integer("last_used_at"),
    revokedAt: integer("revoked_at"),
    metadata: text("metadata"),
  },
  (t) => [
    primaryKey({ name: "auth_passkey_credential_pkey", columns: [t.id] }),
    uniqueIndex("auth_passkey_credential_credential_id_idx").on(t.credentialId),
    index("auth_passkey_credential_user_id_idx").on(t.userId),
    index("auth_passkey_credential_revoked_at_idx").on(t.revokedAt),
  ],
);
