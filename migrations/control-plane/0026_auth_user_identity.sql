-- Generated from @effect-auth/core@0.1.0-alpha.18.
-- Do not edit manually; run `bun run generate:auth-migrations`.

create table if not exists auth_user_identity (
  id text primary key,
  user_id text not null,
  scope_type text not null,
  scope_id text not null,
  kind text not null,
  value text not null,
  normalized_value text not null,
  verified_at integer,
  is_primary_login integer not null,
  created_at integer not null,
  updated_at integer not null,
  revoked_at integer,
  replaced_by_id text,
  metadata text
);

insert into auth_user_identity (
  id,
  user_id,
  scope_type,
  scope_id,
  kind,
  value,
  normalized_value,
  verified_at,
  is_primary_login,
  created_at,
  updated_at,
  revoked_at,
  replaced_by_id,
  metadata
)
select
  'legacy-email:' || id,
  id,
  'global',
  '',
  'email',
  email,
  substr(email, 1, instr(email, '@') - 1) || lower(substr(email, instr(email, '@'))),
  case when email_verified <> 0 then updated_at else null end,
  1,
  created_at,
  updated_at,
  null,
  null,
  null
from auth_user;

drop index auth_user_email_idx;

alter table auth_user drop column email;
alter table auth_user drop column email_verified;

create unique index auth_user_identity_active_value_idx on auth_user_identity (scope_type, scope_id, kind, normalized_value) where revoked_at is null;
create index auth_user_identity_user_id_idx on auth_user_identity (user_id);
create index auth_user_identity_replaced_by_id_idx on auth_user_identity (replaced_by_id);
create unique index auth_user_identity_active_primary_idx on auth_user_identity (user_id) where revoked_at is null and is_primary_login = 1;
