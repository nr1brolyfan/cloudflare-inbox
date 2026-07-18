-- Generated from @effect-auth/core@0.1.0-alpha.19.
-- Do not edit manually; run `bun run generate:auth-migrations`.

create table if not exists auth_oauth_provider_token_vault (
  account_id text primary key,
  user_id text not null,
  provider_id text not null,
  provider_account_id text not null,
  access_token_ciphertext text not null,
  refresh_token_ciphertext text,
  id_token_ciphertext text,
  token_type text not null,
  scopes text,
  expires_at integer,
  updated_at integer not null,
  revoked_at integer,
  revocation_reason text
);

create index if not exists auth_oauth_provider_token_vault_user_id_idx on auth_oauth_provider_token_vault (user_id);
create index if not exists auth_oauth_provider_token_vault_provider_account_idx on auth_oauth_provider_token_vault (provider_id, provider_account_id);
create index if not exists auth_oauth_provider_token_vault_expires_at_idx on auth_oauth_provider_token_vault (expires_at);
create index if not exists auth_oauth_provider_token_vault_revoked_at_idx on auth_oauth_provider_token_vault (revoked_at);
