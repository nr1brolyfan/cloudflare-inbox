create table if not exists app_recovery_code_rotation_receipt (
  operation_id text primary key,
  user_id text not null,
  expected_previous_set_id text,
  resulting_set_id text not null unique,
  generated_at integer not null,
  committed_at integer not null,
  code_count integer not null,
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
  check (length(user_id) between 1 and 128 and user_id = trim(user_id)),
  check (
    expected_previous_set_id is null
    or (length(expected_previous_set_id) = 36
      and expected_previous_set_id = lower(trim(expected_previous_set_id))
      and substr(expected_previous_set_id, 9, 1) = '-'
      and substr(expected_previous_set_id, 14, 1) = '-'
      and substr(expected_previous_set_id, 15, 1) = '4'
      and substr(expected_previous_set_id, 19, 1) = '-'
      and substr(expected_previous_set_id, 20, 1) in ('8', '9', 'a', 'b')
      and substr(expected_previous_set_id, 24, 1) = '-'
      and length(replace(expected_previous_set_id, '-', '')) = 32
      and replace(expected_previous_set_id, '-', '') not glob '*[^0-9a-f]*')
  ),
  check (
    length(resulting_set_id) = 36
    and resulting_set_id = lower(trim(resulting_set_id))
    and substr(resulting_set_id, 9, 1) = '-'
    and substr(resulting_set_id, 14, 1) = '-'
    and substr(resulting_set_id, 15, 1) = '4'
    and substr(resulting_set_id, 19, 1) = '-'
    and substr(resulting_set_id, 20, 1) in ('8', '9', 'a', 'b')
    and substr(resulting_set_id, 24, 1) = '-'
    and length(replace(resulting_set_id, '-', '')) = 32
    and replace(resulting_set_id, '-', '') not glob '*[^0-9a-f]*'
    and resulting_set_id is not expected_previous_set_id
  ),
  check (generated_at >= 0 and committed_at >= generated_at),
  check (code_count = 10),
  check (schema_version = 1)
);

create index if not exists app_recovery_code_rotation_receipt_user_operation_idx
  on app_recovery_code_rotation_receipt (user_id, operation_id);

create trigger if not exists app_recovery_code_rotation_receipt_binding
before insert on app_recovery_code_rotation_receipt
when (
  (select count(*)
     from auth_recovery_code
    where json_valid(metadata)
      and json_extract(metadata, '$.setId') = new.resulting_set_id)
    != new.code_count
  or exists (
    select 1
      from auth_recovery_code
     where json_valid(metadata)
       and json_extract(metadata, '$.setId') = new.resulting_set_id
       and (user_id != new.user_id
         or created_at != new.generated_at
         or used_at is not null
         or revoked_at is not null
         or metadata != json_object('setId', new.resulting_set_id))
  )
  or (new.expected_previous_set_id is not null and (
    not exists (
      select 1
        from auth_recovery_code
       where user_id = new.user_id
         and metadata = json_object('setId', new.expected_previous_set_id)
    )
    or exists (
      select 1
        from auth_recovery_code
       where user_id = new.user_id
         and used_at is null
         and revoked_at is null
         and metadata = json_object('setId', new.expected_previous_set_id)
    )
  ))
)
begin
  select raise(abort, 'invalid recovery-code rotation receipt binding');
end;

create trigger if not exists app_recovery_code_rotation_receipt_no_update
before update on app_recovery_code_rotation_receipt
begin
  select raise(abort, 'recovery-code rotation receipts are immutable');
end;

create trigger if not exists app_recovery_code_rotation_receipt_no_delete
before delete on app_recovery_code_rotation_receipt
begin
  select raise(abort, 'recovery-code rotation receipts are retained');
end;

create trigger if not exists app_recovery_code_rotation_receipt_no_replace
before insert on app_recovery_code_rotation_receipt
when exists (
  select 1 from app_recovery_code_rotation_receipt
   where operation_id = new.operation_id
)
begin
  select raise(abort, 'recovery-code rotation receipts are immutable');
end;
