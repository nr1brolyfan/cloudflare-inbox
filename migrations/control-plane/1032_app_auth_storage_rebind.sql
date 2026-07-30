-- Repair app invariants after auth table rebuilds, including databases where
-- the original 0039 committed before its app receipt interlock was added.

create table app_passkey_credential_revocation_rebind as
select * from app_passkey_credential_revocation where false;

insert into app_passkey_credential_revocation_rebind
select * from app_passkey_credential_revocation;

drop table app_passkey_credential_revocation;

create table app_passkey_credential_revocation (
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

insert into app_passkey_credential_revocation
select * from app_passkey_credential_revocation_rebind;

drop table app_passkey_credential_revocation_rebind;

create index app_passkey_credential_revocation_user_operation_idx
  on app_passkey_credential_revocation (user_id, operation_id);

create trigger app_passkey_credential_revocation_binding
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

create trigger app_passkey_credential_revocation_no_update
before update on app_passkey_credential_revocation
begin
  select raise(abort, 'passkey revocation receipts are immutable');
end;

create trigger app_passkey_credential_revocation_no_delete
before delete on app_passkey_credential_revocation
begin
  select raise(abort, 'passkey revocation receipts are retained');
end;

create trigger app_passkey_credential_revocation_no_replace
before insert on app_passkey_credential_revocation
when exists (
  select 1 from app_passkey_credential_revocation
   where operation_id = new.operation_id
      or credential_record_id = new.credential_record_id
)
begin
  select raise(abort, 'passkey revocation receipts are immutable');
end;

drop trigger if exists app_account_recovery_completion_receipt_binding;
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

drop trigger if exists app_passkey_enrollment_receipt_binding;
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

drop trigger if exists app_first_owner_password_enrollment_binding;
create trigger app_first_owner_password_enrollment_binding
before insert on app_first_owner_password_enrollment
when not exists (
  select 1 from auth_user_identity
   where id = new.login_identity_id
     and user_id = new.actor_user_id
     and scope_type = 'global'
     and scope_id = 'global'
     and kind = 'email'
     and verified_at is not null
     and is_primary_login = 1
     and revoked_at is null
     and replaced_by_id is null
)
or not exists (
  select 1 from auth_credential
   where id = new.credential_id
     and user_id = new.actor_user_id
     and type = 'password'
     and password_hash is not null
     and created_at = new.committed_at
     and updated_at = new.committed_at
     and revoked_at is null
     and metadata is null
)
or not exists (
  select 1 from auth_session
   where id = new.session_id
     and user_id = new.actor_user_id
     and revoked_at is null
     and expires_at > new.committed_at
     and (
       metadata is null
       or (json_valid(metadata) and json_type(metadata) = 'object' and (
         json_type(metadata, '$.__effectAuthSession') is null
         or (
           json_type(metadata, '$.__effectAuthSession') = 'object'
           and json_type(metadata, '$.__effectAuthSession.version') = 'integer'
           and json_extract(metadata, '$.__effectAuthSession.version') = 1
           and (
             json_type(metadata, '$.__effectAuthSession.claims') is null
             or json_type(metadata, '$.__effectAuthSession.claims') = 'object'
           )
           and (
             json_type(metadata,
               '$.__effectAuthSession.claims.requirements') is null
             or (
               json_type(metadata,
                 '$.__effectAuthSession.claims.requirements') = 'array'
               and json_array_length(metadata,
                 '$.__effectAuthSession.claims.requirements') = 0
             )
           )
           and json_type(metadata,
             '$.__effectAuthSession.claims.recoveryEnrollment') is null
           and json_type(metadata,
             '$.__effectAuthSession.claims.recoveryRemediation') is null
         )
       ))
     )
     and json_valid(authentication_events)
     and json_type(authentication_events) = 'array'
     and json_array_length(authentication_events) <= 32
     and exists (
       select 1 from json_each(authentication_events) event
        where json_type(event.value, '$.version') = 'integer'
          and json_extract(event.value, '$.version') = 1
          and json_extract(event.value, '$.type') = new.proof_type
          and json_type(event.value, '$.identityId') = 'text'
          and json_extract(event.value, '$.identityId') = new.login_identity_id
          and json_type(event.value, '$.verifiedAt') = 'integer'
          and json_extract(event.value, '$.verifiedAt') = new.proof_verified_at
          and json_extract(event.value, '$.verifiedAt') between
            new.committed_at - 300000 and new.committed_at
     )
)
or (select count(*) from auth_audit_log
   where id = 'first-owner-password-enrollment:' || new.operation_id
     and user_id = new.actor_user_id
     and actor_user_id = new.actor_user_id
     and type = 'app.first_owner.password_enrolled'
     and occurred_at = new.committed_at
     and created_at = new.committed_at
     and json_valid(event)
     and json_extract(event, '$.version') = 1
     and json_extract(event, '$.actor.type') = 'user'
     and json_extract(event, '$.actor.userId') = new.actor_user_id
     and json_extract(event, '$.actor.sessionId') = new.session_id
     and json_extract(event, '$.subject.type') = 'user'
     and json_extract(event, '$.subject.userId') = new.actor_user_id
     and json_extract(event, '$.occurredAt') = new.committed_at
     and json_extract(event, '$.payload.operationId') = new.operation_id
     and json_extract(event, '$.payload.credentialId') = new.credential_id
     and json_extract(event, '$.payload.proofType') = new.proof_type
     and json_extract(event, '$.payload.proofVerifiedAt') = new.proof_verified_at
     and (select count(*) from json_each(event, '$.payload')) = 4
     and (select count(*) from json_each(event)) = 6
) != 1
begin
  select raise(abort, 'invalid first-owner password enrollment binding');
end;
