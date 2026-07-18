-- Generated from @effect-auth/core@0.1.0-alpha.18.
-- Do not edit manually; run `bun run generate:auth-migrations`.

create table if not exists auth_api_key (
  id text primary key,
  user_id text not null,
  prefix text not null,
  secret_hash text not null,
  scopes text not null,
  created_at integer not null,
  expires_at integer,
  last_used_at integer,
  revoked_at integer,
  metadata text
);

create unique index if not exists auth_api_key_prefix_idx on auth_api_key (prefix);
create index if not exists auth_api_key_user_id_idx on auth_api_key (user_id);
create index if not exists auth_api_key_expires_at_idx on auth_api_key (expires_at);
create index if not exists auth_api_key_revoked_at_idx on auth_api_key (revoked_at);
