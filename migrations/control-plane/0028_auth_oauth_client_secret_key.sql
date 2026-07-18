-- Generated from @effect-auth/core@0.1.0-alpha.19.
-- Do not edit manually; run `bun run generate:auth-migrations`.

alter table auth_oauth_client_secret rename to auth_oauth_client_secret_legacy;

create table auth_oauth_client_secret (
  prefix text not null,
  client_id text not null,
  secret_hash text not null,
  authentication_methods text not null,
  created_at integer not null,
  expires_at integer,
  last_used_at integer,
  revoked_at integer,
  metadata text,
  primary key (client_id, prefix)
);

insert into auth_oauth_client_secret (
  prefix,
  client_id,
  secret_hash,
  authentication_methods,
  created_at,
  expires_at,
  last_used_at,
  revoked_at,
  metadata
)
select
  prefix,
  client_id,
  secret_hash,
  authentication_methods,
  created_at,
  expires_at,
  last_used_at,
  revoked_at,
  metadata
from auth_oauth_client_secret_legacy;

drop table auth_oauth_client_secret_legacy;
