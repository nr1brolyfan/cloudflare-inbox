-- Generated from @effect-auth/core@0.1.0-alpha.18.
-- Do not edit manually; run `bun run generate:auth-migrations`.

create table if not exists auth_refresh_token (
  id text primary key,
  family_id text not null,
  user_id text not null,
  secret_hash text not null,
  created_at integer not null,
  expires_at integer not null,
  last_used_at integer,
  rotated_at integer,
  replaced_by_id text,
  revoked_at integer,
  reuse_detected_at integer,
  metadata text
);

create unique index if not exists auth_refresh_token_secret_hash_idx on auth_refresh_token (secret_hash);
create index if not exists auth_refresh_token_family_id_idx on auth_refresh_token (family_id);
create index if not exists auth_refresh_token_user_id_idx on auth_refresh_token (user_id);
create index if not exists auth_refresh_token_expires_at_idx on auth_refresh_token (expires_at);
create index if not exists auth_refresh_token_rotated_at_idx on auth_refresh_token (rotated_at);
create index if not exists auth_refresh_token_revoked_at_idx on auth_refresh_token (revoked_at);
