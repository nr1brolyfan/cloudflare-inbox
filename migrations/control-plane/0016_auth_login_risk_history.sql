-- Generated from @effect-auth/core@0.1.0-alpha.19.
-- Do not edit manually; run `bun run generate:auth-migrations`.

create table if not exists auth_login_risk_history (
  id text primary key,
  user_id text not null,
  occurred_at integer not null,
  outcome text not null,
  method text not null,
  amr text not null,
  aal text not null,
  device_status text not null,
  device_key text,
  location_key text,
  country text,
  region text,
  latitude_micro integer,
  longitude_micro integer,
  risk_level text,
  created_at integer not null
);

create index if not exists auth_login_risk_history_user_occurred_at_idx on auth_login_risk_history (user_id, occurred_at);
create index if not exists auth_login_risk_history_user_device_key_idx on auth_login_risk_history (user_id, device_key);
create index if not exists auth_login_risk_history_user_location_key_idx on auth_login_risk_history (user_id, location_key);
create index if not exists auth_login_risk_history_occurred_at_idx on auth_login_risk_history (occurred_at);
