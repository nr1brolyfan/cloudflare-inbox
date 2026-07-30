-- Generated from @effect-auth/core@0.1.0-alpha.20.
-- Do not edit manually; run `bun run generate:auth-migrations`.

-- Detach app receipts so their FK and trigger do not follow the scratch rename.
create table if not exists app_passkey_enrollment_receipt (
  operation_id text primary key,
  mode text not null,
  actor_user_id text not null,
  challenge_id text not null,
  recovery_identity_id text not null,
  recovery_identity_version integer not null,
  client_intent_digest text not null,
  verified_intent_digest text not null,
  credential_record_id text not null unique,
  readback_secret_hash text,
  replacement_identity_id text,
  resulting_session_id text,
  resulting_code_set_id text,
  resulting_code_count integer,
  committed_at integer not null,
  schema_version integer not null,
  check (
    length(operation_id) = 36
    and operation_id = lower(trim(operation_id))
    and substr(operation_id, 9, 1) = '-'
    and substr(operation_id, 14, 1) = '-'
    and substr(operation_id, 15, 1) = '4'
    and substr(operation_id, 19, 1) = '-'
    and substr(operation_id, 20, 1) in ('8', '9', 'a', 'b')
    and substr(operation_id, 24, 1) = '-'
    and length(replace(operation_id, '-', '')) = 32
    and replace(operation_id, '-', '') not glob '*[^0-9a-f]*'
  ),
  check (mode in ('normal', 'recovery-remediation')),
  check (
    length(actor_user_id) between 1 and 128
    and actor_user_id = trim(actor_user_id)
    and length(challenge_id) between 1 and 128
    and length(recovery_identity_id) between 1 and 128
    and recovery_identity_version >= 1
  ),
  check (
    length(client_intent_digest) = 43
    and client_intent_digest not glob '*[^A-Za-z0-9_-]*'
    and length(verified_intent_digest) = 43
    and verified_intent_digest not glob '*[^A-Za-z0-9_-]*'
    and length(credential_record_id) between 1 and 256
  ),
  check (
    committed_at >= 0 and schema_version = 1
    and ((mode = 'normal'
      and readback_secret_hash is null
      and replacement_identity_id is null
      and resulting_session_id is null
      and resulting_code_set_id is null
      and resulting_code_count is null)
    or (mode = 'recovery-remediation'
      and length(readback_secret_hash) = 43
      and readback_secret_hash not glob '*[^A-Za-z0-9_-]*'
      and length(replacement_identity_id) between 1 and 128
      and length(resulting_session_id) between 1 and 128
      and length(resulting_code_set_id) between 1 and 128
      and resulting_code_count = 10))
  )
);

drop trigger if exists app_passkey_enrollment_receipt_binding;

create table if not exists app_passkey_credential_revocation (
  operation_id text primary key,
  user_id text not null check (length(user_id) between 1 and 128 and user_id = trim(user_id)),
  credential_record_id text not null unique
    check (length(credential_record_id) between 1 and 256 and credential_record_id = trim(credential_record_id)),
  credential_created_at integer not null check (credential_created_at >= 0),
  credential_last_used_at integer,
  revoked_at integer not null check (revoked_at >= credential_created_at),
  check (
    length(operation_id) = 36
    and operation_id = lower(trim(operation_id))
    and substr(operation_id, 9, 1) = '-'
    and substr(operation_id, 14, 1) = '-'
    and substr(operation_id, 15, 1) = '4'
    and substr(operation_id, 19, 1) = '-'
    and substr(operation_id, 20, 1) in ('8', '9', 'a', 'b')
    and substr(operation_id, 24, 1) = '-'
    and length(replace(operation_id, '-', '')) = 32
    and replace(operation_id, '-', '') not glob '*[^0-9a-f]*'
  ),
  check (
    credential_last_used_at is null
    or credential_last_used_at between credential_created_at and revoked_at
  ),
  foreign key (credential_record_id)
    references auth_passkey_credential (id) on delete restrict
);

create table auth_passkey_credential_revocation_rebind as
select * from app_passkey_credential_revocation where false;
insert into auth_passkey_credential_revocation_rebind
select * from app_passkey_credential_revocation;
drop table app_passkey_credential_revocation;

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

-- Restore app receipts against the hardened parent in the same transaction.
create trigger if not exists app_passkey_enrollment_receipt_binding
before insert on app_passkey_enrollment_receipt
when not exists (
  select 1 from auth_passkey_credential
   where id = new.credential_record_id
     and user_id = new.actor_user_id
     and created_at = new.committed_at
)
or not exists (
  select 1 from auth_verification
   where id = new.challenge_id
     and type = 'passkey-registration'
     and subject = new.actor_user_id
     and consumed_at = new.committed_at
     and json_valid(metadata)
     and json_extract(metadata, '$.operationId') = new.operation_id
     and json_extract(metadata, '$.recoveryIdentityId') = new.recovery_identity_id
     and json_extract(metadata, '$.recoveryIdentityVersion') = new.recovery_identity_version
     and json_extract(metadata, '$.authorization') = case new.mode
       when 'normal' then 'step-up' else 'recovery-remediation' end
     and ((new.mode = 'normal'
       and json_type(metadata, '$.readbackSecretHash') is null)
       or (new.mode = 'recovery-remediation'
         and json_extract(metadata, '$.readbackSecretHash') = new.readback_secret_hash))
)
or not exists (
  select 1 from auth_audit_log
   where id = 'passkey-enrollment:' || new.operation_id
     and user_id = new.actor_user_id
     and actor_user_id = new.actor_user_id
     and type = 'app.passkey.enrolled'
     and occurred_at = new.committed_at
     and created_at = new.committed_at
     and json_valid(event)
     and json_extract(event, '$.payload.operationId') = new.operation_id
     and json_extract(event, '$.payload.credentialRecordId') = new.credential_record_id
)
or (new.mode = 'recovery-remediation' and (
  not exists (
    select 1 from auth_user_identity
     where id = new.replacement_identity_id
       and user_id = new.actor_user_id
       and kind = 'recovery-passkey'
       and is_primary_login = 1
       and verified_at = new.committed_at
       and revoked_at is null
  )
  or not exists (
    select 1 from auth_user_identity
     where user_id = new.actor_user_id
       and replaced_by_id = new.replacement_identity_id
       and revoked_at >= new.committed_at
  )
  or not exists (
    select 1 from auth_session
     where id = new.resulting_session_id
       and user_id = new.actor_user_id
       and created_at = new.committed_at
       and revoked_at is null
       and json_valid(metadata)
       and json_extract(metadata, '$.__effectAuthSession.metadata.purpose') = 'account-recovery-completed'
       and json_type(metadata, '$.__effectAuthSession.claims.requirements') is null
  )
  or (select count(*) from auth_recovery_code
       where user_id = new.actor_user_id
         and created_at = new.committed_at
         and used_at is null
         and revoked_at is null
         and json_valid(metadata)
         and json_extract(metadata, '$.purpose') = 'account-recovery-completed'
       and json_extract(metadata, '$.setId') = new.resulting_code_set_id)
       != new.resulting_code_count
  or exists (
    select 1 from auth_recovery_code
     where json_valid(metadata)
       and json_extract(metadata, '$.setId') = new.resulting_code_set_id
       and (user_id != new.actor_user_id
         or created_at != new.committed_at
         or used_at is not null
         or revoked_at is not null
         or metadata != json_object(
           'purpose', 'account-recovery-completed',
           'setId', new.resulting_code_set_id))
  )
  or not exists (
    select 1 from auth_audit_log
     where id = 'account-recovery-completed:' || new.operation_id
       and user_id = new.actor_user_id
       and actor_user_id = new.actor_user_id
       and type = 'app.account_recovery.completed'
       and occurred_at = new.committed_at
       and created_at = new.committed_at
       and json_valid(event)
       and json_extract(event, '$.payload.operationId') = new.operation_id
       and json_extract(event, '$.payload.credentialRecordId') = new.credential_record_id
       and json_extract(event, '$.payload.codeCount') = new.resulting_code_count
  )
))
begin
  select raise(abort, 'invalid passkey enrollment receipt binding');
end;

create table if not exists app_passkey_credential_revocation (
  operation_id text primary key,
  user_id text not null check (length(user_id) between 1 and 128 and user_id = trim(user_id)),
  credential_record_id text not null unique
    check (length(credential_record_id) between 1 and 256 and credential_record_id = trim(credential_record_id)),
  credential_created_at integer not null check (credential_created_at >= 0),
  credential_last_used_at integer,
  revoked_at integer not null check (revoked_at >= credential_created_at),
  check (
    length(operation_id) = 36
    and operation_id = lower(trim(operation_id))
    and substr(operation_id, 9, 1) = '-'
    and substr(operation_id, 14, 1) = '-'
    and substr(operation_id, 15, 1) = '4'
    and substr(operation_id, 19, 1) = '-'
    and substr(operation_id, 20, 1) in ('8', '9', 'a', 'b')
    and substr(operation_id, 24, 1) = '-'
    and length(replace(operation_id, '-', '')) = 32
    and replace(operation_id, '-', '') not glob '*[^0-9a-f]*'
  ),
  check (
    credential_last_used_at is null
    or credential_last_used_at between credential_created_at and revoked_at
  ),
  foreign key (credential_record_id)
    references auth_passkey_credential (id) on delete restrict
);

create index if not exists app_passkey_credential_revocation_user_operation_idx
  on app_passkey_credential_revocation (user_id, operation_id);

create trigger if not exists app_passkey_credential_revocation_binding
before insert on app_passkey_credential_revocation
when not exists (
  select 1 from auth_passkey_credential
   where id = new.credential_record_id
     and user_id = new.user_id
     and created_at = new.credential_created_at
     and last_used_at is new.credential_last_used_at
     and revoked_at = new.revoked_at
)
begin
  select raise(abort, 'invalid passkey revocation receipt binding');
end;

create trigger if not exists app_passkey_credential_revocation_no_update
before update on app_passkey_credential_revocation
begin
  select raise(abort, 'passkey revocation receipts are immutable');
end;

create trigger if not exists app_passkey_credential_revocation_no_delete
before delete on app_passkey_credential_revocation
begin
  select raise(abort, 'passkey revocation receipts are retained');
end;

create trigger if not exists app_passkey_credential_revocation_no_replace
before insert on app_passkey_credential_revocation
when exists (
  select 1 from app_passkey_credential_revocation
   where operation_id = new.operation_id
      or credential_record_id = new.credential_record_id
)
begin
  select raise(abort, 'passkey revocation receipts are immutable');
end;

insert into app_passkey_credential_revocation
select * from auth_passkey_credential_revocation_rebind;
drop table auth_passkey_credential_revocation_rebind;
