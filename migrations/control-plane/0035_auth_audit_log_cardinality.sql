-- Generated from @effect-auth/core@0.1.0-alpha.20.
-- Do not edit manually; run `bun run generate:auth-migrations`.

create table if not exists auth_audit_log_quarantine (
  storage_id integer,
  id text,
  type text,
  user_id text,
  actor_user_id text,
  occurred_at integer,
  request_ip_hash text,
  request_user_agent_hash text,
  event text,
  created_at integer,
  reason text not null
);

insert into auth_audit_log_quarantine (
  storage_id, id, type, user_id, actor_user_id, occurred_at,
  request_ip_hash, request_user_agent_hash, event, created_at, reason
)
select
  storage_id, id, type, user_id, actor_user_id, occurred_at,
  request_ip_hash, request_user_agent_hash, event, created_at,
  'requires-runtime-normalization'
from auth_audit_log;

alter table auth_audit_log rename to auth_audit_log_unconstrained;

create table auth_audit_log (
  storage_id integer primary key autoincrement,
  id text check (id is null or (typeof(id) = 'text' and length(cast(id as blob)) between 1 and 256)),
  type text not null check (typeof(type) = 'text' and length(cast(type as blob)) between 1 and 128),
  user_id text check (user_id is null or (typeof(user_id) = 'text' and length(cast(user_id as blob)) between 1 and 256)),
  actor_user_id text check (actor_user_id is null or (typeof(actor_user_id) = 'text' and length(cast(actor_user_id as blob)) between 1 and 256)),
  occurred_at integer not null check (typeof(occurred_at) = 'integer' and occurred_at between 0 and 9007199254740991),
  request_ip_hash text check (request_ip_hash is null or (typeof(request_ip_hash) = 'text' and length(cast(request_ip_hash as blob)) between 1 and 256)),
  request_user_agent_hash text check (request_user_agent_hash is null or (typeof(request_user_agent_hash) = 'text' and length(cast(request_user_agent_hash as blob)) between 1 and 256)),
  event text not null check (json_valid(event) = 1 and json_extract(event, '$.type') is type and json_extract(event, '$.occurredAt') is occurred_at),
  normalization_version integer not null check (normalization_version = 1),
  event_bytes integer not null check (typeof(event_bytes) = 'integer' and event_bytes between 1 and 65536 and event_bytes = length(cast(event as blob))),
  created_at integer not null check (typeof(created_at) = 'integer' and created_at between 0 and 9007199254740991),
  constraint auth_audit_log_custom_type_check check (type not like 'app.%' or (length(type) <= 128 and substr(type, 5, 1) glob '[a-z0-9]' and substr(type, 5) not glob '*[^a-z0-9_.-]*'))
);

drop table auth_audit_log_unconstrained;

create index auth_audit_log_id_idx on auth_audit_log (id);
create index auth_audit_log_user_occurred_at_idx on auth_audit_log (user_id, occurred_at);
create index auth_audit_log_actor_user_occurred_at_idx on auth_audit_log (actor_user_id, occurred_at);
create index auth_audit_log_type_occurred_at_idx on auth_audit_log (type, occurred_at);
create index auth_audit_log_occurred_at_idx on auth_audit_log (occurred_at);
