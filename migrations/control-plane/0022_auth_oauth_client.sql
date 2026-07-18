-- Generated from @effect-auth/core@0.1.0-alpha.19.
-- Do not edit manually; run `bun run generate:auth-migrations`.

create table if not exists auth_oauth_client (
  id text primary key,
  type text not null,
  status text not null,
  name text,
  redirect_uris text not null,
  allowed_grant_types text not null,
  allowed_response_types text not null,
  allowed_scopes text,
  created_at integer,
  updated_at integer,
  metadata text
);

create index if not exists auth_oauth_client_status_idx on auth_oauth_client (status);
