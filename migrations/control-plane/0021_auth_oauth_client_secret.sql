-- Generated from @effect-auth/core@0.1.0-alpha.18.
-- Do not edit manually; run `bun run generate:auth-migrations`.

create table if not exists auth_oauth_client_secret (
  prefix text primary key,
  client_id text not null,
  secret_hash text not null,
  authentication_methods text not null,
  created_at integer not null,
  expires_at integer,
  last_used_at integer,
  revoked_at integer,
  metadata text
);

create index if not exists auth_oauth_client_secret_client_prefix_idx on auth_oauth_client_secret (client_id, prefix);
create index if not exists auth_oauth_client_secret_client_id_idx on auth_oauth_client_secret (client_id);
