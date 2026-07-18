-- Generated from @effect-auth/core@0.1.0-alpha.19.
-- Do not edit manually; run `bun run generate:auth-migrations`.

create table if not exists auth_user (
  id text primary key,
  email text not null,
  email_verified integer not null,
  created_at integer not null,
  updated_at integer not null,
  disabled_at integer,
  metadata text
);

create unique index if not exists auth_user_email_idx on auth_user (email);

create table if not exists auth_credential (
  id text primary key,
  user_id text not null,
  type text not null,
  password_hash text,
  created_at integer not null,
  updated_at integer not null,
  revoked_at integer,
  metadata text
);

create index if not exists auth_credential_user_id_idx on auth_credential (user_id);
create unique index if not exists auth_credential_user_type_idx on auth_credential (user_id, type);
