create trigger if not exists app_external_recovery_identity_insert_contract
before insert on app_external_recovery_identity
begin
  select case when not (
    new.status = 'pending'
    and new.version = 1
    and new.verified_at is null
    and new.revoked_at is null
    and new.created_at = new.updated_at
  ) then raise(abort, 'external recovery identity must start pending') end;
  select case when not (
    length(new.enrollment_operation_id) = 36
    and new.enrollment_operation_id = lower(trim(new.enrollment_operation_id))
    and substr(new.enrollment_operation_id, 9, 1) = '-'
    and substr(new.enrollment_operation_id, 14, 1) = '-'
    and substr(new.enrollment_operation_id, 15, 1) = '4'
    and substr(new.enrollment_operation_id, 19, 1) = '-'
    and substr(new.enrollment_operation_id, 20, 1) in ('8', '9', 'a', 'b')
    and substr(new.enrollment_operation_id, 24, 1) = '-'
    and length(replace(new.enrollment_operation_id, '-', '')) = 32
    and replace(new.enrollment_operation_id, '-', '') not glob '*[^0-9a-f]*'
  ) then raise(abort, 'invalid external recovery operation id') end;
  select case when not exists (
    select 1
      from auth_verification
     where id = new.challenge_id
       and type = 'external-recovery-identity-verification'
       and subject = new.id
       and secret_hash is not null
       and consumed_at is null
       and expires_at = new.challenge_expires_at
       and json_valid(metadata)
       and json_extract(metadata, '$.userId') = new.user_id
  ) then raise(abort, 'invalid external recovery challenge binding') end;
end;

create trigger if not exists app_external_recovery_identity_core_immutable
before update of id, user_id, address, normalized_address, comparison_key,
  challenge_id, challenge_expires_at, enrollment_operation_id, created_at
on app_external_recovery_identity
when old.id is not new.id
  or old.user_id is not new.user_id
  or old.address is not new.address
  or old.normalized_address is not new.normalized_address
  or old.comparison_key is not new.comparison_key
  or old.challenge_id is not new.challenge_id
  or old.challenge_expires_at is not new.challenge_expires_at
  or old.enrollment_operation_id is not new.enrollment_operation_id
  or old.created_at is not new.created_at
begin
  select raise(abort, 'external recovery identity core fields are immutable');
end;

create trigger if not exists app_external_recovery_identity_version_transition
before update of status, version on app_external_recovery_identity
when old.status is not new.status or old.version is not new.version
begin
  select case when new.status is old.status or new.version <> old.version + 1
    then raise(abort, 'invalid external recovery identity version transition') end;
end;

create trigger if not exists app_external_recovery_identity_verification_challenge
before update of status on app_external_recovery_identity
when old.status = 'pending' and new.status = 'verified'
begin
  select case when not exists (
    select 1
      from auth_verification
     where id = old.challenge_id
       and type = 'external-recovery-identity-verification'
       and subject = old.id
       and secret_hash is not null
       and expires_at = old.challenge_expires_at
       and consumed_at = new.verified_at
       and consumed_at < expires_at
  ) then raise(abort, 'external recovery challenge was not consumed atomically') end;
end;

create trigger if not exists auth_verification_external_recovery_immutable
before update of type, subject, secret_hash, expires_at, metadata on auth_verification
when exists (
  select 1
    from app_external_recovery_identity
   where challenge_id = old.id and status = 'pending'
)
begin
  select raise(abort, 'pending external recovery challenge is immutable');
end;

drop index if exists app_external_recovery_identity_pending_user_idx;
drop index if exists app_external_recovery_identity_active_address_idx;

create unique index if not exists app_external_recovery_identity_verified_address_idx
  on app_external_recovery_identity (comparison_key)
  where status = 'verified';

create index if not exists app_external_recovery_identity_pending_user_expiry_idx
  on app_external_recovery_identity (user_id, challenge_expires_at)
  where status = 'pending';

create index if not exists app_external_recovery_identity_pending_address_expiry_idx
  on app_external_recovery_identity (comparison_key, challenge_expires_at)
  where status = 'pending';

create trigger if not exists app_external_recovery_identity_active_duplicate_insert
before insert on app_external_recovery_identity
when new.status in ('pending', 'verified')
 and exists (
   select 1 from app_external_recovery_identity
    where (user_id = new.user_id or comparison_key = new.comparison_key)
      and (
        status = 'verified'
        or (status = 'pending'
          and challenge_expires_at > cast(unixepoch('subsec') * 1000 as integer))
      )
 )
begin
  select raise(abort, 'external recovery identity conflicts with active identity');
end;

drop trigger if exists app_mailbox_address_recovery_conflict_insert;
create trigger app_mailbox_address_recovery_conflict_insert
before insert on app_mailbox_address
when exists (
  select 1 from app_external_recovery_identity
   where comparison_key = lower(new.normalized_address)
     and (
       status = 'verified'
       or (status = 'pending'
         and challenge_expires_at > cast(unixepoch('subsec') * 1000 as integer))
     )
)
begin
  select raise(abort, 'mailbox address conflicts with external recovery identity');
end;

drop trigger if exists app_mailbox_address_recovery_conflict_update;
create trigger app_mailbox_address_recovery_conflict_update
before update of normalized_address on app_mailbox_address
when exists (
  select 1 from app_external_recovery_identity
   where comparison_key = lower(new.normalized_address)
     and (
       status = 'verified'
       or (status = 'pending'
         and challenge_expires_at > cast(unixepoch('subsec') * 1000 as integer))
     )
)
begin
  select raise(abort, 'mailbox address conflicts with external recovery identity');
end;

drop trigger if exists auth_user_identity_recovery_conflict_insert;
create trigger auth_user_identity_recovery_conflict_insert
before insert on auth_user_identity
when new.kind = 'email' and new.revoked_at is null
 and exists (
   select 1 from app_external_recovery_identity
    where comparison_key = lower(new.normalized_value)
      and (
        status = 'verified'
        or (status = 'pending'
          and challenge_expires_at > cast(unixepoch('subsec') * 1000 as integer))
      )
 )
begin
  select raise(abort, 'login identity conflicts with external recovery identity');
end;

drop trigger if exists auth_user_identity_recovery_conflict_update;
create trigger auth_user_identity_recovery_conflict_update
before update of kind, normalized_value, revoked_at on auth_user_identity
when new.kind = 'email' and new.revoked_at is null
 and exists (
   select 1 from app_external_recovery_identity
    where comparison_key = lower(new.normalized_value)
      and (
        status = 'verified'
        or (status = 'pending'
          and challenge_expires_at > cast(unixepoch('subsec') * 1000 as integer))
      )
 )
begin
  select raise(abort, 'login identity conflicts with external recovery identity');
end;

create trigger if not exists app_external_recovery_identity_upgrade_contract
before update of updated_at on app_external_recovery_identity
begin
  select case when not (
    length(new.enrollment_operation_id) = 36
    and new.enrollment_operation_id = lower(trim(new.enrollment_operation_id))
    and substr(new.enrollment_operation_id, 9, 1) = '-'
    and substr(new.enrollment_operation_id, 14, 1) = '-'
    and substr(new.enrollment_operation_id, 15, 1) = '4'
    and substr(new.enrollment_operation_id, 19, 1) = '-'
    and substr(new.enrollment_operation_id, 20, 1) in ('8', '9', 'a', 'b')
    and substr(new.enrollment_operation_id, 24, 1) = '-'
    and length(replace(new.enrollment_operation_id, '-', '')) = 32
    and replace(new.enrollment_operation_id, '-', '') not glob '*[^0-9a-f]*'
  ) then raise(abort, 'invalid existing external recovery operation id') end;
  select case when new.status = 'pending' and not exists (
    select 1 from auth_verification
     where id = new.challenge_id
       and type = 'external-recovery-identity-verification'
       and subject = new.id
       and secret_hash is not null
       and consumed_at is null
       and expires_at = new.challenge_expires_at
       and json_valid(metadata)
       and json_extract(metadata, '$.userId') = new.user_id
  ) then raise(abort, 'invalid existing external recovery challenge binding') end;
  select case when new.verified_at is not null and not exists (
    select 1 from auth_verification
     where id = new.challenge_id
       and type = 'external-recovery-identity-verification'
       and subject = new.id
       and secret_hash is not null
       and expires_at = new.challenge_expires_at
       and consumed_at = new.verified_at
       and consumed_at < expires_at
       and json_valid(metadata)
       and json_extract(metadata, '$.userId') = new.user_id
  ) then raise(abort, 'invalid existing external recovery verification proof') end;
end;

update app_external_recovery_identity set updated_at = updated_at;

drop trigger app_external_recovery_identity_upgrade_contract;
