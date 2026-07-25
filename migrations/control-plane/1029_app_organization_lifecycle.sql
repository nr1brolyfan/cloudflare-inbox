-- ORG-013 is a forward-only cutover. Reserved artifacts must not pre-exist,
-- and the exact predecessor lifecycle trigger must still be installed.
create temp table app_organization_lifecycle_entry_preflight (
  valid integer not null check (valid = 1)
);

insert into app_organization_lifecycle_entry_preflight (valid)
select case when
  not exists (select 1 from sqlite_master where name glob
    'app_organization_administrative_audit*')
  and not exists (select 1 from sqlite_master where name glob
    'app_organization_administration_receipt*')
  and not exists (select 1 from sqlite_master where name glob
    'app_organization_lifecycle_generation*')
  and not exists (select 1 from sqlite_master where name glob
    'app_organization_operation_fence*')
  and not exists (select 1 from sqlite_master where name glob
    'app_organization_lifecycle_activation*')
  and (select sql from sqlite_master where type = 'trigger'
    and name = 'app_organization_update_lifecycle') = 'CREATE TRIGGER app_organization_update_lifecycle
before update on app_organization
when old.status is not new.status
  or old.updated_at is not new.updated_at
  or old.version is not new.version
begin
  select case when new.version <> old.version + 1
    or new.updated_at < old.updated_at
    then raise(abort, ''invalid organization lifecycle update'') end;
end'
  and (select count(*) from app_user_organization_preference_generation) = 1
  and exists (select 1 from app_user_organization_preference_generation
    where id = 1 and schema_version = 1
      and artifact_sql_json = (select json_group_array(json_object(
        'type', type, 'name', name, 'tbl_name', tbl_name, 'sql', sql
      )) from (select type, name, tbl_name, sql from sqlite_master where name in (
        'app_mailbox_organization_id_unique_idx',
        'app_user_organization_preference',
        'app_user_organization_preference_user_idx',
        'app_user_organization_preference_default_idx',
        'app_user_organization_preference_insert_contract',
        'app_user_organization_preference_no_replace',
        'app_user_organization_preference_identity_immutable',
        'app_user_organization_preference_update_contract',
        'app_user_organization_preference_parent_contract',
        'app_user_organization_preference_no_delete',
        'app_user_preference_frozen_insert',
        'app_user_preference_frozen_update',
        'app_user_preference_frozen_delete',
        'app_user_organization_preference_cutover',
        'app_user_organization_preference_cutover_no_insert',
        'app_user_organization_preference_cutover_no_update',
        'app_user_organization_preference_cutover_no_delete',
        'app_user_organization_preference_generation',
        'app_user_organization_preference_generation_no_replace',
        'app_user_organization_preference_generation_no_update',
        'app_user_organization_preference_generation_no_delete'
      ) order by type, name))
      and foreign_key_json = (select json_group_array(json_object(
        'id', id, 'seq', seq, 'table', "table", 'from', "from", 'to', "to",
        'on_update', on_update, 'on_delete', on_delete, 'match', match
      )) from (select * from pragma_foreign_key_list(
        'app_user_organization_preference') order by id, seq))
      and index_json = (select json_group_array(json_object(
        'seq', seq, 'name', name, 'unique', "unique", 'origin', origin,
        'partial', partial
      )) from (select * from pragma_index_list(
        'app_user_organization_preference') order by name))
      and predecessor_generation_json = (select json_object(
        'artifact_sql_json', artifact_sql_json,
        'column_json', column_json,
        'foreign_key_json', foreign_key_json
      ) from app_mailbox_organization_generation where id = 1))
  and not exists (select 1 from pragma_foreign_key_check)
then 1 else 0 end;

drop table app_organization_lifecycle_entry_preflight;

create table app_organization_lifecycle_activation (
  id integer primary key check (id = 1),
  status text not null check (status in ('expanded', 'active')),
  schema_version integer not null check (schema_version = 1)
);

insert into app_organization_lifecycle_activation
  (id, status, schema_version)
values (1, 'expanded', 1);

create trigger app_organization_lifecycle_activation_no_insert
before insert on app_organization_lifecycle_activation
begin
  select raise(abort, 'organization lifecycle activation is sealed');
end;

create trigger app_organization_lifecycle_activation_no_update
before update on app_organization_lifecycle_activation
begin
  select raise(abort, 'organization lifecycle activation requires a successor migration');
end;

create trigger app_organization_lifecycle_activation_no_delete
before delete on app_organization_lifecycle_activation
begin
  select raise(abort, 'organization lifecycle activation is retained');
end;

create trigger app_organization_lifecycle_activation_no_replace
before insert on app_organization_lifecycle_activation
when exists (select 1 from app_organization_lifecycle_activation
  where id = new.id)
begin
  select raise(abort, 'organization lifecycle activation is immutable');
end;

create table app_organization_operation_fence (
  holder_id text primary key,
  operation_id text not null,
  operation_kind text not null,
  organization_id text not null,
  mailbox_id text not null,
  created_at integer not null,
  foreign key (organization_id) references app_organization(id)
    on update restrict on delete restrict,
  foreign key (organization_id, mailbox_id)
    references app_mailbox(organization_id, id)
    on update restrict on delete restrict,
  check (
    typeof(holder_id) = 'text'
    and length(holder_id) = 36
    and holder_id = lower(trim(holder_id))
    and substr(holder_id, 9, 1) = '-'
    and substr(holder_id, 14, 1) = '-'
    and substr(holder_id, 15, 1) = '4'
    and substr(holder_id, 19, 1) = '-'
    and substr(holder_id, 20, 1) in ('8', '9', 'a', 'b')
    and substr(holder_id, 24, 1) = '-'
    and length(replace(holder_id, '-', '')) = 32
    and replace(holder_id, '-', '') not glob '*[^0-9a-f]*'
    and typeof(operation_id) = 'text'
    and length(operation_id) between 1 and 256
    and operation_kind in ('inbound-commit', 'outbound-dispatch')
  ),
  check (
    typeof(created_at) = 'integer'
    and created_at between 0 and 9007199254740991
  )
);

create index app_organization_operation_fence_organization_idx
  on app_organization_operation_fence
    (organization_id, operation_id, holder_id);

create trigger app_organization_operation_fence_insert_contract
before insert on app_organization_operation_fence
when not exists (
  select 1 from app_mailbox mailbox
  join app_organization organization
    on organization.id = mailbox.organization_id
   and organization.status = 'active'
  where mailbox.id = new.mailbox_id
    and mailbox.organization_id = new.organization_id
    and mailbox.status = 'active'
    and mailbox.deleted_at is null
)
begin
  select raise(abort, 'operation fence requires an active mailbox organization');
end;

create trigger app_organization_operation_fence_no_update
before update on app_organization_operation_fence
begin
  select raise(abort, 'organization operation fences are immutable');
end;

create trigger app_organization_operation_fence_no_replace
before insert on app_organization_operation_fence
when exists (select 1 from app_organization_operation_fence
  where rowid = new.rowid or holder_id = new.holder_id)
begin
  select raise(abort, 'organization operation fences cannot be replaced');
end;

create table app_organization_administrative_audit_event (
  storage_id integer primary key autoincrement,
  event_id text not null unique,
  schema_version integer not null,
  event_version integer not null,
  operation_id text not null unique,
  action text not null,
  actor_id text not null,
  organization_id text not null,
  reason_code text not null,
  change_type text not null,
  resource_version_before integer not null,
  resource_version_after integer not null,
  request_id text not null,
  correlation_id text not null,
  occurred_at integer not null,
  foreign key (organization_id) references app_organization(id)
    on update restrict on delete restrict,
  foreign key (actor_id) references auth_user(id)
    on update restrict on delete restrict,
  check (
    length(event_id) = 83
    and substr(event_id, 1, 19) = 'admin-audit-sha256:'
    and substr(event_id, 20) not glob '*[^0-9a-f]*'
  ),
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
    schema_version = 1
    and event_version = 1
    and length(actor_id) between 1 and 128
    and actor_id = trim(actor_id)
    and length(organization_id) between 1 and 128
    and organization_id not glob '*[^A-Za-z0-9_-]*'
    and typeof(resource_version_before) = 'integer'
    and resource_version_before between 1 and 9007199254740990
    and typeof(resource_version_after) = 'integer'
    and resource_version_after = resource_version_before + 1
    and typeof(occurred_at) = 'integer'
    and occurred_at between 0 and 9007199254740991
    and length(request_id) = 36
    and request_id = lower(trim(request_id))
    and substr(request_id, 9, 1) = '-'
    and substr(request_id, 14, 1) = '-'
    and substr(request_id, 15, 1) = '4'
    and substr(request_id, 19, 1) = '-'
    and substr(request_id, 20, 1) in ('8', '9', 'a', 'b')
    and substr(request_id, 24, 1) = '-'
    and length(replace(request_id, '-', '')) = 32
    and replace(request_id, '-', '') not glob '*[^0-9a-f]*'
    and length(correlation_id) = 36
    and correlation_id = lower(trim(correlation_id))
    and substr(correlation_id, 9, 1) = '-'
    and substr(correlation_id, 14, 1) = '-'
    and substr(correlation_id, 15, 1) = '4'
    and substr(correlation_id, 19, 1) = '-'
    and substr(correlation_id, 20, 1) in ('8', '9', 'a', 'b')
    and substr(correlation_id, 24, 1) = '-'
    and length(replace(correlation_id, '-', '')) = 32
    and replace(correlation_id, '-', '') not glob '*[^0-9a-f]*'
    and ((action = 'organization.suspend'
      and reason_code = 'organization-suspended'
      and change_type = 'organization-suspended')
    or (action = 'organization.resume'
      and reason_code = 'organization-resumed'
      and change_type = 'organization-resumed'))
  )
);

create index app_organization_administrative_audit_tenant_time_idx
  on app_organization_administrative_audit_event
    (organization_id, occurred_at desc, storage_id desc);
create index app_organization_administrative_audit_actor_time_idx
  on app_organization_administrative_audit_event
    (actor_id, occurred_at desc, storage_id desc);

create trigger app_organization_administrative_audit_parent
before insert on app_organization_administrative_audit_event
when not exists (select 1 from app_organization
  where id = new.organization_id)
  or not exists (select 1 from auth_user where id = new.actor_id)
begin
  select raise(abort, 'organization audit parent does not exist');
end;

create trigger app_organization_administrative_audit_no_update
before update on app_organization_administrative_audit_event
begin
  select raise(abort, 'organization administrative audit events are append-only');
end;

create trigger app_organization_administrative_audit_no_delete
before delete on app_organization_administrative_audit_event
begin
  select raise(abort, 'organization administrative audit events are retained');
end;

create trigger app_organization_administrative_audit_no_replace
before insert on app_organization_administrative_audit_event
when exists (
  select 1 from app_organization_administrative_audit_event
   where storage_id = new.storage_id
      or event_id = new.event_id
      or operation_id = new.operation_id
)
begin
  select raise(abort, 'organization administrative audit events are immutable');
end;

create table app_organization_administration_receipt (
  operation_id text primary key,
  operation_kind text not null,
  actor_user_id text not null,
  organization_id text not null,
  expected_version integer not null,
  result_status text not null,
  result_created_at integer not null,
  result_updated_at integer not null,
  result_version integer not null,
  committed_at integer not null,
  audit_event_id text not null unique,
  matrix_id text not null,
  matrix_version integer not null,
  step_up_policy_id text not null,
  step_up_policy_version integer not null,
  schema_version integer not null,
  foreign key (actor_user_id) references auth_user(id)
    on update restrict on delete restrict,
  foreign key (organization_id) references app_organization(id)
    on update restrict on delete restrict,
  foreign key (audit_event_id)
    references app_organization_administrative_audit_event(event_id)
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
  check (
    typeof(expected_version) = 'integer'
    and expected_version between 1 and 9007199254740990
    and result_version = expected_version + 1
    and typeof(result_created_at) = 'integer'
    and result_created_at between 0 and 9007199254740991
    and typeof(result_updated_at) = 'integer'
    and result_updated_at between result_created_at and 9007199254740991
    and committed_at = result_updated_at
    and ((operation_kind = 'suspend' and result_status = 'suspended')
      or (operation_kind = 'resume' and result_status = 'active'))
  ),
  check (
    matrix_id = 'organization-operations'
    and matrix_version = 1
    and step_up_policy_id = 'control-plane-sensitive'
    and step_up_policy_version = 1
    and schema_version = 1
  )
);

create index app_organization_administration_receipt_actor_operation_idx
  on app_organization_administration_receipt (actor_user_id, operation_id);

create trigger app_organization_administration_receipt_binding
before insert on app_organization_administration_receipt
when not exists (select 1 from auth_user where id = new.actor_user_id)
  or not exists (
  select 1
    from app_organization organization
    join app_organization_administrative_audit_event audit
      on audit.event_id = new.audit_event_id
     and audit.operation_id = new.operation_id
     and audit.actor_id = new.actor_user_id
     and audit.organization_id = new.organization_id
     and audit.resource_version_before = new.expected_version
     and audit.resource_version_after = new.result_version
     and audit.occurred_at = new.committed_at
   where organization.id = new.organization_id
     and organization.status = new.result_status
     and organization.created_at = new.result_created_at
     and organization.updated_at = new.result_updated_at
     and organization.version = new.result_version
     and ((new.operation_kind = 'suspend'
       and audit.action = 'organization.suspend')
      or (new.operation_kind = 'resume'
       and audit.action = 'organization.resume'))
)
begin
  select raise(abort, 'invalid organization administration receipt binding');
end;

create trigger app_organization_administration_receipt_no_update
before update on app_organization_administration_receipt
begin
  select raise(abort, 'organization administration receipts are immutable');
end;

create trigger app_organization_administration_receipt_no_delete
before delete on app_organization_administration_receipt
begin
  select raise(abort, 'organization administration receipts are retained');
end;

create trigger app_organization_administration_receipt_no_replace
before insert on app_organization_administration_receipt
when exists (
  select 1 from app_organization_administration_receipt
   where operation_id = new.operation_id
)
begin
  select raise(abort, 'organization administration receipts are immutable');
end;

drop trigger app_organization_update_lifecycle;

create trigger app_organization_update_lifecycle
before update on app_organization
begin
  select case when new.id is old.id
      and new.created_at is old.created_at
      and new.status in ('active', 'suspended')
      and new.updated_at between old.updated_at and 9007199254740991
      and new.version between 1 and 9007199254740991
      and (new.version <> old.version + 1
        or not ((old.status = 'active' and new.status = 'suspended')
          or (old.status = 'suspended' and new.status = 'active'))
        or not exists (
          select 1 from app_organization_administrative_audit_event audit
           where audit.organization_id = old.id
             and audit.resource_version_before = old.version
             and audit.resource_version_after = new.version
             and audit.occurred_at = new.updated_at
             and ((old.status = 'active' and new.status = 'suspended'
               and audit.action = 'organization.suspend')
              or (old.status = 'suspended' and new.status = 'active'
               and audit.action = 'organization.resume'))
        )
        or exists (select 1 from app_organization_operation_fence
          where organization_id = old.id)
        or not exists (select 1 from app_organization_lifecycle_activation
          where id = 1 and status = 'active' and schema_version = 1))
    then raise(abort, 'invalid organization lifecycle update') end;
end;

create table app_organization_lifecycle_generation (
  id integer primary key check (id = 1),
  schema_version integer not null check (schema_version = 1),
  artifact_sql_json text not null
    check (json_valid(artifact_sql_json) and json_type(artifact_sql_json) = 'array'),
  foreign_key_json text not null
    check (json_valid(foreign_key_json) and json_type(foreign_key_json) = 'object')
);

create trigger app_organization_lifecycle_generation_no_replace
before insert on app_organization_lifecycle_generation
when exists (select 1 from app_organization_lifecycle_generation
  where id = new.id)
begin
  select raise(abort, 'organization lifecycle generation is sealed');
end;

create trigger app_organization_lifecycle_generation_no_update
before update on app_organization_lifecycle_generation
begin
  select raise(abort, 'organization lifecycle generation is immutable');
end;

create trigger app_organization_lifecycle_generation_no_delete
before delete on app_organization_lifecycle_generation
begin
  select raise(abort, 'organization lifecycle generation is retained');
end;

insert into app_organization_lifecycle_generation
  (id, schema_version, artifact_sql_json, foreign_key_json)
select 1, 1,
  (select json_group_array(json_object(
    'type', type, 'name', name, 'tbl_name', tbl_name, 'sql', sql
  )) from (select type, name, tbl_name, sql from sqlite_master where name in (
    'app_organization_administrative_audit_event',
    'app_organization_administrative_audit_tenant_time_idx',
    'app_organization_administrative_audit_actor_time_idx',
    'app_organization_administrative_audit_parent',
    'app_organization_administrative_audit_no_update',
    'app_organization_administrative_audit_no_delete',
    'app_organization_administrative_audit_no_replace',
    'app_organization_administration_receipt',
    'app_organization_administration_receipt_actor_operation_idx',
    'app_organization_administration_receipt_binding',
    'app_organization_administration_receipt_no_update',
    'app_organization_administration_receipt_no_delete',
    'app_organization_administration_receipt_no_replace',
    'app_organization_update_lifecycle',
    'app_organization_lifecycle_activation',
    'app_organization_lifecycle_activation_no_insert',
    'app_organization_lifecycle_activation_no_update',
    'app_organization_lifecycle_activation_no_delete',
    'app_organization_lifecycle_activation_no_replace',
    'app_organization_operation_fence',
    'app_organization_operation_fence_organization_idx',
    'app_organization_operation_fence_insert_contract',
    'app_organization_operation_fence_no_update',
    'app_organization_operation_fence_no_replace',
    'app_organization_lifecycle_generation',
    'app_organization_lifecycle_generation_no_replace',
    'app_organization_lifecycle_generation_no_update',
    'app_organization_lifecycle_generation_no_delete'
  ) order by type, name)),
  json_object(
    'audit', (select json_group_array(json_object(
      'id', id, 'seq', seq, 'table', "table", 'from', "from", 'to', "to",
      'on_update', on_update, 'on_delete', on_delete, 'match', match
    )) from (select * from pragma_foreign_key_list(
      'app_organization_administrative_audit_event') order by id, seq)),
    'receipt', (select json_group_array(json_object(
      'id', id, 'seq', seq, 'table', "table", 'from', "from", 'to', "to",
      'on_update', on_update, 'on_delete', on_delete, 'match', match
    )) from (select * from pragma_foreign_key_list(
      'app_organization_administration_receipt') order by id, seq)),
    'fence', (select json_group_array(json_object(
      'id', id, 'seq', seq, 'table', "table", 'from', "from", 'to', "to",
      'on_update', on_update, 'on_delete', on_delete, 'match', match
    )) from (select * from pragma_foreign_key_list(
      'app_organization_operation_fence') order by id, seq))
  );

create temp table app_organization_lifecycle_postflight (
  valid integer not null check (valid = 1)
);

insert into app_organization_lifecycle_postflight (valid)
select case when
  (select count(*) from app_organization_lifecycle_generation) = 1
  and exists (select 1 from app_organization_lifecycle_generation
    where id = 1 and schema_version = 1
      and json_array_length(artifact_sql_json) = 28
      and json_array_length(json_extract(foreign_key_json, '$.audit')) = 2
      and json_array_length(json_extract(foreign_key_json, '$.receipt')) = 3
      and json_array_length(json_extract(foreign_key_json, '$.fence')) = 3)
  and not exists (select 1 from pragma_foreign_key_check)
then 1 else 0 end;

drop table app_organization_lifecycle_postflight;
