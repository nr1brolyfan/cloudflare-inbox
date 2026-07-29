-- Generated from @effect-auth/core@0.1.0-alpha.20.
-- Do not edit manually; run `bun run generate:auth-migrations`.

create table auth_passkey_credential_hardening_guard (version integer primary key check (version = 1));
insert into auth_passkey_credential_hardening_guard (version) values (1);
create table if not exists auth_passkey_credential_quarantine (
  id text, user_id text, credential_id text, public_key text, sign_count integer,
  transports text, backed_up integer, created_at integer, last_used_at integer,
  revoked_at integer, metadata text, name text, quarantine_reason text not null
);
insert into auth_passkey_credential_quarantine
select credential.*, 'requires-passkey-re-enrollment' from auth_passkey_credential as credential
where not (
  typeof(id) = 'text' and length(cast(id as blob)) between 1 and 256 and
  typeof(user_id) = 'text' and length(cast(user_id as blob)) between 1 and 256 and
  typeof(credential_id) = 'text' and length(credential_id) between 1 and 1364 and length(credential_id) % 4 != 1 and credential_id not glob '*[^A-Za-z0-9_-]*' and (length(credential_id) % 4 = 0 or (length(credential_id) % 4 = 2 and substr(credential_id, -1, 1) glob '[AQgw]') or (length(credential_id) % 4 = 3 and substr(credential_id, -1, 1) glob '[AEIMQUYcgkosw048]')) and
  typeof(public_key) = 'text' and length(public_key) between 1 and 10923 and length(public_key) % 4 != 1 and public_key not glob '*[^A-Za-z0-9_-]*' and (length(public_key) % 4 = 0 or (length(public_key) % 4 = 2 and substr(public_key, -1, 1) glob '[AQgw]') or (length(public_key) % 4 = 3 and substr(public_key, -1, 1) glob '[AEIMQUYcgkosw048]')) and
  typeof(sign_count) = 'integer' and sign_count between 0 and 9007199254740991 and
  (transports is null or (
    typeof(transports) = 'text' and json_valid(transports) = 1 and json_type(transports) = 'array' and json_array_length(transports) <= 7 and json(transports) = transports and
    replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(transports, '[', ''), ']', ''), ',', ''), '"ble"', ''), '"cable"', ''), '"hybrid"', ''), '"internal"', ''), '"nfc"', ''), '"smart-card"', ''), '"usb"', '') = '' and
    length(transports) - length(replace(transports, '"ble"', '')) <= 5 and
    length(transports) - length(replace(transports, '"cable"', '')) <= 7 and
    length(transports) - length(replace(transports, '"hybrid"', '')) <= 8 and
    length(transports) - length(replace(transports, '"internal"', '')) <= 10 and
    length(transports) - length(replace(transports, '"nfc"', '')) <= 5 and
    length(transports) - length(replace(transports, '"smart-card"', '')) <= 12 and
    length(transports) - length(replace(transports, '"usb"', '')) <= 5
  )) and
  (backed_up is null or (typeof(backed_up) = 'integer' and backed_up in (0, 1))) and
  typeof(created_at) = 'integer' and created_at between 0 and 9007199254740991 and
  (last_used_at is null or (typeof(last_used_at) = 'integer' and last_used_at between created_at and 9007199254740991)) and
  (revoked_at is null or (typeof(revoked_at) = 'integer' and revoked_at between created_at and 9007199254740991)) and
  (metadata is null or (typeof(metadata) = 'text' and length(cast(metadata as blob)) <= 65536 and json_valid(metadata) = 1 and json_type(metadata) = 'object')) and
  (name is null or (typeof(name) = 'text' and length(name) between 1 and 100 and length(cast(name as blob)) <= 400))
);
alter table auth_passkey_credential rename to auth_passkey_credential_unconstrained;
create table auth_passkey_credential (
  id text primary key check (typeof(id) = 'text' and length(cast(id as blob)) between 1 and 256),
  user_id text not null check (typeof(user_id) = 'text' and length(cast(user_id as blob)) between 1 and 256),
  credential_id text not null check (typeof(credential_id) = 'text' and length(credential_id) between 1 and 1364 and length(credential_id) % 4 != 1 and credential_id not glob '*[^A-Za-z0-9_-]*' and (length(credential_id) % 4 = 0 or (length(credential_id) % 4 = 2 and substr(credential_id, -1, 1) glob '[AQgw]') or (length(credential_id) % 4 = 3 and substr(credential_id, -1, 1) glob '[AEIMQUYcgkosw048]'))),
  public_key text not null check (typeof(public_key) = 'text' and length(public_key) between 1 and 10923 and length(public_key) % 4 != 1 and public_key not glob '*[^A-Za-z0-9_-]*' and (length(public_key) % 4 = 0 or (length(public_key) % 4 = 2 and substr(public_key, -1, 1) glob '[AQgw]') or (length(public_key) % 4 = 3 and substr(public_key, -1, 1) glob '[AEIMQUYcgkosw048]'))),
  sign_count integer not null check (typeof(sign_count) = 'integer' and sign_count between 0 and 9007199254740991),
  transports text check (transports is null or (typeof(transports) = 'text' and json_valid(transports) = 1 and json_type(transports) = 'array' and json_array_length(transports) <= 7 and json(transports) = transports and replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(transports, '[', ''), ']', ''), ',', ''), '"ble"', ''), '"cable"', ''), '"hybrid"', ''), '"internal"', ''), '"nfc"', ''), '"smart-card"', ''), '"usb"', '') = '' and length(transports) - length(replace(transports, '"ble"', '')) <= 5 and length(transports) - length(replace(transports, '"cable"', '')) <= 7 and length(transports) - length(replace(transports, '"hybrid"', '')) <= 8 and length(transports) - length(replace(transports, '"internal"', '')) <= 10 and length(transports) - length(replace(transports, '"nfc"', '')) <= 5 and length(transports) - length(replace(transports, '"smart-card"', '')) <= 12 and length(transports) - length(replace(transports, '"usb"', '')) <= 5)),
  backed_up integer check (backed_up is null or (typeof(backed_up) = 'integer' and backed_up in (0, 1))),
  created_at integer not null check (typeof(created_at) = 'integer' and created_at between 0 and 9007199254740991),
  last_used_at integer check (last_used_at is null or (typeof(last_used_at) = 'integer' and last_used_at between created_at and 9007199254740991)),
  revoked_at integer check (revoked_at is null or (typeof(revoked_at) = 'integer' and revoked_at between created_at and 9007199254740991)),
  metadata text check (metadata is null or (typeof(metadata) = 'text' and length(cast(metadata as blob)) <= 65536 and json_valid(metadata) = 1 and json_type(metadata) = 'object')),
  name text check (name is null or (typeof(name) = 'text' and length(name) between 1 and 100 and length(cast(name as blob)) <= 400))
);
insert into auth_passkey_credential select credential.* from auth_passkey_credential_unconstrained as credential where not exists (select 1 from auth_passkey_credential_quarantine as quarantine where quarantine.id is credential.id);
drop table auth_passkey_credential_unconstrained;
create unique index auth_passkey_credential_credential_id_idx on auth_passkey_credential (credential_id);
create index auth_passkey_credential_user_id_idx on auth_passkey_credential (user_id);
create index auth_passkey_credential_revoked_at_idx on auth_passkey_credential (revoked_at);
