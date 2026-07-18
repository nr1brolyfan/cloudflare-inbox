-- Generated from @effect-auth/core@0.1.0-alpha.19.
-- Do not edit manually; run `bun run generate:auth-migrations`.

create table if not exists auth_security_timeline (
  id text primary key,
  user_id text not null,
  type text not null,
  category text not null,
  severity text not null,
  occurred_at integer not null,
  summary text not null,
  actor text,
  request text,
  metadata text
);

create index if not exists auth_security_timeline_user_occurred_at_idx on auth_security_timeline (user_id, occurred_at);
create index if not exists auth_security_timeline_type_idx on auth_security_timeline (type);
create index if not exists auth_security_timeline_category_idx on auth_security_timeline (category);
