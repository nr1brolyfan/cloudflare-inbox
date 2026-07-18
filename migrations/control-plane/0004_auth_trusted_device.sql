-- Generated from @effect-auth/core@0.1.0-alpha.18.
-- Do not edit manually; run `bun run generate:auth-migrations`.

create table if not exists auth_trusted_device (
  user_id text not null,
  token_hash text not null,
  created_at integer not null,
  last_seen_at integer not null,
  expires_at integer not null,
  metadata text,
  primary key (user_id, token_hash)
);

create index if not exists auth_trusted_device_user_id_idx on auth_trusted_device (user_id);
create index if not exists auth_trusted_device_expires_at_idx on auth_trusted_device (expires_at);
