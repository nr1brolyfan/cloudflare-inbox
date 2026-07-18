-- Generated from @effect-auth/core@0.1.0-alpha.19.
-- Do not edit manually; run `bun run generate:auth-migrations`.

create table if not exists auth_oauth_account (
  id text primary key,
  provider_id text not null,
  provider_account_id text not null,
  user_id text not null,
  email text,
  email_verified integer,
  created_at integer not null,
  updated_at integer not null,
  unlinked_at integer,
  metadata text
);

create unique index if not exists auth_oauth_account_provider_account_idx on auth_oauth_account (provider_id, provider_account_id);
create index if not exists auth_oauth_account_user_id_idx on auth_oauth_account (user_id);
create index if not exists auth_oauth_account_unlinked_at_idx on auth_oauth_account (unlinked_at);
