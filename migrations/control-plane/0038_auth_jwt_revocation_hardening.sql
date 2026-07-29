-- Generated from @effect-auth/core@0.1.0-alpha.20.
-- Do not edit manually; run `bun run generate:auth-migrations`.

create table if not exists auth_jwt_revocation_quarantine (
  jwt_id text, revoked_at integer, expires_at integer, reason text, quarantine_reason text not null
);
insert into auth_jwt_revocation_quarantine select jwt_id, revoked_at, expires_at, reason, 'requires-runtime-normalization' from auth_jwt_revocation;
alter table auth_jwt_revocation rename to auth_jwt_revocation_unconstrained;
create table auth_jwt_revocation (
  jwt_id text primary key check (typeof(jwt_id) = 'text' and length(cast(jwt_id as blob)) between 1 and 256 and jwt_id not glob '*[^A-Za-z0-9._~-]*'),
  revoked_at integer not null check (typeof(revoked_at) = 'integer' and revoked_at between 0 and 9007199254740991),
  expires_at integer check (expires_at is null or (typeof(expires_at) = 'integer' and expires_at between 0 and 9007199254740991 and expires_at > revoked_at)),
  reason text check (reason is null or (typeof(reason) = 'text' and length(cast(reason as blob)) between 1 and 64 and reason not glob '*[^A-Za-z0-9._~-]*'))
);
drop table auth_jwt_revocation_unconstrained;
create index auth_jwt_revocation_expires_at_idx on auth_jwt_revocation (expires_at);
