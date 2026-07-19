// Generated from @effect-auth/core@0.1.0-alpha.19.
// Do not edit manually; run `bun run generate:auth-schema`.

import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const authOauthProviderTokenVault = sqliteTable(
  "auth_oauth_provider_token_vault",
  {
    accountId: text("account_id").notNull(),
    userId: text("user_id").notNull(),
    providerId: text("provider_id").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    accessTokenCiphertext: text("access_token_ciphertext").notNull(),
    refreshTokenCiphertext: text("refresh_token_ciphertext"),
    idTokenCiphertext: text("id_token_ciphertext"),
    tokenType: text("token_type").notNull(),
    scopes: text("scopes"),
    expiresAt: integer("expires_at"),
    updatedAt: integer("updated_at").notNull(),
    revokedAt: integer("revoked_at"),
    revocationReason: text("revocation_reason"),
  },
  (t) => [
    primaryKey({ name: "auth_oauth_provider_token_vault_pkey", columns: [t.accountId] }),
    index("auth_oauth_provider_token_vault_user_id_idx").on(t.userId),
    index("auth_oauth_provider_token_vault_provider_account_idx").on(
      t.providerId,
      t.providerAccountId,
    ),
    index("auth_oauth_provider_token_vault_expires_at_idx").on(t.expiresAt),
    index("auth_oauth_provider_token_vault_revoked_at_idx").on(t.revokedAt),
  ],
);
