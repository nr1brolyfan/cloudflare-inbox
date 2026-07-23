create table if not exists app_mailbox_administration_receipt (
  operation_id text primary key,
  operation_kind text not null,
  actor_user_id text not null,
  mailbox_id text not null,
  display_name text not null,
  expected_version integer,
  result_mailbox_id text not null,
  result_display_name text not null,
  result_status text not null,
  result_created_by_user_id text not null,
  result_created_at integer not null,
  result_updated_at integer not null,
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
  check (operation_kind in ('bootstrap-owner', 'rename')),
  check (length(actor_user_id) between 1 and 128 and actor_user_id = trim(actor_user_id)),
  check (length(mailbox_id) between 1 and 128),
  check (length(display_name) between 1 and 200),
  check (
    (operation_kind = 'bootstrap-owner' and expected_version is null)
    or (operation_kind = 'rename' and expected_version >= 1)
  ),
  check (result_mailbox_id = mailbox_id),
  check (result_display_name = display_name),
  check (result_status = 'active'),
  check (length(result_created_by_user_id) between 1 and 128),
  check (result_created_at >= 0),
  check (result_updated_at >= result_created_at),
  check (result_version >= 1),
  check (committed_at = result_updated_at),
  check (schema_version = 1)
);

create index if not exists app_mailbox_administration_receipt_actor_operation_idx
  on app_mailbox_administration_receipt (actor_user_id, operation_id);

create trigger if not exists app_mailbox_administration_receipt_binding
before insert on app_mailbox_administration_receipt
when not exists (
  select 1 from app_mailbox
   where id = new.result_mailbox_id
     and display_name = new.result_display_name
     and status = new.result_status
     and created_by_user_id = new.result_created_by_user_id
     and created_at = new.result_created_at
     and updated_at = new.result_updated_at
     and version = new.result_version
)
begin
  select raise(abort, 'invalid mailbox administration receipt binding');
end;

create trigger if not exists app_mailbox_administration_receipt_no_update
before update on app_mailbox_administration_receipt
begin
  select raise(abort, 'mailbox administration receipts are immutable');
end;

create trigger if not exists app_mailbox_administration_receipt_no_delete
before delete on app_mailbox_administration_receipt
begin
  select raise(abort, 'mailbox administration receipts are retained');
end;

create trigger if not exists app_mailbox_administration_receipt_no_replace
before insert on app_mailbox_administration_receipt
when exists (
  select 1 from app_mailbox_administration_receipt
   where operation_id = new.operation_id
)
begin
  select raise(abort, 'mailbox administration receipts are immutable');
end;
