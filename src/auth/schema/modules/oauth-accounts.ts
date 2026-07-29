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

export const authOauthAccount = sqliteTable(
  "auth_oauth_account",
  {
    id: text("id").notNull(),
    providerId: text("provider_id").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    userId: text("user_id").notNull(),
    email: text("email"),
    emailVerified: integer("email_verified"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    unlinkedAt: integer("unlinked_at"),
    metadata: text("metadata"),
  },
  (t) => [
    primaryKey({ name: "auth_oauth_account_pkey", columns: [t.id] }),
    uniqueIndex("auth_oauth_account_provider_account_idx").on(t.providerId, t.providerAccountId),
    index("auth_oauth_account_user_id_idx").on(t.userId),
    index("auth_oauth_account_unlinked_at_idx").on(t.unlinkedAt),
  ],
);
