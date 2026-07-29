-- Generated from @effect-auth/core@0.1.0-alpha.20.
-- Do not edit manually; run `bun run generate:auth-migrations`.

create table if not exists auth_oauth_provider_token_revocation_outbox (
  id text primary key,
  account_id text not null,
  user_id text not null,
  provider_id text not null,
  provider_account_id text not null,
  access_token_ciphertext text,
  refresh_token_ciphertext text,
  lease_id text,
  lease_expires_at integer,
  created_at integer not null,
  constraint auth_oauth_provider_token_revocation_outbox_token_check check (access_token_ciphertext is not null or refresh_token_ciphertext is not null),
  constraint auth_oauth_provider_token_revocation_outbox_lease_check check ((lease_id is null) = (lease_expires_at is null))
);
create index if not exists auth_oauth_provider_token_revocation_outbox_account_idx on auth_oauth_provider_token_revocation_outbox (account_id, created_at);
create index if not exists auth_oauth_provider_token_revocation_outbox_provider_idx on auth_oauth_provider_token_revocation_outbox (provider_id, created_at);
