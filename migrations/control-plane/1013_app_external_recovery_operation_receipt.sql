create table if not exists app_external_recovery_operation_receipt (
  operation_id text primary key,
  operation_kind text not null,
  actor_user_id text not null,
  identity_id text not null,
  challenge_id text,
  expected_identity_version integer,
  verification_secret_hash text,
  result_user_id text not null,
  result_status text not null,
  result_challenge_expires_at integer not null,
  result_created_at integer not null,
  result_updated_at integer not null,
  result_verified_at integer,
  result_revoked_at integer,
  result_version integer not null,
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
  check (operation_kind in ('enroll', 'verify')),
  check (
    length(actor_user_id) between 1 and 128
    and actor_user_id = trim(actor_user_id)
  ),
  check (length(identity_id) between 1 and 128),
  check (
    (operation_kind = 'enroll'
      and challenge_id is null
      and expected_identity_version is null
      and verification_secret_hash is null
      and result_status = 'pending'
      and result_verified_at is null
      and result_revoked_at is null
      and result_version = 1)
    or (operation_kind = 'verify'
      and length(challenge_id) between 1 and 128
      and expected_identity_version >= 1
      and length(verification_secret_hash) between 1 and 512
      and result_status = 'verified'
      and result_verified_at is not null
      and result_revoked_at is null
      and result_version = expected_identity_version + 1)
  ),
  check (result_user_id = actor_user_id),
  check (result_challenge_expires_at > result_created_at),
  check (result_created_at >= 0),
  check (result_updated_at >= result_created_at),
  check (
    result_verified_at is null
    or result_verified_at between result_created_at and result_updated_at
  ),
  check (result_revoked_at is null),
  check (committed_at = result_updated_at),
  check (schema_version = 1)
);

create index if not exists app_external_recovery_operation_receipt_actor_operation_idx
  on app_external_recovery_operation_receipt (actor_user_id, operation_id);

create trigger if not exists app_external_recovery_operation_receipt_binding
before insert on app_external_recovery_operation_receipt
when not exists (
  select 1 from app_external_recovery_identity
   where id = new.identity_id
     and user_id = new.result_user_id
     and status = new.result_status
     and challenge_expires_at = new.result_challenge_expires_at
     and created_at = new.result_created_at
     and updated_at = new.result_updated_at
     and verified_at is new.result_verified_at
     and revoked_at is new.result_revoked_at
     and version = new.result_version
     and (
       (new.operation_kind = 'enroll'
         and enrollment_operation_id = new.operation_id)
       or (new.operation_kind = 'verify'
         and challenge_id = new.challenge_id
         and exists (
           select 1 from auth_verification
            where id = new.challenge_id
              and type = 'external-recovery-identity-verification'
              and subject = new.identity_id
              and secret_hash = new.verification_secret_hash
              and expires_at = app_external_recovery_identity.challenge_expires_at
              and consumed_at = new.result_verified_at
         ))
     )
)
begin
  select raise(abort, 'invalid external recovery operation receipt binding');
end;

create trigger if not exists app_external_recovery_operation_receipt_no_update
before update on app_external_recovery_operation_receipt
begin
  select raise(abort, 'external recovery operation receipts are immutable');
end;

create trigger if not exists app_external_recovery_operation_receipt_no_delete
before delete on app_external_recovery_operation_receipt
begin
  select raise(abort, 'external recovery operation receipts are retained');
end;

create trigger if not exists app_external_recovery_operation_receipt_no_replace
before insert on app_external_recovery_operation_receipt
when exists (
  select 1 from app_external_recovery_operation_receipt
   where operation_id = new.operation_id
)
begin
  select raise(abort, 'external recovery operation receipts are immutable');
end;
