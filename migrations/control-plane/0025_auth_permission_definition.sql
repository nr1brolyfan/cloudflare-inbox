-- Generated from @effect-auth/core@0.1.0-alpha.19.
-- Do not edit manually; run `bun run generate:auth-migrations`.

create table if not exists auth_permission_definition (
  id text primary key,
  description text,
  scope_type_present integer not null,
  scope_type text not null,
  created_at integer not null,
  updated_at integer not null,
  disabled_at integer,
  deleted_at integer
);

create table if not exists auth_role_definition (
  id text primary key,
  description text,
  created_at integer not null,
  updated_at integer not null,
  disabled_at integer,
  deleted_at integer
);
