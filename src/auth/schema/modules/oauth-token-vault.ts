// Generated from @effect-auth/core@0.1.0-alpha.20.
// Do not edit manually; run `bun run generate:auth-schema`.

import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

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

export const authOauthProviderTokenRevocationOutbox = sqliteTable(
  "auth_oauth_provider_token_revocation_outbox",
  {
    id: text("id").notNull(),
    accountId: text("account_id").notNull(),
    userId: text("user_id").notNull(),
    providerId: text("provider_id").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    accessTokenCiphertext: text("access_token_ciphertext"),
    refreshTokenCiphertext: text("refresh_token_ciphertext"),
    leaseId: text("lease_id"),
    leaseExpiresAt: integer("lease_expires_at"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    primaryKey({ name: "auth_oauth_provider_token_revocation_outbox_pkey", columns: [t.id] }),
    check(
      "auth_oauth_provider_token_revocation_outbox_token_check",
      sql`access_token_ciphertext is not null or refresh_token_ciphertext is not null`,
    ),
    check(
      "auth_oauth_provider_token_revocation_outbox_lease_check",
      sql`(lease_id is null) = (lease_expires_at is null)`,
    ),
    index("auth_oauth_provider_token_revocation_outbox_account_idx").on(t.accountId, t.createdAt),
    index("auth_oauth_provider_token_revocation_outbox_provider_idx").on(t.providerId, t.createdAt),
  ],
);
