-- Generated from @effect-auth/core@0.1.0-alpha.19.
-- Do not edit manually; run `bun run generate:auth-migrations`.

create table if not exists auth_oauth_device_authorization (
  id text primary key,
  device_code_hash text not null unique,
  user_code_hash text not null unique,
  client_id text not null,
  requested_scopes text not null check (json_valid(requested_scopes) and json_type(requested_scopes) = 'array'),
  granted_scopes text check (granted_scopes is null or (json_valid(granted_scopes) and json_type(granted_scopes) = 'array')),
  subject text,
  status text not null check (status in ('pending', 'approved', 'denied')),
  issued_at integer not null,
  expires_at integer not null,
  poll_interval_seconds integer not null check (poll_interval_seconds > 0),
  next_poll_at integer not null,
  last_polled_at integer,
  approved_at integer,
  denied_at integer,
  consumed_at integer,
  metadata text check (metadata is null or (json_valid(metadata) and json_type(metadata) = 'object')),
  check (
    (status = 'pending' and granted_scopes is null and subject is null and approved_at is null and denied_at is null and consumed_at is null)
    or (status = 'approved' and granted_scopes is not null and subject is not null and approved_at is not null and denied_at is null)
    or (status = 'denied' and granted_scopes is null and subject is null and approved_at is null and denied_at is not null and consumed_at is null)
  )
);

create index if not exists auth_oauth_device_authorization_expires_at_idx on auth_oauth_device_authorization (expires_at);
create index if not exists auth_oauth_device_authorization_client_status_expires_at_idx on auth_oauth_device_authorization (client_id, status, expires_at);
create index if not exists auth_oauth_device_authorization_status_expires_at_idx on auth_oauth_device_authorization (status, expires_at);
