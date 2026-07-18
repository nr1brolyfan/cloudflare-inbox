-- Generated from @effect-auth/core@0.1.0-alpha.18.
-- Do not edit manually; run `bun run generate:auth-migrations`.

create table if not exists auth_permission_grant (
  subject_type text not null,
  subject_id text not null,
  permission_id text not null,
  scope_type text not null,
  scope_id_present integer not null,
  scope_id text not null,
  expires_at integer,
  metadata text,
  revoked_at integer,
  primary key (subject_type, subject_id, permission_id, scope_type, scope_id_present, scope_id)
);

create index if not exists auth_permission_grant_check_idx on auth_permission_grant (subject_type, subject_id, permission_id, revoked_at, expires_at);

create table if not exists auth_role_grant (
  subject_type text not null,
  subject_id text not null,
  role_id text not null,
  scope_type text not null,
  scope_id_present integer not null,
  scope_id text not null,
  expires_at integer,
  metadata text,
  revoked_at integer,
  primary key (subject_type, subject_id, role_id, scope_type, scope_id_present, scope_id)
);

create index if not exists auth_role_grant_check_idx on auth_role_grant (subject_type, subject_id, role_id, revoked_at, expires_at);

create table if not exists auth_role_permission (
  role_id text not null,
  permission_id text not null,
  scope_type_present integer not null,
  scope_type text not null,
  primary key (role_id, permission_id, scope_type_present, scope_type)
);

create index if not exists auth_role_permission_check_idx on auth_role_permission (permission_id, role_id, scope_type_present, scope_type);
