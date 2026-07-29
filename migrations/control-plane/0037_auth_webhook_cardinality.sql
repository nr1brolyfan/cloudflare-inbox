-- Generated from @effect-auth/core@0.1.0-alpha.20.
-- Do not edit manually; run `bun run generate:auth-migrations`.

create table if not exists auth_webhook_outbox_quarantine (
  id text, endpoint_key text, event text, status text, attempts integer,
  next_attempt_at integer, created_at integer, updated_at integer,
  delivered_at integer, last_error text, reason text not null
);
insert into auth_webhook_outbox_quarantine
select id, endpoint_key, event, status, attempts, next_attempt_at, created_at, updated_at, delivered_at, last_error, 'requires-runtime-normalization' from auth_webhook_outbox;
alter table auth_webhook_outbox rename to auth_webhook_outbox_unconstrained;
create table auth_webhook_outbox (
  id text primary key check (typeof(id) = 'text' and length(cast(id as blob)) between 1 and 256),
  endpoint_key text not null check (typeof(endpoint_key) = 'text' and length(cast(endpoint_key as blob)) between 1 and 128 and substr(endpoint_key, 1, 1) glob '[A-Za-z0-9]' and endpoint_key not glob '*[^A-Za-z0-9_.:-]*'),
  event text not null,
  status text not null check (status in ('pending', 'failed', 'delivered', 'dead_lettered')),
  attempts integer not null check (typeof(attempts) = 'integer' and attempts between 0 and 100),
  next_attempt_at integer not null check (typeof(next_attempt_at) = 'integer' and next_attempt_at between 0 and 9007199254740991),
  created_at integer not null check (typeof(created_at) = 'integer' and created_at between 0 and 9007199254740991),
  updated_at integer not null check (typeof(updated_at) = 'integer' and updated_at between 0 and 9007199254740991),
  delivered_at integer check (delivered_at is null or (typeof(delivered_at) = 'integer' and delivered_at between 0 and 9007199254740991)),
  last_error text check (last_error is null or last_error in ('endpoint_not_found', 'endpoint_resolution_failed', 'dispatch_failed', 'max_attempts', 'invalid_retry')),
  canonical_event text not null check (json_valid(canonical_event) = 1 and event = canonical_event),
  canonical_payload text not null check (json_valid(canonical_payload) = 1 and json_extract(canonical_payload, '$') is json_extract(canonical_event, '$.payload')),
  normalization_version integer not null check (normalization_version = 1),
  event_bytes integer not null check (typeof(event_bytes) = 'integer' and event_bytes between 1 and 98304 and event_bytes = length(cast(canonical_event as blob))),
  payload_bytes integer not null check (typeof(payload_bytes) = 'integer' and payload_bytes between 1 and 65536 and payload_bytes = length(cast(canonical_payload as blob))),
  check (json_extract(canonical_event, '$.id') is not null and length(cast(json_extract(canonical_event, '$.id') as blob)) between 1 and 256),
  check (json_extract(canonical_event, '$.type') is not null and length(cast(json_extract(canonical_event, '$.type') as blob)) between 1 and 128),
  check (json_extract(canonical_event, '$.occurredAt') between 0 and 9007199254740991),
  check ((status = 'delivered' and delivered_at is not null and last_error is null) or (status != 'delivered' and delivered_at is null))
);
drop table auth_webhook_outbox_unconstrained;
create index auth_webhook_outbox_due_idx on auth_webhook_outbox (next_attempt_at, status);
create index auth_webhook_outbox_endpoint_due_idx on auth_webhook_outbox (endpoint_key, next_attempt_at);
create index auth_webhook_outbox_status_idx on auth_webhook_outbox (status);
create table if not exists auth_webhook_replay_quarantine (id text, expires_at integer, created_at integer, reason text not null);
insert into auth_webhook_replay_quarantine select id, expires_at, created_at, 'requires-runtime-normalization' from auth_webhook_replay;
alter table auth_webhook_replay rename to auth_webhook_replay_unconstrained;
create table auth_webhook_replay (
  id text primary key check (typeof(id) = 'text' and length(cast(id as blob)) between 1 and 256),
  expires_at integer not null check (typeof(expires_at) = 'integer' and expires_at between 0 and 9007199254740991),
  created_at integer not null check (typeof(created_at) = 'integer' and created_at between 0 and 9007199254740991),
  check (expires_at > created_at)
);
drop table auth_webhook_replay_unconstrained;
create index auth_webhook_replay_expires_at_idx on auth_webhook_replay (expires_at);
