-- Generated from @effect-auth/core@0.1.0-alpha.18.
-- Do not edit manually; run `bun run generate:auth-migrations`.

alter table auth_audit_log rename to auth_audit_log_legacy;

create table auth_audit_log (
  storage_id integer primary key autoincrement,
  id text,
  type text not null,
  user_id text,
  actor_user_id text,
  occurred_at integer not null,
  request_ip_hash text,
  request_user_agent_hash text,
  event text not null,
  created_at integer not null
);

insert into auth_audit_log (
  id,
  type,
  user_id,
  actor_user_id,
  occurred_at,
  request_ip_hash,
  request_user_agent_hash,
  event,
  created_at
)
select
  id,
  type,
  user_id,
  actor_user_id,
  occurred_at,
  request_ip_hash,
  request_user_agent_hash,
  event,
  created_at
from auth_audit_log_legacy
order by rowid;

drop table auth_audit_log_legacy;

create index auth_audit_log_id_idx on auth_audit_log (id);
create index auth_audit_log_user_occurred_at_idx on auth_audit_log (user_id, occurred_at);
create index auth_audit_log_actor_user_occurred_at_idx on auth_audit_log (actor_user_id, occurred_at);
create index auth_audit_log_type_occurred_at_idx on auth_audit_log (type, occurred_at);
create index auth_audit_log_occurred_at_idx on auth_audit_log (occurred_at);
