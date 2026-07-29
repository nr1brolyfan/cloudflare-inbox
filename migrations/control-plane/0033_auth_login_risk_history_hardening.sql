-- Generated from @effect-auth/core@0.1.0-alpha.20.
-- Do not edit manually; run `bun run generate:auth-migrations`.

create table if not exists auth_login_risk_history_quarantine (
  id text, user_id text, occurred_at integer, outcome text, method text, amr text, aal text, device_status text, device_key text, location_key text, country text, region text, latitude_micro integer, longitude_micro integer, risk_level text, created_at integer,
  quarantined_reason text not null
);

insert into auth_login_risk_history_quarantine
select *, 'invalid-required-field' from auth_login_risk_history
where not (typeof(id) = 'text' and length(id) between 1 and 256 and substr(id, 1, 1) not glob '*[^A-Za-z0-9]*' and id not glob '*[^A-Za-z0-9_.:@/-]*' and typeof(user_id) = 'text' and length(user_id) between 1 and 256 and substr(user_id, 1, 1) not glob '*[^A-Za-z0-9]*' and user_id not glob '*[^A-Za-z0-9_.:@/-]*' and typeof(occurred_at) = 'integer' and occurred_at between 0 and 9007199254740991 and typeof(created_at) = 'integer' and created_at between occurred_at and 9007199254740991 and outcome in ('success', 'failure') and typeof(method) = 'text' and length(method) between 1 and 128 and substr(method, 1, 1) not glob '*[^A-Za-z0-9]*' and method not glob '*[^A-Za-z0-9_.:@/-]*' and aal in ('aal1', 'aal2', 'aal3') and device_status in ('known', 'new', 'unknown'));

delete from auth_login_risk_history
where not (typeof(id) = 'text' and length(id) between 1 and 256 and substr(id, 1, 1) not glob '*[^A-Za-z0-9]*' and id not glob '*[^A-Za-z0-9_.:@/-]*' and typeof(user_id) = 'text' and length(user_id) between 1 and 256 and substr(user_id, 1, 1) not glob '*[^A-Za-z0-9]*' and user_id not glob '*[^A-Za-z0-9_.:@/-]*' and typeof(occurred_at) = 'integer' and occurred_at between 0 and 9007199254740991 and typeof(created_at) = 'integer' and created_at between occurred_at and 9007199254740991 and outcome in ('success', 'failure') and typeof(method) = 'text' and length(method) between 1 and 128 and substr(method, 1, 1) not glob '*[^A-Za-z0-9]*' and method not glob '*[^A-Za-z0-9_.:@/-]*' and aal in ('aal1', 'aal2', 'aal3') and device_status in ('known', 'new', 'unknown'));

update auth_login_risk_history set amr = '[]'
where not json_valid(amr) or (json_valid(amr) and (json_type(amr) <> 'array' or json_array_length(amr) > 32));
update auth_login_risk_history set amr = '[]'
where json_valid(amr) and json_type(amr) = 'array' and exists (select 1 from json_each(amr) where type <> 'text' or length(value) not between 1 and 128 or substr(value, 1, 1) glob '*[^A-Za-z0-9]*' or value glob '*[^A-Za-z0-9_.:@/-]*');
update auth_login_risk_history set amr = '[]'
where json_valid(amr) and json_type(amr) = 'array' and exists (select 1 from json_each(amr) as left_item join json_each(amr) as right_item on left_item.key < right_item.key and left_item.value = right_item.value);
update auth_login_risk_history set device_key = null where device_key is not null and not (typeof(device_key) = 'text' and length(device_key) = 43 and device_key not glob '*[^A-Za-z0-9_-]*');
update auth_login_risk_history set location_key = case when typeof(location_key) = 'text' and length(location_key) between 8 and 135 and substr(location_key, 1, 4) = 'geo:' and substr(location_key, 5, 2) not glob '*[^A-Z]*' and substr(location_key, 7, 1) = ':' and (substr(location_key, 8) = '_' or (length(substr(location_key, 8)) between 1 and 128 and substr(location_key, 8, 1) not glob '*[^A-Za-z0-9]*' and substr(location_key, 8) not glob '*[^A-Za-z0-9_. -]*')) then location_key when typeof(location_key) = 'text' and length(location_key) between 8 and 135 and substr(location_key, 1, 4) = 'geo:' and upper(substr(location_key, 5, 2)) not glob '*[^A-Z]*' and substr(location_key, 7, 1) = ':' and (substr(location_key, 8) = '_' or (length(substr(location_key, 8)) between 1 and 128 and substr(location_key, 8, 1) not glob '*[^A-Za-z0-9]*' and substr(location_key, 8) not glob '*[^A-Za-z0-9_. -]*')) then 'geo:' || upper(substr(location_key, 5, 2)) || ':' || substr(location_key, 8) else null end where location_key is not null;
update auth_login_risk_history set country = case when typeof(country) = 'text' and length(trim(country)) = 2 and upper(trim(country)) not glob '*[^A-Z]*' then upper(trim(country)) else null end where country is not null;
update auth_login_risk_history set region = case when typeof(region) = 'text' and length(trim(region)) between 1 and 128 and substr(trim(region), 1, 1) not glob '*[^A-Za-z0-9]*' and trim(region) not glob '*[^A-Za-z0-9_. -]*' then trim(region) else null end where region is not null;
update auth_login_risk_history set latitude_micro = null, longitude_micro = null where (latitude_micro is null) <> (longitude_micro is null) or latitude_micro not between -90000000 and 90000000 or longitude_micro not between -180000000 and 180000000;
update auth_login_risk_history set risk_level = null where risk_level is not null and risk_level not in ('unknown', 'low', 'medium', 'high', 'critical');

create table auth_login_risk_history_hardened (
  id text primary key, user_id text not null, occurred_at integer not null, outcome text not null, method text not null, amr text not null, aal text not null, device_status text not null, device_key text, location_key text, country text, region text, latitude_micro integer, longitude_micro integer, risk_level text, created_at integer not null,
  constraint auth_login_risk_history_id_check check (length(id) between 1 and 256 and substr(id, 1, 1) not glob '*[^A-Za-z0-9]*' and id not glob '*[^A-Za-z0-9_.:@/-]*'),
  constraint auth_login_risk_history_user_id_check check (length(user_id) between 1 and 256 and substr(user_id, 1, 1) not glob '*[^A-Za-z0-9]*' and user_id not glob '*[^A-Za-z0-9_.:@/-]*'),
  constraint auth_login_risk_history_timestamp_check check (occurred_at between 0 and 9007199254740991 and created_at between occurred_at and 9007199254740991),
  constraint auth_login_risk_history_outcome_check check (outcome in ('success', 'failure')),
  constraint auth_login_risk_history_method_check check (length(method) between 1 and 128 and substr(method, 1, 1) not glob '*[^A-Za-z0-9]*' and method not glob '*[^A-Za-z0-9_.:@/-]*'),
  constraint auth_login_risk_history_amr_check check (json_valid(amr) and json_type(amr) = 'array' and json_array_length(amr) <= 32),
  constraint auth_login_risk_history_aal_check check (aal in ('aal1', 'aal2', 'aal3')),
  constraint auth_login_risk_history_device_status_check check (device_status in ('known', 'new', 'unknown')),
  constraint auth_login_risk_history_device_key_check check (device_key is null or (length(device_key) = 43 and device_key not glob '*[^A-Za-z0-9_-]*')),
  constraint auth_login_risk_history_location_key_check check (location_key is null or (length(location_key) between 8 and 135 and substr(location_key, 1, 4) = 'geo:' and substr(location_key, 5, 2) not glob '*[^A-Z]*' and substr(location_key, 7, 1) = ':' and (substr(location_key, 8) = '_' or (length(substr(location_key, 8)) between 1 and 128 and substr(location_key, 8, 1) not glob '*[^A-Za-z0-9]*' and substr(location_key, 8) not glob '*[^A-Za-z0-9_. -]*')))),
  constraint auth_login_risk_history_country_check check (country is null or (length(country) = 2 and country not glob '*[^A-Z]*')),
  constraint auth_login_risk_history_region_check check (region is null or (length(region) between 1 and 128 and substr(region, 1, 1) not glob '*[^A-Za-z0-9]*' and region not glob '*[^A-Za-z0-9_. -]*')),
  constraint auth_login_risk_history_coordinates_check check ((latitude_micro is null) = (longitude_micro is null) and (latitude_micro is null or latitude_micro between -90000000 and 90000000) and (longitude_micro is null or longitude_micro between -180000000 and 180000000)),
  constraint auth_login_risk_history_risk_level_check check (risk_level is null or risk_level in ('unknown', 'low', 'medium', 'high', 'critical'))
);
insert into auth_login_risk_history_hardened select * from auth_login_risk_history;
drop table auth_login_risk_history;
alter table auth_login_risk_history_hardened rename to auth_login_risk_history;
create index auth_login_risk_history_user_occurred_at_idx on auth_login_risk_history (user_id, occurred_at, id);
create index auth_login_risk_history_user_device_key_idx on auth_login_risk_history (user_id, device_key);
create index auth_login_risk_history_user_location_key_idx on auth_login_risk_history (user_id, location_key);
create index auth_login_risk_history_occurred_at_idx on auth_login_risk_history (occurred_at, id);
