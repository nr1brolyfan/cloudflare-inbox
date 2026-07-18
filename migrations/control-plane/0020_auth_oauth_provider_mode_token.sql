-- Generated from @effect-auth/core@0.1.0-alpha.19.
-- Do not edit manually; run `bun run generate:auth-migrations`.

create table if not exists auth_oauth_provider_mode_token (
  token_hash text primary key,
  token_type text not null,
  client_id text not null,
  subject text not null,
  scopes text not null,
  issued_at integer not null,
  expires_at integer not null,
  issuer text,
  audience text,
  jwt_id text,
  revoked_at integer,
  revocation_reason text,
  rotated_at integer,
  replaced_by_token_hash text,
  metadata text
);

create index if not exists auth_oauth_provider_mode_token_client_expires_at_idx on auth_oauth_provider_mode_token (client_id, expires_at);
create index if not exists auth_oauth_provider_mode_token_subject_idx on auth_oauth_provider_mode_token (subject);
create index if not exists auth_oauth_provider_mode_token_expires_at_idx on auth_oauth_provider_mode_token (expires_at);
create index if not exists auth_oauth_provider_mode_token_revoked_at_idx on auth_oauth_provider_mode_token (revoked_at);
create index if not exists auth_oauth_provider_mode_token_rotated_at_idx on auth_oauth_provider_mode_token (rotated_at);
create index if not exists auth_oauth_provider_mode_token_jwt_id_idx on auth_oauth_provider_mode_token (jwt_id);
