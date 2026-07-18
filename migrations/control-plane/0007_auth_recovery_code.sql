-- Generated from @effect-auth/core@0.1.0-alpha.18.
-- Do not edit manually; run `bun run generate:auth-migrations`.

create table if not exists auth_recovery_code (
  id text primary key,
  user_id text not null,
  code_hash text not null,
  created_at integer not null,
  used_at integer,
  revoked_at integer,
  metadata text
);

create index if not exists auth_recovery_code_user_id_idx on auth_recovery_code (user_id);
create index if not exists auth_recovery_code_used_at_idx on auth_recovery_code (used_at);
create index if not exists auth_recovery_code_revoked_at_idx on auth_recovery_code (revoked_at);
