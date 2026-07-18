-- Generated from @effect-auth/core@0.1.0-alpha.18.
-- Do not edit manually; run `bun run generate:auth-migrations`.

create table if not exists auth_totp_factor (
  id text primary key,
  user_id text not null,
  secret text not null,
  algorithm text not null,
  digits integer not null,
  period integer not null,
  created_at integer not null,
  confirmed_at integer,
  last_used_at integer,
  last_accepted_counter integer,
  revoked_at integer,
  metadata text
);

create index if not exists auth_totp_factor_user_id_idx on auth_totp_factor (user_id);
create index if not exists auth_totp_factor_confirmed_at_idx on auth_totp_factor (confirmed_at);
create index if not exists auth_totp_factor_revoked_at_idx on auth_totp_factor (revoked_at);
