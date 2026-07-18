-- Generated from @effect-auth/core@0.1.0-alpha.19.
-- Do not edit manually; run `bun run generate:auth-migrations`.

create table if not exists auth_jwt_revocation (
  jwt_id text primary key,
  revoked_at integer not null,
  expires_at integer,
  reason text
);

create index if not exists auth_jwt_revocation_expires_at_idx on auth_jwt_revocation (expires_at);
