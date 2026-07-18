-- Generated from @effect-auth/core@0.1.0-alpha.18.
-- Do not edit manually; run `bun run generate:auth-migrations`.

create table if not exists auth_webhook_replay (
  id text primary key,
  expires_at integer not null,
  created_at integer not null
);

create index if not exists auth_webhook_replay_expires_at_idx on auth_webhook_replay (expires_at);
