-- Forward-only expected-state companion for sealed first-owner bootstrap.
-- Historical committed receipts intentionally remain companion-less.
create table app_mailbox_bootstrap_security_intent (
  operation_id text primary key,
  actor_user_id text not null,
  recovery_rotation_operation_id text not null,
  schema_version integer not null,
  foreign key (recovery_rotation_operation_id)
    references app_recovery_code_rotation_receipt (operation_id)
      on update restrict on delete restrict,
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
  check (length(recovery_rotation_operation_id) = 36
    and recovery_rotation_operation_id = lower(trim(recovery_rotation_operation_id))),
  check (schema_version = 1)
);

create trigger app_mailbox_bootstrap_security_intent_binding
before insert on app_mailbox_bootstrap_security_intent
when exists (select 1 from app_mailbox_administration_receipt
  where operation_id = new.operation_id)
or not exists (
  select 1 from app_recovery_code_rotation_receipt
   where operation_id = new.recovery_rotation_operation_id
     and user_id = new.actor_user_id
     and code_count = 10
     and schema_version = 1
)
begin
  select raise(abort, 'invalid mailbox bootstrap security intent binding');
end;

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
begin
  select raise(abort, 'sealed mailbox bootstrap security intent is required');
end;

create trigger app_mailbox_bootstrap_security_intent_no_replace
before insert on app_mailbox_bootstrap_security_intent
when exists (select 1 from app_mailbox_bootstrap_security_intent
  where operation_id = new.operation_id)
begin
  select raise(abort, 'mailbox bootstrap security intents are immutable');
end;

create trigger app_mailbox_bootstrap_security_intent_no_update
before update on app_mailbox_bootstrap_security_intent
begin
  select raise(abort, 'mailbox bootstrap security intents are immutable');
end;

create trigger app_mailbox_bootstrap_security_intent_no_delete
before delete on app_mailbox_bootstrap_security_intent
when exists (select 1 from app_mailbox_administration_receipt
  where operation_id = old.operation_id)
begin
  select raise(abort, 'committed mailbox bootstrap security intents are retained');
end;
