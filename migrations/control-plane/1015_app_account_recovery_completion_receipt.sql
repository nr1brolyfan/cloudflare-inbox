create table if not exists app_account_recovery_completion_receipt (
  operation_id text primary key,
  readback_secret_hash text not null,
  flow_id text not null,
  flow_secret_hash text not null,
  recovery_code_id text not null,
  recovery_code_hash text not null,
  user_id text not null,
  external_recovery_identity_id text not null,
  expected_external_recovery_identity_version integer not null,
  session_id text not null unique,
  result_status text not null,
  completed_at integer not null,
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
  check (
    length(readback_secret_hash) = 43
    and readback_secret_hash not glob '*[^A-Za-z0-9_-]*'
  ),
  check (
    length(flow_id) between 1 and 128
    and length(flow_secret_hash) = 43
    and flow_secret_hash not glob '*[^A-Za-z0-9_-]*'
  ),
  check (
    length(recovery_code_id) between 1 and 128
    and length(recovery_code_hash) = 50
    and substr(recovery_code_hash, 1, 7) = 'sha256:'
    and substr(recovery_code_hash, 8) not glob '*[^A-Za-z0-9_-]*'
  ),
  check (
    length(user_id) between 1 and 128 and user_id = trim(user_id)
    and length(external_recovery_identity_id) between 1 and 128
    and expected_external_recovery_identity_version >= 1
    and length(session_id) between 1 and 128
  ),
  check (
    result_status = 'recovery-remediation-required'
    and completed_at >= 0
    and schema_version = 1
  )
);

create trigger if not exists app_account_recovery_completion_receipt_binding
before insert on app_account_recovery_completion_receipt
when not exists (
  select 1 from auth_verification
   where id = new.flow_id
     and type = 'auth-flow-state'
     and subject = new.user_id
     and secret_hash = new.flow_secret_hash
     and consumed_at = new.completed_at
)
or not exists (
  select 1 from auth_recovery_code
   where id = new.recovery_code_id
     and user_id = new.user_id
     and code_hash = new.recovery_code_hash
     and used_at = new.completed_at
     and revoked_at is null
     and metadata = json_object('purpose', 'account-recovery')
)
or not exists (
  select 1 from app_external_recovery_identity
   where id = new.external_recovery_identity_id
     and user_id = new.user_id
     and version = new.expected_external_recovery_identity_version
     and status = 'verified'
     and revoked_at is null
)
or not exists (
  select 1 from auth_session
   where id = new.session_id
     and user_id = new.user_id
     and created_at = new.completed_at
     and revoked_at is null
     and json_valid(metadata)
     and json_extract(metadata, '$.__effectAuthSession.metadata.purpose') = 'account-recovery'
     and json_extract(metadata, '$.__effectAuthSession.metadata.externalRecoveryIdentityId') = new.external_recovery_identity_id
     and json_extract(metadata, '$.__effectAuthSession.metadata.externalRecoveryIdentityVersion') = new.expected_external_recovery_identity_version
     and json_array_length(json_extract(metadata, '$.__effectAuthSession.claims.requirements')) = 1
     and json_extract(metadata, '$.__effectAuthSession.claims.requirements[0]') = 'recovery_remediation'
     and json_array_length(json_extract(metadata, '$.__effectAuthSession.claims.recoveryRemediation.allowed')) = 1
     and json_extract(metadata, '$.__effectAuthSession.claims.recoveryRemediation.allowed[0]') = 'second-passkey'
)
or not exists (
  select 1 from auth_audit_log
   where id = 'account-recovery:' || new.operation_id
     and user_id = new.user_id
     and actor_user_id = new.user_id
     and type = 'app.account_recovery.entered'
     and occurred_at = new.completed_at
     and created_at = new.completed_at
     and json_valid(event)
     and json_extract(event, '$.payload.operationId') = new.operation_id
     and json_extract(event, '$.payload.externalRecoveryIdentityId') = new.external_recovery_identity_id
)
begin
  select raise(abort, 'invalid account-recovery completion receipt binding');
end;

create trigger if not exists app_account_recovery_completion_receipt_no_update
before update on app_account_recovery_completion_receipt
begin
  select raise(abort, 'account-recovery completion receipts are immutable');
end;

create trigger if not exists app_account_recovery_completion_receipt_no_delete
before delete on app_account_recovery_completion_receipt
begin
  select raise(abort, 'account-recovery completion receipts are retained');
end;

create trigger if not exists app_account_recovery_completion_receipt_no_replace
before insert on app_account_recovery_completion_receipt
when exists (
  select 1 from app_account_recovery_completion_receipt
   where operation_id = new.operation_id
)
begin
  select raise(abort, 'account-recovery completion receipts are immutable');
end;
