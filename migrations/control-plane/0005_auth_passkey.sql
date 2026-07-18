-- Generated from @effect-auth/core@0.1.0-alpha.19.
-- Do not edit manually; run `bun run generate:auth-migrations`.

create table if not exists auth_passkey_credential (
  id text primary key,
  user_id text not null,
  credential_id text not null,
  public_key text not null,
  sign_count integer not null,
  transports text,
  backed_up integer,
  created_at integer not null,
  last_used_at integer,
  revoked_at integer,
  metadata text
);

create unique index if not exists auth_passkey_credential_credential_id_idx on auth_passkey_credential (credential_id);
create index if not exists auth_passkey_credential_user_id_idx on auth_passkey_credential (user_id);
create index if not exists auth_passkey_credential_revoked_at_idx on auth_passkey_credential (revoked_at);
