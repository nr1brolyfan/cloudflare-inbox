-- Generated from @effect-auth/core@0.1.0-alpha.19.
-- Do not edit manually; run `bun run generate:auth-migrations`.

create table if not exists auth_webhook_outbox (
  id text primary key,
  endpoint_key text not null,
  event text not null,
  status text not null,
  attempts integer not null,
  next_attempt_at integer not null,
  created_at integer not null,
  updated_at integer not null,
  delivered_at integer,
  last_error text
);

create index if not exists auth_webhook_outbox_due_idx on auth_webhook_outbox (next_attempt_at, status);
create index if not exists auth_webhook_outbox_endpoint_due_idx on auth_webhook_outbox (endpoint_key, next_attempt_at);
create index if not exists auth_webhook_outbox_status_idx on auth_webhook_outbox (status);
