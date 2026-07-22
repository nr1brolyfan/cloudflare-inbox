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
