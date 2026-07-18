-- Generated from @effect-auth/core@0.1.0-alpha.18.
-- Do not edit manually; run `bun run generate:auth-migrations`.

create table if not exists auth_oauth_authorization_code (
  code_hash text primary key,
  client_id text not null,
  subject text not null,
  redirect_uri text not null,
  scopes text not null,
  code_challenge text,
  code_challenge_method text,
  issued_at integer not null,
  expires_at integer not null,
  consumed_at integer,
  metadata text
);

create index if not exists auth_oauth_authorization_code_client_expires_at_idx on auth_oauth_authorization_code (client_id, expires_at);
create index if not exists auth_oauth_authorization_code_expires_at_idx on auth_oauth_authorization_code (expires_at);
create index if not exists auth_oauth_authorization_code_consumed_at_idx on auth_oauth_authorization_code (consumed_at);
