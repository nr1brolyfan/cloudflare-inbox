create table if not exists app_external_recovery_identity (
  id text primary key
    check (length(id) between 1 and 128),
  user_id text not null
    check (length(user_id) between 1 and 128),
  address text not null
    check (length(address) between 3 and 320 and address = trim(address)),
  normalized_address text not null
    check (
      length(normalized_address) between 3 and 320
      and normalized_address = trim(normalized_address)
      and instr(address, '@') > 1
      and instr(substr(address, instr(address, '@') + 1), '@') = 0
      and normalized_address =
        substr(address, 1, instr(address, '@'))
        || lower(substr(address, instr(address, '@') + 1))
    ),
  comparison_key text not null
    check (
      length(comparison_key) between 3 and 320
      and comparison_key = lower(trim(comparison_key))
      and comparison_key = lower(address)
    ),
  status text not null
    check (status in ('pending', 'verified', 'revoked')),
  challenge_id text not null
    check (length(challenge_id) between 1 and 128),
  challenge_expires_at integer not null
    check (challenge_expires_at >= 0),
  enrollment_operation_id text not null
    check (length(enrollment_operation_id) between 1 and 128),
  created_at integer not null
    check (created_at >= 0),
  updated_at integer not null
    check (updated_at >= created_at),
  verified_at integer
    check (verified_at is null or verified_at >= created_at),
  revoked_at integer
    check (revoked_at is null or revoked_at >= created_at),
  version integer not null default 1
    check (version >= 1),
  check (challenge_expires_at > created_at),
  check (verified_at is null or verified_at <= updated_at),
  check (revoked_at is null or revoked_at <= updated_at),
  check (
    verified_at is null
    or revoked_at is null
    or revoked_at >= verified_at
  ),
  check (
    (status = 'pending' and verified_at is null and revoked_at is null)
    or (status = 'verified' and verified_at is not null and revoked_at is null)
    or (status = 'revoked' and revoked_at is not null)
  )
);

create unique index if not exists app_external_recovery_identity_challenge_idx
  on app_external_recovery_identity (challenge_id);

create unique index if not exists app_external_recovery_identity_operation_idx
  on app_external_recovery_identity (enrollment_operation_id);

create unique index if not exists app_external_recovery_identity_pending_user_idx
  on app_external_recovery_identity (user_id)
  where status = 'pending';

create unique index if not exists app_external_recovery_identity_verified_user_idx
  on app_external_recovery_identity (user_id)
  where status = 'verified';

create unique index if not exists app_external_recovery_identity_active_address_idx
  on app_external_recovery_identity (comparison_key)
  where status in ('pending', 'verified');

create index if not exists app_external_recovery_identity_pending_expiry_idx
  on app_external_recovery_identity (challenge_expires_at)
  where status = 'pending';

create index if not exists app_mailbox_address_recovery_comparison_idx
  on app_mailbox_address (lower(normalized_address));

create index if not exists auth_user_identity_recovery_comparison_idx
  on auth_user_identity (lower(normalized_value))
  where kind = 'email' and revoked_at is null;

create trigger if not exists app_external_recovery_identity_state_transition
before update of status on app_external_recovery_identity
when old.status <> new.status
 and not (
   (old.status = 'pending' and new.status in ('verified', 'revoked'))
   or (old.status = 'verified' and new.status = 'revoked')
 )
begin
  select raise(abort, 'invalid external recovery identity state transition');
end;

create trigger if not exists app_external_recovery_identity_verified_at_immutable
before update of verified_at on app_external_recovery_identity
when old.verified_at is not new.verified_at
 and not (
   old.status = 'pending'
   and new.status = 'verified'
   and old.verified_at is null
   and new.verified_at is not null
 )
begin
  select raise(abort, 'external recovery verification time is immutable');
end;

create trigger if not exists app_external_recovery_identity_revoked_at_immutable
before update of revoked_at on app_external_recovery_identity
when old.revoked_at is not new.revoked_at
 and not (
   old.status in ('pending', 'verified')
   and new.status = 'revoked'
   and old.revoked_at is null
   and new.revoked_at is not null
 )
begin
  select raise(abort, 'external recovery revocation time is immutable');
end;

create trigger if not exists app_external_recovery_identity_conflict_insert
before insert on app_external_recovery_identity
when new.status in ('pending', 'verified')
begin
  select case when exists (
    select 1 from app_mailbox_address
     where lower(normalized_address) = new.comparison_key
  ) then raise(abort, 'external recovery identity conflicts with mailbox address') end;
  select case when exists (
    select 1 from auth_user_identity
     where kind = 'email'
       and revoked_at is null
       and lower(normalized_value) = new.comparison_key
  ) then raise(abort, 'external recovery identity conflicts with login identity') end;
end;

create trigger if not exists app_external_recovery_identity_conflict_update
before update of address, comparison_key, status, revoked_at
on app_external_recovery_identity
when new.status in ('pending', 'verified')
begin
  select case when exists (
    select 1 from app_mailbox_address
     where lower(normalized_address) = new.comparison_key
  ) then raise(abort, 'external recovery identity conflicts with mailbox address') end;
  select case when exists (
    select 1 from auth_user_identity
     where kind = 'email'
       and revoked_at is null
       and lower(normalized_value) = new.comparison_key
  ) then raise(abort, 'external recovery identity conflicts with login identity') end;
end;

create trigger if not exists app_mailbox_address_recovery_conflict_insert
before insert on app_mailbox_address
when exists (
  select 1 from app_external_recovery_identity
   where status in ('pending', 'verified')
     and comparison_key = lower(new.normalized_address)
)
begin
  select raise(abort, 'mailbox address conflicts with external recovery identity');
end;

create trigger if not exists app_mailbox_address_recovery_conflict_update
before update of normalized_address on app_mailbox_address
when exists (
  select 1 from app_external_recovery_identity
   where status in ('pending', 'verified')
     and comparison_key = lower(new.normalized_address)
)
begin
  select raise(abort, 'mailbox address conflicts with external recovery identity');
end;

create trigger if not exists auth_user_identity_recovery_conflict_insert
before insert on auth_user_identity
when new.kind = 'email'
 and new.revoked_at is null
 and exists (
   select 1 from app_external_recovery_identity
    where status in ('pending', 'verified')
      and comparison_key = lower(new.normalized_value)
 )
begin
  select raise(abort, 'login identity conflicts with external recovery identity');
end;

create trigger if not exists auth_user_identity_recovery_conflict_update
before update of kind, normalized_value, revoked_at on auth_user_identity
when new.kind = 'email'
 and new.revoked_at is null
 and exists (
   select 1 from app_external_recovery_identity
    where status in ('pending', 'verified')
      and comparison_key = lower(new.normalized_value)
 )
begin
  select raise(abort, 'login identity conflicts with external recovery identity');
end;
