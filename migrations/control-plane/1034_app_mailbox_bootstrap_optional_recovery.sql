-- Recovery identities, passkeys, and recovery codes are optional account
-- security features and do not authorize primary mailbox creation.
drop trigger app_mailbox_bootstrap_security_intent_required;

create trigger app_mailbox_bootstrap_first_owner_password_required
before insert on app_mailbox_administration_receipt
when new.operation_kind = 'bootstrap-owner'
 and exists (select 1 from app_first_owner_password_enrollment)
 and not exists (
   select 1 from app_first_owner_password_enrollment
    where singleton_key = 1
      and actor_user_id = new.actor_user_id
      and schema_version = 1
      and committed_at <= new.committed_at
 )
begin
  select raise(abort, 'matching first-owner password enrollment is required');
end;
