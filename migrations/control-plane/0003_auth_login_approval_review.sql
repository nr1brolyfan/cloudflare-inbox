-- Generated from @effect-auth/core@0.1.0-alpha.18.
-- Do not edit manually; run `bun run generate:auth-migrations`.

create table if not exists auth_login_approval_review (
  approval_challenge_id text primary key,
  flow_id text not null,
  user_id text not null,
  channel text not null,
  reason text not null,
  session_binding text not null,
  same_device_required integer not null,
  status text not null,
  created_at integer not null,
  expires_at integer not null,
  reviewed_at integer,
  reviewed_by text,
  denied_reason text,
  risk text,
  metadata text,
  review_metadata text
);

create index if not exists auth_login_approval_review_flow_id_idx on auth_login_approval_review (flow_id);
create index if not exists auth_login_approval_review_user_id_idx on auth_login_approval_review (user_id);
create index if not exists auth_login_approval_review_status_expires_at_idx on auth_login_approval_review (status, expires_at);
