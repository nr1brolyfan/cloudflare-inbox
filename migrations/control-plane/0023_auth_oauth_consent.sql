-- Generated from @effect-auth/core@0.1.0-alpha.19.
-- Do not edit manually; run `bun run generate:auth-migrations`.

create table if not exists auth_oauth_consent (
  id text primary key,
  user_id text not null,
  client_id text not null,
  scopes text not null,
  granted_at integer not null,
  expires_at integer,
  revoked_at integer,
  metadata text
);

create unique index if not exists auth_oauth_consent_user_client_idx on auth_oauth_consent (user_id, client_id);
create index if not exists auth_oauth_consent_user_id_idx on auth_oauth_consent (user_id);
create index if not exists auth_oauth_consent_expires_at_idx on auth_oauth_consent (expires_at);
create index if not exists auth_oauth_consent_revoked_at_idx on auth_oauth_consent (revoked_at);
