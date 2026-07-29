-- Generated from @effect-auth/core@0.1.0-alpha.20.
-- Do not edit manually; run `bun run generate:auth-migrations`.

alter table auth_oauth_provider_mode_token add column family_id text;

create index if not exists auth_oauth_provider_mode_token_family_id_idx on auth_oauth_provider_mode_token (family_id);

create table if not exists auth_oauth_provider_mode_refresh_family (
  family_id text primary key,
  client_id text not null,
  subject text not null,
  created_at integer not null,
  expires_at integer not null,
  version integer not null default 0,
  revoked_at integer,
  reuse_detected_at integer,
  revocation_reason text,
  metadata text,
  constraint auth_oauth_provider_mode_refresh_family_version_check check (version >= 0),
  constraint auth_oauth_provider_mode_refresh_family_expiry_check check (expires_at > created_at),
  constraint auth_oauth_provider_mode_refresh_family_reuse_check check (reuse_detected_at is null or revoked_at is not null)
);

create index if not exists auth_oauth_provider_mode_refresh_family_client_idx on auth_oauth_provider_mode_refresh_family (client_id);
create index if not exists auth_oauth_provider_mode_refresh_family_subject_idx on auth_oauth_provider_mode_refresh_family (subject);
create index if not exists auth_oauth_provider_mode_refresh_family_expires_at_idx on auth_oauth_provider_mode_refresh_family (expires_at);
create index if not exists auth_oauth_provider_mode_refresh_family_revoked_at_idx on auth_oauth_provider_mode_refresh_family (revoked_at);
