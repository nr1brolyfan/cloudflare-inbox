-- Generated from @effect-auth/core@0.1.0-alpha.19.
-- Do not edit manually; run `bun run generate:auth-migrations`.

create table if not exists auth_session (
  id text primary key,
  user_id text not null,
  secret_hash text not null,
  created_at integer not null,
  expires_at integer not null,
  auth_time integer not null,
  authentication_events text not null,
  aal text not null,
  amr text not null,
  mfa_verified_at integer,
  metadata text,
  revoked_at integer,
  last_seen_at integer,
  rotated_at integer
);

create index if not exists auth_session_user_id_idx on auth_session (user_id);
create index if not exists auth_session_expires_at_idx on auth_session (expires_at);

create table if not exists auth_verification (
  id text primary key,
  type text not null,
  subject text not null,
  secret_hash text,
  created_at integer not null,
  expires_at integer not null,
  metadata text,
  consumed_at integer
);

create index if not exists auth_verification_type_subject_idx on auth_verification (type, subject);
create index if not exists auth_verification_expires_at_idx on auth_verification (expires_at);
