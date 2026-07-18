-- Generated from @effect-auth/core@0.1.0-alpha.18.
-- Do not edit manually; run `bun run generate:auth-migrations`.

create table if not exists auth_domain_verification (
  id text primary key,
  owner_id text not null,
  domain text not null,
  proof_method text not null,
  proof_token text not null,
  status text not null,
  created_at integer not null,
  expires_at integer not null,
  verified_at integer,
  revoked_at integer,
  last_checked_at integer,
  metadata text
);

create unique index if not exists auth_domain_verification_owner_domain_idx on auth_domain_verification (owner_id, domain);
create index if not exists auth_domain_verification_domain_idx on auth_domain_verification (domain);
create index if not exists auth_domain_verification_status_expires_at_idx on auth_domain_verification (status, expires_at);
