-- Generated from @effect-auth/core@0.1.0-alpha.19.
-- Do not edit manually; run `bun run generate:auth-migrations`.

create table if not exists auth_audit_log (
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

create index if not exists auth_audit_log_id_idx on auth_audit_log (id);
create index if not exists auth_audit_log_user_occurred_at_idx on auth_audit_log (user_id, occurred_at);
create index if not exists auth_audit_log_actor_user_occurred_at_idx on auth_audit_log (actor_user_id, occurred_at);
create index if not exists auth_audit_log_type_occurred_at_idx on auth_audit_log (type, occurred_at);
create index if not exists auth_audit_log_occurred_at_idx on auth_audit_log (occurred_at);
