-- Explicit local-development companion for bootstrap without recovery setup.
-- Production code never writes this marker.
create table app_mailbox_bootstrap_development_intent (
  operation_id text primary key,
  actor_user_id text not null,
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
  check (length(actor_user_id) between 1 and 128
    and actor_user_id = trim(actor_user_id)),
  check (schema_version = 1)
);

create trigger app_mailbox_bootstrap_development_intent_binding
before insert on app_mailbox_bootstrap_development_intent
when exists (select 1 from app_mailbox_administration_receipt
  where operation_id = new.operation_id)
begin
  select raise(abort, 'invalid mailbox bootstrap development intent binding');
end;

create trigger app_mailbox_bootstrap_development_intent_no_replace
before insert on app_mailbox_bootstrap_development_intent
when exists (select 1 from app_mailbox_bootstrap_development_intent
  where operation_id = new.operation_id)
begin
  select raise(abort, 'mailbox bootstrap development intents are immutable');
end;

create trigger app_mailbox_bootstrap_development_intent_no_update
before update on app_mailbox_bootstrap_development_intent
begin
  select raise(abort, 'mailbox bootstrap development intents are immutable');
end;

create trigger app_mailbox_bootstrap_development_intent_no_delete
before delete on app_mailbox_bootstrap_development_intent
when exists (select 1 from app_mailbox_administration_receipt
  where operation_id = old.operation_id)
begin
  select raise(abort, 'committed mailbox bootstrap development intents are retained');
end;

drop trigger app_mailbox_bootstrap_security_intent_required;

create trigger app_mailbox_bootstrap_security_intent_required
before insert on app_mailbox_administration_receipt
when new.operation_kind = 'bootstrap-owner'
 and exists (select 1 from app_first_owner_password_enrollment)
 and not exists (
   select 1 from app_mailbox_bootstrap_security_intent
    where operation_id = new.operation_id
      and actor_user_id = new.actor_user_id
      and schema_version = 1
 )
 and not exists (
   select 1 from app_mailbox_bootstrap_development_intent
    where operation_id = new.operation_id
      and actor_user_id = new.actor_user_id
      and schema_version = 1
 )
begin
  select raise(abort, 'sealed mailbox bootstrap security intent is required');
end;
