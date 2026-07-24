create temp table app_organization_owner_assignment_application (
  receipt_was_present integer not null check (receipt_was_present in (0, 1)),
  cutover_was_present integer not null check (cutover_was_present in (0, 1))
);

insert into app_organization_owner_assignment_application
  (receipt_was_present, cutover_was_present)
select
  exists (select 1 from sqlite_master where type = 'table'
    and name = 'app_organization_owner_assignment_receipt'),
  exists (select 1 from sqlite_master where type = 'table'
    and name = 'app_organization_owner_assignment_cutover');

create temp table app_organization_owner_assignment_entry_preflight (
  valid integer not null check (valid = 1)
);

-- Refuse successor generations and reserved-name collisions before any DROP.
insert into app_organization_owner_assignment_entry_preflight (valid)
select case when
  not exists (select 1 from pragma_table_xinfo('app_mailbox')
    where name = 'organization_id')
  and not exists (select 1 from sqlite_master
    where name glob 'app_organization_owner_assignment_*'
      and name not in (
        'app_organization_owner_assignment_receipt',
        'app_organization_owner_assignment_cutover',
        'app_organization_owner_assignment_receipt_binding',
        'app_organization_owner_assignment_receipt_no_replace',
        'app_organization_owner_assignment_receipt_no_update',
        'app_organization_owner_assignment_receipt_no_delete',
        'app_organization_owner_assignment_cutover_no_insert',
        'app_organization_owner_assignment_cutover_no_update',
        'app_organization_owner_assignment_cutover_no_delete',
        'app_organization_owner_assignment_from_bootstrap_audit'
      ))
  and (select receipt_was_present
         from app_organization_owner_assignment_application)
    = (select cutover_was_present
         from app_organization_owner_assignment_application)
  and (
    ((select receipt_was_present
        from app_organization_owner_assignment_application) = 0
      and not exists (select 1 from sqlite_master where name in (
        'app_organization_owner_assignment_receipt_binding',
        'app_organization_owner_assignment_receipt_no_replace',
        'app_organization_owner_assignment_receipt_no_update',
        'app_organization_owner_assignment_receipt_no_delete',
        'app_organization_owner_assignment_cutover_no_insert',
        'app_organization_owner_assignment_cutover_no_update',
        'app_organization_owner_assignment_cutover_no_delete',
        'app_organization_owner_assignment_from_bootstrap_audit')))
    or
    ((select receipt_was_present
        from app_organization_owner_assignment_application) = 1
      and not exists (select 1 from sqlite_master where
        (name in (
          'app_organization_owner_assignment_receipt_binding',
          'app_organization_owner_assignment_receipt_no_replace',
          'app_organization_owner_assignment_receipt_no_update',
          'app_organization_owner_assignment_receipt_no_delete')
          and (type <> 'trigger'
            or tbl_name <> 'app_organization_owner_assignment_receipt'))
        or (name in (
          'app_organization_owner_assignment_cutover_no_insert',
          'app_organization_owner_assignment_cutover_no_update',
          'app_organization_owner_assignment_cutover_no_delete')
          and (type <> 'trigger'
            or tbl_name <> 'app_organization_owner_assignment_cutover'))
        or (name = 'app_organization_owner_assignment_from_bootstrap_audit'
          and (type <> 'trigger'
            or tbl_name <> 'app_administrative_audit_event')))
      )
  )
then 1 else 0 end;

drop table app_organization_owner_assignment_entry_preflight;

drop trigger if exists app_organization_owner_assignment_receipt_binding;
drop trigger if exists app_organization_owner_assignment_receipt_no_replace;
drop trigger if exists app_organization_owner_assignment_receipt_no_update;
drop trigger if exists app_organization_owner_assignment_receipt_no_delete;
drop trigger if exists app_organization_owner_assignment_cutover_no_insert;
drop trigger if exists app_organization_owner_assignment_cutover_no_update;
drop trigger if exists app_organization_owner_assignment_cutover_no_delete;
drop trigger if exists app_organization_owner_assignment_from_bootstrap_audit;

create table if not exists app_organization_owner_assignment_cutover (
  id integer primary key,
  schema_version integer not null,
  constraint app_organization_owner_assignment_cutover_id_check
    check (id = 1),
  constraint app_organization_owner_assignment_cutover_schema_check
    check (typeof(schema_version) = 'integer' and schema_version = 1)
);

create table if not exists app_organization_owner_assignment_receipt (
  organization_id text not null primary key,
  mailbox_id text not null,
  user_id text not null,
  membership_id text not null unique,
  assigned_at integer not null,
  source text not null,
  legacy_subject_type text not null,
  legacy_subject_id text not null,
  legacy_role_id text not null,
  legacy_scope_type text not null,
  legacy_scope_id_present integer not null,
  legacy_scope_id text not null,
  organization_subject_type text not null,
  organization_subject_id text not null,
  organization_role_id text not null,
  organization_scope_type text not null,
  organization_scope_id_present integer not null,
  organization_scope_id text not null,
  source_bootstrap_operation_id text,
  source_audit_event_id text,
  schema_version integer not null,
  constraint app_organization_owner_assignment_receipt_organization_fk
    foreign key (organization_id) references app_organization (id)
      on update restrict on delete restrict,
  constraint app_organization_owner_assignment_receipt_mailbox_fk
    foreign key (mailbox_id) references app_mailbox (id)
      on update restrict on delete restrict,
  constraint app_organization_owner_assignment_receipt_user_fk
    foreign key (user_id) references auth_user (id)
      on update restrict on delete restrict,
  constraint app_organization_owner_assignment_receipt_membership_fk
    foreign key (membership_id) references app_organization_member (id)
      on update restrict on delete restrict,
  constraint app_organization_owner_assignment_receipt_legacy_grant_fk
    foreign key (
      legacy_subject_type, legacy_subject_id, legacy_role_id,
      legacy_scope_type, legacy_scope_id_present, legacy_scope_id
    ) references auth_role_grant (
      subject_type, subject_id, role_id, scope_type, scope_id_present, scope_id
    ) on update restrict on delete restrict,
  constraint app_organization_owner_assignment_receipt_organization_grant_fk
    foreign key (
      organization_subject_type, organization_subject_id,
      organization_role_id, organization_scope_type,
      organization_scope_id_present, organization_scope_id
    ) references auth_role_grant (
      subject_type, subject_id, role_id, scope_type, scope_id_present, scope_id
    ) on update restrict on delete restrict,
  constraint app_organization_owner_assignment_receipt_operation_fk
    foreign key (source_bootstrap_operation_id)
      references app_mailbox_administration_receipt (operation_id)
      on update restrict on delete restrict,
  constraint app_organization_owner_assignment_receipt_audit_fk
    foreign key (source_audit_event_id)
      references app_administrative_audit_event (event_id)
      on update restrict on delete restrict,
  constraint app_organization_owner_assignment_receipt_identity_check check (
    organization_id = 'legacy_default_v1'
    and mailbox_id = 'primary'
    and membership_id = 'legacy_default_v1_owner_v1'
    and user_id = legacy_subject_id
    and user_id = organization_subject_id
  ),
  constraint app_organization_owner_assignment_receipt_time_check check (
    typeof(assigned_at) = 'integer'
    and assigned_at between 0 and 9007199254740991
  ),
  constraint app_organization_owner_assignment_receipt_source_check check (
    (source = 'fresh-bootstrap'
      and source_bootstrap_operation_id is not null
      and source_audit_event_id is not null)
    or (source = 'legacy-cutover' and (
      (source_bootstrap_operation_id is null
        and source_audit_event_id is null)
      or (source_bootstrap_operation_id is null
        and source_audit_event_id is not null)
      or (source_bootstrap_operation_id is not null
        and source_audit_event_id is not null)
    ))
  ),
  constraint app_organization_owner_assignment_receipt_legacy_check check (
    legacy_subject_type = 'user'
    and legacy_role_id = 'owner'
    and legacy_scope_type = 'mailbox'
    and legacy_scope_id_present = 1
    and legacy_scope_id = 'primary'
  ),
  constraint app_organization_owner_assignment_receipt_organization_grant_check
    check (
      organization_subject_type = 'user'
      and organization_role_id = 'organization.owner'
      and organization_scope_type = 'organization'
      and organization_scope_id_present = 1
      and organization_scope_id = 'legacy_default_v1'
    ),
  constraint app_organization_owner_assignment_receipt_schema_check
    check (typeof(schema_version) = 'integer' and schema_version = 1)
);

create temp table app_organization_owner_assignment_preflight (
  valid integer not null check (valid = 1)
);

-- Exact owned table generation, including composite provenance FKs.
insert into app_organization_owner_assignment_preflight (valid)
select case when
  (select sql from sqlite_master where type = 'table'
    and name = 'app_organization_owner_assignment_cutover')
    = 'CREATE TABLE app_organization_owner_assignment_cutover (
  id integer primary key,
  schema_version integer not null,
  constraint app_organization_owner_assignment_cutover_id_check
    check (id = 1),
  constraint app_organization_owner_assignment_cutover_schema_check
    check (typeof(schema_version) = ''integer'' and schema_version = 1)
)'
  and (select sql from sqlite_master where type = 'table'
    and name = 'app_organization_owner_assignment_receipt')
    = 'CREATE TABLE app_organization_owner_assignment_receipt (
  organization_id text not null primary key,
  mailbox_id text not null,
  user_id text not null,
  membership_id text not null unique,
  assigned_at integer not null,
  source text not null,
  legacy_subject_type text not null,
  legacy_subject_id text not null,
  legacy_role_id text not null,
  legacy_scope_type text not null,
  legacy_scope_id_present integer not null,
  legacy_scope_id text not null,
  organization_subject_type text not null,
  organization_subject_id text not null,
  organization_role_id text not null,
  organization_scope_type text not null,
  organization_scope_id_present integer not null,
  organization_scope_id text not null,
  source_bootstrap_operation_id text,
  source_audit_event_id text,
  schema_version integer not null,
  constraint app_organization_owner_assignment_receipt_organization_fk
    foreign key (organization_id) references app_organization (id)
      on update restrict on delete restrict,
  constraint app_organization_owner_assignment_receipt_mailbox_fk
    foreign key (mailbox_id) references app_mailbox (id)
      on update restrict on delete restrict,
  constraint app_organization_owner_assignment_receipt_user_fk
    foreign key (user_id) references auth_user (id)
      on update restrict on delete restrict,
  constraint app_organization_owner_assignment_receipt_membership_fk
    foreign key (membership_id) references app_organization_member (id)
      on update restrict on delete restrict,
  constraint app_organization_owner_assignment_receipt_legacy_grant_fk
    foreign key (
      legacy_subject_type, legacy_subject_id, legacy_role_id,
      legacy_scope_type, legacy_scope_id_present, legacy_scope_id
    ) references auth_role_grant (
      subject_type, subject_id, role_id, scope_type, scope_id_present, scope_id
    ) on update restrict on delete restrict,
  constraint app_organization_owner_assignment_receipt_organization_grant_fk
    foreign key (
      organization_subject_type, organization_subject_id,
      organization_role_id, organization_scope_type,
      organization_scope_id_present, organization_scope_id
    ) references auth_role_grant (
      subject_type, subject_id, role_id, scope_type, scope_id_present, scope_id
    ) on update restrict on delete restrict,
  constraint app_organization_owner_assignment_receipt_operation_fk
    foreign key (source_bootstrap_operation_id)
      references app_mailbox_administration_receipt (operation_id)
      on update restrict on delete restrict,
  constraint app_organization_owner_assignment_receipt_audit_fk
    foreign key (source_audit_event_id)
      references app_administrative_audit_event (event_id)
      on update restrict on delete restrict,
  constraint app_organization_owner_assignment_receipt_identity_check check (
    organization_id = ''legacy_default_v1''
    and mailbox_id = ''primary''
    and membership_id = ''legacy_default_v1_owner_v1''
    and user_id = legacy_subject_id
    and user_id = organization_subject_id
  ),
  constraint app_organization_owner_assignment_receipt_time_check check (
    typeof(assigned_at) = ''integer''
    and assigned_at between 0 and 9007199254740991
  ),
  constraint app_organization_owner_assignment_receipt_source_check check (
    (source = ''fresh-bootstrap''
      and source_bootstrap_operation_id is not null
      and source_audit_event_id is not null)
    or (source = ''legacy-cutover'' and (
      (source_bootstrap_operation_id is null
        and source_audit_event_id is null)
      or (source_bootstrap_operation_id is null
        and source_audit_event_id is not null)
      or (source_bootstrap_operation_id is not null
        and source_audit_event_id is not null)
    ))
  ),
  constraint app_organization_owner_assignment_receipt_legacy_check check (
    legacy_subject_type = ''user''
    and legacy_role_id = ''owner''
    and legacy_scope_type = ''mailbox''
    and legacy_scope_id_present = 1
    and legacy_scope_id = ''primary''
  ),
  constraint app_organization_owner_assignment_receipt_organization_grant_check
    check (
      organization_subject_type = ''user''
      and organization_role_id = ''organization.owner''
      and organization_scope_type = ''organization''
      and organization_scope_id_present = 1
      and organization_scope_id = ''legacy_default_v1''
    ),
  constraint app_organization_owner_assignment_receipt_schema_check
    check (typeof(schema_version) = ''integer'' and schema_version = 1)
)'
  and
  (select count(*) from pragma_table_xinfo(
    'app_organization_owner_assignment_cutover')) = 2
  and (select count(*) from pragma_table_xinfo(
    'app_organization_owner_assignment_receipt')) = 21
  and (select count(*) from pragma_foreign_key_list(
    'app_organization_owner_assignment_receipt')) = 18
  and not exists (select 1 from pragma_foreign_key_list(
    'app_organization_owner_assignment_receipt')
    where on_update <> 'RESTRICT' or on_delete <> 'RESTRICT' or match <> 'NONE')
  and (select group_concat("from", ',') from (
    select "from" from pragma_foreign_key_list(
      'app_organization_owner_assignment_receipt')
    where id = (select id from pragma_foreign_key_list(
      'app_organization_owner_assignment_receipt')
      where "from" = 'legacy_subject_type') order by seq))
    = 'legacy_subject_type,legacy_subject_id,legacy_role_id,legacy_scope_type,legacy_scope_id_present,legacy_scope_id'
  and (select group_concat("to", ',') from (
    select "to" from pragma_foreign_key_list(
      'app_organization_owner_assignment_receipt')
    where id = (select id from pragma_foreign_key_list(
      'app_organization_owner_assignment_receipt')
      where "from" = 'legacy_subject_type') order by seq))
    = 'subject_type,subject_id,role_id,scope_type,scope_id_present,scope_id'
  and (select group_concat("from", ',') from (
    select "from" from pragma_foreign_key_list(
      'app_organization_owner_assignment_receipt')
    where id = (select id from pragma_foreign_key_list(
      'app_organization_owner_assignment_receipt')
      where "from" = 'organization_subject_type') order by seq))
    = 'organization_subject_type,organization_subject_id,organization_role_id,organization_scope_type,organization_scope_id_present,organization_scope_id'
  and (select group_concat("to", ',') from (
    select "to" from pragma_foreign_key_list(
      'app_organization_owner_assignment_receipt')
    where id = (select id from pragma_foreign_key_list(
      'app_organization_owner_assignment_receipt')
      where "from" = 'organization_subject_type') order by seq))
    = 'subject_type,subject_id,role_id,scope_type,scope_id_present,scope_id'
  and exists (select 1 from pragma_foreign_key_list(
    'app_organization_owner_assignment_receipt')
    where "table" = 'app_organization_member' and "from" = 'membership_id'
      and "to" = 'id' and on_update = 'RESTRICT' and on_delete = 'RESTRICT')
  and exists (select 1 from pragma_foreign_key_list(
    'app_organization_owner_assignment_receipt')
    where "table" = 'app_administrative_audit_event'
      and "from" = 'source_audit_event_id' and "to" = 'event_id'
      and on_update = 'RESTRICT' and on_delete = 'RESTRICT')
  and (select count(*) from pragma_index_list(
    'app_organization_owner_assignment_receipt')) = 2
  and exists (select 1 from pragma_index_list(
    'app_organization_owner_assignment_receipt')
    where name = 'sqlite_autoindex_app_organization_owner_assignment_receipt_1'
      and "unique" = 1 and origin = 'pk' and partial = 0)
  and exists (select 1 from pragma_index_list(
    'app_organization_owner_assignment_receipt')
    where name = 'sqlite_autoindex_app_organization_owner_assignment_receipt_2'
      and "unique" = 1 and origin = 'u' and partial = 0)
  and not exists (select 1 from sqlite_master where type = 'trigger'
    and tbl_name in (
      'app_organization_owner_assignment_receipt',
      'app_organization_owner_assignment_cutover'))
then 1 else 0 end;

create temp table app_organization_owner_assignment_expected_parent_trigger (
  name text not null primary key,
  table_name text not null,
  expected_sql text not null
);

insert into app_organization_owner_assignment_expected_parent_trigger
  (name, table_name, expected_sql)
values
  ('app_organization_legacy_cutover_no_insert',
   'app_organization_legacy_cutover',
   'CREATE TRIGGER app_organization_legacy_cutover_no_insert
before insert on app_organization_legacy_cutover
begin
  select raise(abort, ''organization legacy cutover is sealed'');
end'),
  ('app_organization_legacy_cutover_no_update',
   'app_organization_legacy_cutover',
   'CREATE TRIGGER app_organization_legacy_cutover_no_update
before update on app_organization_legacy_cutover
begin
  select raise(abort, ''organization legacy cutover is immutable'');
end'),
  ('app_organization_legacy_cutover_no_delete',
   'app_organization_legacy_cutover',
   'CREATE TRIGGER app_organization_legacy_cutover_no_delete
before delete on app_organization_legacy_cutover
begin
  select raise(abort, ''organization legacy cutover is retained'');
end'),
  ('app_organization_fresh_mailbox_insert_guard', 'app_mailbox',
   'CREATE TRIGGER app_organization_fresh_mailbox_insert_guard
before insert on app_mailbox
when exists (
  select 1
  from app_organization_legacy_cutover
  where id = 1
    and schema_version = 1
    and outcome = ''fresh-empty''
    and source_mailbox_id is null
    and source_created_at is null
    and organization_id is null
)
and (
  new.id is not ''primary''
  or new.status is not ''active''
  or new.version is not 1
  or new.created_at is not new.updated_at
  or new.deleted_at is not null
  or typeof(new.created_at) <> ''integer''
  or new.created_at not between 0 and 9007199254740991
  or not exists (
    select 1
    from app_organization
    where id = ''legacy_default_v1''
      and status = ''active''
      and version = 1
      and created_at = new.created_at
      and updated_at = new.created_at
  )
)
begin
  select raise(abort, ''fresh mailbox requires its reserved legacy organization'');
end'),
  ('app_organization_mailbox_creation_provenance', 'app_mailbox',
   'CREATE TRIGGER app_organization_mailbox_creation_provenance
before update of id, created_at on app_mailbox
when old.id = ''primary''
and (old.id is not new.id or old.created_at is not new.created_at)
and (
  exists (
    select 1
    from app_organization_legacy_cutover
    where id = 1
      and schema_version = 1
      and outcome = ''legacy-primary''
      and source_mailbox_id = ''primary''
      and typeof(source_created_at) = ''integer''
      and organization_id = ''legacy_default_v1''
  )
  or exists (
    select 1
    from app_organization_legacy_cutover as cutover
    join app_organization as organization
      on organization.id = ''legacy_default_v1''
     and organization.created_at = old.created_at
    where cutover.id = 1
      and cutover.schema_version = 1
      and cutover.outcome = ''fresh-empty''
      and cutover.source_mailbox_id is null
      and cutover.source_created_at is null
      and cutover.organization_id is null
  )
)
begin
  select raise(abort, ''organization mailbox creation provenance is immutable'');
end'),
  ('app_organization_primary_mailbox_no_replace', 'app_mailbox',
   'CREATE TRIGGER app_organization_primary_mailbox_no_replace
before insert on app_mailbox
when new.id = ''primary''
and exists (
  select 1 from app_mailbox where id = ''primary''
)
and (
  exists (
    select 1
    from app_organization_legacy_cutover
    where id = 1
      and schema_version = 1
      and outcome = ''legacy-primary''
      and source_mailbox_id = ''primary''
      and typeof(source_created_at) = ''integer''
      and organization_id = ''legacy_default_v1''
  )
  or exists (
    select 1
    from app_organization_legacy_cutover as cutover
    join app_mailbox as mailbox
      on mailbox.id = ''primary''
    join app_organization as organization
      on organization.id = ''legacy_default_v1''
     and organization.created_at = mailbox.created_at
    where cutover.id = 1
      and cutover.schema_version = 1
      and cutover.outcome = ''fresh-empty''
      and cutover.source_mailbox_id is null
      and cutover.source_created_at is null
      and cutover.organization_id is null
  )
)
begin
  select raise(abort, ''organization primary mailbox replacement is forbidden'');
end'),
  ('app_organization_primary_mailbox_no_delete', 'app_mailbox',
   'CREATE TRIGGER app_organization_primary_mailbox_no_delete
before delete on app_mailbox
when old.id = ''primary''
and (
  exists (
    select 1
    from app_organization_legacy_cutover
    where id = 1
      and schema_version = 1
      and outcome = ''legacy-primary''
      and source_mailbox_id = ''primary''
      and typeof(source_created_at) = ''integer''
      and organization_id = ''legacy_default_v1''
  )
  or exists (
    select 1
    from app_organization_legacy_cutover as cutover
    join app_organization as organization
      on organization.id = ''legacy_default_v1''
     and organization.created_at = old.created_at
    where cutover.id = 1
      and cutover.schema_version = 1
      and cutover.outcome = ''fresh-empty''
      and cutover.source_mailbox_id is null
      and cutover.source_created_at is null
      and cutover.organization_id is null
  )
)
begin
  select raise(abort, ''organization primary mailbox is retained'');
end'),
  ('app_mailbox_legacy_organization_assignment_no_replace',
   'app_mailbox_legacy_organization_assignment',
   'CREATE TRIGGER app_mailbox_legacy_organization_assignment_no_replace
before insert on app_mailbox_legacy_organization_assignment
when exists (
  select 1 from app_mailbox_legacy_organization_assignment
  where mailbox_id = new.mailbox_id
)
begin
  select raise(abort, ''legacy organization ancestry is immutable'');
end'),
  ('app_mailbox_legacy_organization_assignment_binding',
   'app_mailbox_legacy_organization_assignment',
   'CREATE TRIGGER app_mailbox_legacy_organization_assignment_binding
before insert on app_mailbox_legacy_organization_assignment
when new.mailbox_id is not ''primary''
  or new.organization_id is not ''legacy_default_v1''
  or new.source is not ''fresh-bootstrap''
  or new.schema_version is not 1
  or typeof(new.effective_at) <> ''integer''
  or new.effective_at not between 0 and 9007199254740991
  or not exists (
    select 1
    from app_mailbox_legacy_organization_assignment_cutover
    where id = 1 and schema_version = 1
  )
  or not exists (
    select 1 from app_organization_legacy_cutover
    where id = 1 and schema_version = 1 and outcome = ''fresh-empty''
      and source_mailbox_id is null and source_created_at is null
      and organization_id is null
  )
  or (select count(*) from app_mailbox) <> 1
  or (select count(*) from app_organization) <> 1
  or exists (select 1 from app_mailbox_legacy_organization_assignment)
  or not exists (
    select 1
    from app_mailbox as mailbox
    join app_organization as organization
      on organization.id = new.organization_id
     and organization.created_at = new.effective_at
    where mailbox.id = new.mailbox_id
      and typeof(mailbox.id) = ''text''
      and typeof(mailbox.display_name) = ''text''
      and length(mailbox.display_name) between 1 and 200
      and typeof(mailbox.created_by_user_id) = ''text''
      and length(mailbox.created_by_user_id) between 1 and 128
      and typeof(mailbox.created_at) = ''integer''
      and mailbox.created_at between 0 and 9007199254740991
      and mailbox.created_at = new.effective_at
      and mailbox.status = ''active''
      and mailbox.version = 1
      and mailbox.updated_at = mailbox.created_at
      and mailbox.deleted_at is null
      and typeof(organization.id) = ''text''
      and typeof(organization.created_at) = ''integer''
      and organization.created_at between 0 and 9007199254740991
      and organization.status = ''active''
      and organization.version = 1
      and organization.updated_at = organization.created_at
  )
begin
  select raise(abort, ''invalid fresh mailbox legacy organization ancestry'');
end'),
  ('app_mailbox_legacy_organization_assignment_no_update',
   'app_mailbox_legacy_organization_assignment',
   'CREATE TRIGGER app_mailbox_legacy_organization_assignment_no_update
before update on app_mailbox_legacy_organization_assignment
begin
  select raise(abort, ''legacy organization ancestry is immutable'');
end'),
  ('app_mailbox_legacy_organization_assignment_no_delete',
   'app_mailbox_legacy_organization_assignment',
   'CREATE TRIGGER app_mailbox_legacy_organization_assignment_no_delete
before delete on app_mailbox_legacy_organization_assignment
begin
  select raise(abort, ''legacy organization ancestry is retained'');
end'),
  ('app_mailbox_legacy_organization_assignment_cutover_no_insert',
   'app_mailbox_legacy_organization_assignment_cutover',
   'CREATE TRIGGER app_mailbox_legacy_organization_assignment_cutover_no_insert
before insert on app_mailbox_legacy_organization_assignment_cutover
begin
  select raise(abort, ''legacy organization ancestry cutover is sealed'');
end'),
  ('app_mailbox_legacy_organization_assignment_cutover_no_update',
   'app_mailbox_legacy_organization_assignment_cutover',
   'CREATE TRIGGER app_mailbox_legacy_organization_assignment_cutover_no_update
before update on app_mailbox_legacy_organization_assignment_cutover
begin
  select raise(abort, ''legacy organization ancestry cutover is immutable'');
end'),
  ('app_mailbox_legacy_organization_assignment_cutover_no_delete',
   'app_mailbox_legacy_organization_assignment_cutover',
   'CREATE TRIGGER app_mailbox_legacy_organization_assignment_cutover_no_delete
before delete on app_mailbox_legacy_organization_assignment_cutover
begin
  select raise(abort, ''legacy organization ancestry cutover is retained'');
end'),
  ('app_mailbox_legacy_organization_assignment_from_fresh_mailbox',
   'app_mailbox',
   'CREATE TRIGGER app_mailbox_legacy_organization_assignment_from_fresh_mailbox
after insert on app_mailbox
when exists (
  select 1 from app_organization_legacy_cutover
  where id = 1 and schema_version = 1 and outcome = ''fresh-empty''
    and source_mailbox_id is null and source_created_at is null
    and organization_id is null
)
begin
  insert into app_mailbox_legacy_organization_assignment (
    mailbox_id, organization_id, effective_at, source, schema_version
  ) values (
    new.id, ''legacy_default_v1'', new.created_at, ''fresh-bootstrap'', 1
  );
  select case when (
    select count(*)
    from app_mailbox_legacy_organization_assignment as assignment
    join app_mailbox as mailbox on mailbox.id = assignment.mailbox_id
    join app_organization as organization
      on organization.id = assignment.organization_id
    where assignment.mailbox_id = ''primary''
      and assignment.organization_id = ''legacy_default_v1''
      and assignment.effective_at = new.created_at
      and assignment.effective_at = mailbox.created_at
      and assignment.effective_at = organization.created_at
      and assignment.source = ''fresh-bootstrap''
      and assignment.schema_version = 1
  ) <> 1 then raise(abort, ''fresh mailbox ancestry materialization failed'') end;
end');

-- Parent generation and catalog fences. The legacy role baseline is exact.
insert into app_organization_owner_assignment_preflight (valid)
select case when
  (select sql from sqlite_master where type = 'table'
    and name = 'app_mailbox_legacy_organization_assignment')
    = 'CREATE TABLE app_mailbox_legacy_organization_assignment (
  mailbox_id text not null primary key,
  organization_id text not null,
  effective_at integer not null,
  source text not null,
  schema_version integer not null,
  constraint app_mailbox_legacy_organization_assignment_mailbox_fk
    foreign key (mailbox_id) references app_mailbox (id)
      on update restrict on delete restrict,
  constraint app_mailbox_legacy_organization_assignment_organization_fk
    foreign key (organization_id) references app_organization (id)
      on update restrict on delete restrict,
  constraint app_mailbox_legacy_organization_assignment_mailbox_check
    check (typeof(mailbox_id) = ''text'' and mailbox_id = ''primary''),
  constraint app_mailbox_legacy_organization_assignment_organization_check
    check (
      typeof(organization_id) = ''text''
      and organization_id = ''legacy_default_v1''
    ),
  constraint app_mailbox_legacy_organization_assignment_effective_check
    check (
      typeof(effective_at) = ''integer''
      and effective_at between 0 and 9007199254740991
    ),
  constraint app_mailbox_legacy_organization_assignment_source_check
    check (
      typeof(source) = ''text''
      and source in (''legacy-cutover'', ''fresh-bootstrap'')
    ),
  constraint app_mailbox_legacy_organization_assignment_schema_check
    check (typeof(schema_version) = ''integer'' and schema_version = 1)
)'
  and (select sql from sqlite_master where type = 'table'
    and name = 'app_mailbox_legacy_organization_assignment_cutover')
    = 'CREATE TABLE app_mailbox_legacy_organization_assignment_cutover (
  id integer primary key,
  schema_version integer not null,
  constraint app_mailbox_legacy_organization_assignment_cutover_id_check
    check (id = 1),
  constraint app_mailbox_legacy_organization_assignment_cutover_schema_check
    check (typeof(schema_version) = ''integer'' and schema_version = 1)
)'
  and (select sql from sqlite_master where type = 'table'
    and name = 'app_organization_legacy_cutover')
    = 'CREATE TABLE app_organization_legacy_cutover (
  id integer primary key,
  schema_version integer not null,
  outcome text not null,
  source_mailbox_id text,
  source_created_at integer,
  organization_id text,
  constraint app_organization_legacy_cutover_id_check
    check (id = 1),
  constraint app_organization_legacy_cutover_schema_check
    check (typeof(schema_version) = ''integer'' and schema_version = 1),
  constraint app_organization_legacy_cutover_outcome_check
    check (
      (
        outcome = ''legacy-primary''
        and typeof(outcome) = ''text''
        and source_mailbox_id = ''primary''
        and typeof(source_mailbox_id) = ''text''
        and typeof(source_created_at) = ''integer''
        and source_created_at between 0 and 9007199254740991
        and organization_id = ''legacy_default_v1''
        and typeof(organization_id) = ''text''
      )
      or (
        outcome = ''fresh-empty''
        and typeof(outcome) = ''text''
        and source_mailbox_id is null
        and source_created_at is null
        and organization_id is null
      )
    ),
  constraint app_organization_legacy_cutover_mailbox_fk
    foreign key (source_mailbox_id) references app_mailbox (id)
      on update restrict on delete restrict,
  constraint app_organization_legacy_cutover_organization_fk
    foreign key (organization_id) references app_organization (id)
      on update restrict on delete restrict
)'
  and (select sql from sqlite_master where type = 'index'
    and name = 'app_mailbox_singleton_idx')
    = 'CREATE UNIQUE INDEX app_mailbox_singleton_idx
  on app_mailbox ((1))'
  and (select sql from sqlite_master where type = 'trigger'
    and name = 'app_mailbox_legacy_organization_assignment_no_update'
    and tbl_name = 'app_mailbox_legacy_organization_assignment')
    = 'CREATE TRIGGER app_mailbox_legacy_organization_assignment_no_update
before update on app_mailbox_legacy_organization_assignment
begin
  select raise(abort, ''legacy organization ancestry is immutable'');
end'
  and (select sql from sqlite_master where type = 'trigger'
    and name = 'app_mailbox_legacy_organization_assignment_no_delete'
    and tbl_name = 'app_mailbox_legacy_organization_assignment')
    = 'CREATE TRIGGER app_mailbox_legacy_organization_assignment_no_delete
before delete on app_mailbox_legacy_organization_assignment
begin
  select raise(abort, ''legacy organization ancestry is retained'');
end'
  and (select sql from sqlite_master where type = 'trigger'
    and name = 'app_mailbox_legacy_organization_assignment_from_fresh_mailbox'
    and tbl_name = 'app_mailbox')
    = 'CREATE TRIGGER app_mailbox_legacy_organization_assignment_from_fresh_mailbox
after insert on app_mailbox
when exists (
  select 1 from app_organization_legacy_cutover
  where id = 1 and schema_version = 1 and outcome = ''fresh-empty''
    and source_mailbox_id is null and source_created_at is null
    and organization_id is null
)
begin
  insert into app_mailbox_legacy_organization_assignment (
    mailbox_id, organization_id, effective_at, source, schema_version
  ) values (
    new.id, ''legacy_default_v1'', new.created_at, ''fresh-bootstrap'', 1
  );
  select case when (
    select count(*)
    from app_mailbox_legacy_organization_assignment as assignment
    join app_mailbox as mailbox on mailbox.id = assignment.mailbox_id
    join app_organization as organization
      on organization.id = assignment.organization_id
    where assignment.mailbox_id = ''primary''
      and assignment.organization_id = ''legacy_default_v1''
      and assignment.effective_at = new.created_at
      and assignment.effective_at = mailbox.created_at
      and assignment.effective_at = organization.created_at
      and assignment.source = ''fresh-bootstrap''
      and assignment.schema_version = 1
  ) <> 1 then raise(abort, ''fresh mailbox ancestry materialization failed'') end;
end'
  and not exists (
    select 1
    from app_organization_owner_assignment_expected_parent_trigger expected
    left join sqlite_master actual on actual.name = expected.name
    where actual.type is not 'trigger'
      or actual.tbl_name is not expected.table_name
      or actual.sql is not expected.expected_sql)
  and (select count(*) from sqlite_master where type = 'trigger'
    and tbl_name = 'app_organization_legacy_cutover') = 3
  and (select count(*) from sqlite_master where type = 'trigger'
    and tbl_name = 'app_mailbox_legacy_organization_assignment') = 4
  and (select count(*) from sqlite_master where type = 'trigger'
    and tbl_name = 'app_mailbox_legacy_organization_assignment_cutover') = 3
  and exists (select 1 from app_mailbox_legacy_organization_assignment_cutover
    where id = 1 and schema_version = 1)
  and (select count(*) from app_mailbox_legacy_organization_assignment_cutover) = 1
  and (select sql from sqlite_master where type = 'trigger'
    and name = 'app_canonical_permission_definition_no_insert_replace'
    and tbl_name = 'auth_permission_definition')
    = 'CREATE TRIGGER app_canonical_permission_definition_no_insert_replace
before insert on auth_permission_definition
when new.id in (
  ''organization.read'', ''organization.manage_settings'', ''organization.manage_members'',
  ''organization.manage_domains'', ''organization.manage_addresses'',
  ''organization.manage_mailboxes'', ''organization.read_audit'',
  ''organization.transfer_ownership'', ''mailbox.read'', ''mailbox.modify'',
  ''mailbox.send'', ''mailbox.send_from_shared_identity'', ''mailbox.manage_settings'',
  ''mailbox.manage_members'', ''mailbox.export'', ''message.read'', ''message.modify'',
  ''draft.create'', ''draft.send'', ''rule.manage'', ''attachment.read'',
  ''attachment.upload'', ''folder.read'', ''folder.modify'', ''send_identity.use''
)
and exists (select 1 from auth_permission_definition where id = new.id)
begin
  select raise(abort, ''canonical permission definitions are immutable'');
end'
  and (select sql from sqlite_master where type = 'trigger'
    and name = 'app_canonical_role_definition_no_insert_replace'
    and tbl_name = 'auth_role_definition')
    = 'CREATE TRIGGER app_canonical_role_definition_no_insert_replace
before insert on auth_role_definition
when new.id in (
  ''organization.owner'', ''organization.admin'', ''organization.member'',
  ''mailbox.owner'', ''mailbox.manager'', ''mailbox.editor'', ''mailbox.viewer''
)
and exists (select 1 from auth_role_definition where id = new.id)
begin
  select raise(abort, ''canonical role definitions are immutable'');
end'
  and (select sql from sqlite_master where type = 'trigger'
    and name = 'app_canonical_permission_definition_no_update'
    and tbl_name = 'auth_permission_definition')
    = 'CREATE TRIGGER app_canonical_permission_definition_no_update
before update on auth_permission_definition
when old.id in (
  ''organization.read'', ''organization.manage_settings'', ''organization.manage_members'',
  ''organization.manage_domains'', ''organization.manage_addresses'',
  ''organization.manage_mailboxes'', ''organization.read_audit'',
  ''organization.transfer_ownership'', ''mailbox.read'', ''mailbox.modify'',
  ''mailbox.send'', ''mailbox.send_from_shared_identity'', ''mailbox.manage_settings'',
  ''mailbox.manage_members'', ''mailbox.export'', ''message.read'', ''message.modify'',
  ''draft.create'', ''draft.send'', ''rule.manage'', ''attachment.read'',
  ''attachment.upload'', ''folder.read'', ''folder.modify'', ''send_identity.use''
)
or new.id in (
  ''organization.read'', ''organization.manage_settings'', ''organization.manage_members'',
  ''organization.manage_domains'', ''organization.manage_addresses'',
  ''organization.manage_mailboxes'', ''organization.read_audit'',
  ''organization.transfer_ownership'', ''mailbox.read'', ''mailbox.modify'',
  ''mailbox.send'', ''mailbox.send_from_shared_identity'', ''mailbox.manage_settings'',
  ''mailbox.manage_members'', ''mailbox.export'', ''message.read'', ''message.modify'',
  ''draft.create'', ''draft.send'', ''rule.manage'', ''attachment.read'',
  ''attachment.upload'', ''folder.read'', ''folder.modify'', ''send_identity.use''
)
begin
  select raise(abort, ''canonical permission definitions are immutable'');
end'
  and (select sql from sqlite_master where type = 'trigger'
    and name = 'app_canonical_permission_definition_no_delete'
    and tbl_name = 'auth_permission_definition')
    = 'CREATE TRIGGER app_canonical_permission_definition_no_delete
before delete on auth_permission_definition
when old.id in (
  ''organization.read'', ''organization.manage_settings'', ''organization.manage_members'',
  ''organization.manage_domains'', ''organization.manage_addresses'',
  ''organization.manage_mailboxes'', ''organization.read_audit'',
  ''organization.transfer_ownership'', ''mailbox.read'', ''mailbox.modify'',
  ''mailbox.send'', ''mailbox.send_from_shared_identity'', ''mailbox.manage_settings'',
  ''mailbox.manage_members'', ''mailbox.export'', ''message.read'', ''message.modify'',
  ''draft.create'', ''draft.send'', ''rule.manage'', ''attachment.read'',
  ''attachment.upload'', ''folder.read'', ''folder.modify'', ''send_identity.use''
)
begin
  select raise(abort, ''canonical permission definitions are immutable'');
end'
  and (select sql from sqlite_master where type = 'trigger'
    and name = 'app_canonical_role_definition_no_update'
    and tbl_name = 'auth_role_definition')
    = 'CREATE TRIGGER app_canonical_role_definition_no_update
before update on auth_role_definition
when old.id in (
  ''organization.owner'', ''organization.admin'', ''organization.member'',
  ''mailbox.owner'', ''mailbox.manager'', ''mailbox.editor'', ''mailbox.viewer''
)
or new.id in (
  ''organization.owner'', ''organization.admin'', ''organization.member'',
  ''mailbox.owner'', ''mailbox.manager'', ''mailbox.editor'', ''mailbox.viewer''
)
begin
  select raise(abort, ''canonical role definitions are immutable'');
end'
  and (select sql from sqlite_master where type = 'trigger'
    and name = 'app_canonical_role_definition_no_delete'
    and tbl_name = 'auth_role_definition')
    = 'CREATE TRIGGER app_canonical_role_definition_no_delete
before delete on auth_role_definition
when old.id in (
  ''organization.owner'', ''organization.admin'', ''organization.member'',
  ''mailbox.owner'', ''mailbox.manager'', ''mailbox.editor'', ''mailbox.viewer''
)
begin
  select raise(abort, ''canonical role definitions are immutable'');
end'
  and (select sql from sqlite_master where type = 'trigger'
    and name = 'app_canonical_role_permission_no_update'
    and tbl_name = 'auth_role_permission')
    = 'CREATE TRIGGER app_canonical_role_permission_no_update
before update on auth_role_permission
when old.role_id in (
  ''organization.owner'', ''organization.admin'', ''organization.member'',
  ''mailbox.owner'', ''mailbox.manager'', ''mailbox.editor'', ''mailbox.viewer''
)
or new.role_id in (
  ''organization.owner'', ''organization.admin'', ''organization.member'',
  ''mailbox.owner'', ''mailbox.manager'', ''mailbox.editor'', ''mailbox.viewer''
)
begin
  select raise(abort, ''canonical role permission mappings are immutable'');
end'
  and (select sql from sqlite_master where type = 'trigger'
    and name = 'app_canonical_role_permission_insert_contract'
    and tbl_name = 'auth_role_permission')
    = 'CREATE TRIGGER app_canonical_role_permission_insert_contract
before insert on auth_role_permission
when new.role_id in (
  ''organization.owner'', ''organization.admin'', ''organization.member'',
  ''mailbox.owner'', ''mailbox.manager'', ''mailbox.editor'', ''mailbox.viewer''
)
and (
  new.scope_type_present is not 1
  or not (
    (new.role_id = ''organization.owner''
      and new.scope_type = ''organization''
      and new.permission_id in (
        ''organization.read'', ''organization.manage_settings'',
        ''organization.manage_members'', ''organization.manage_domains'',
        ''organization.manage_addresses'', ''organization.manage_mailboxes'',
        ''organization.read_audit'', ''organization.transfer_ownership''
      ))
    or (new.role_id = ''organization.admin''
      and new.scope_type = ''organization''
      and new.permission_id in (
        ''organization.read'', ''organization.manage_settings'',
        ''organization.manage_members'', ''organization.manage_domains'',
        ''organization.manage_addresses'', ''organization.manage_mailboxes'',
        ''organization.read_audit''
      ))
    or (new.role_id = ''organization.member''
      and new.scope_type = ''organization''
      and new.permission_id = ''organization.read'')
    or (new.role_id = ''mailbox.owner'' and (
      (new.scope_type = ''mailbox'' and new.permission_id in (
        ''mailbox.read'', ''mailbox.modify'', ''mailbox.send'',
        ''mailbox.send_from_shared_identity'', ''mailbox.manage_settings'',
        ''mailbox.manage_members'', ''mailbox.export'', ''message.read'',
        ''message.modify'', ''draft.create'', ''draft.send'', ''rule.manage'',
        ''attachment.read'', ''attachment.upload''
      ))
      or (new.scope_type = ''folder''
        and new.permission_id in (''folder.read'', ''folder.modify''))
    ))
    or (new.role_id = ''mailbox.manager'' and (
      (new.scope_type = ''mailbox'' and new.permission_id in (
        ''mailbox.read'', ''mailbox.modify'', ''mailbox.send'',
        ''mailbox.send_from_shared_identity'', ''message.read'', ''message.modify'',
        ''draft.create'', ''draft.send'', ''rule.manage'', ''attachment.read'',
        ''attachment.upload''
      ))
      or (new.scope_type = ''folder''
        and new.permission_id in (''folder.read'', ''folder.modify''))
    ))
    or (new.role_id = ''mailbox.editor'' and (
      (new.scope_type = ''mailbox'' and new.permission_id in (
        ''mailbox.read'', ''mailbox.modify'', ''message.read'', ''message.modify'',
        ''draft.create'', ''attachment.read'', ''attachment.upload''
      ))
      or (new.scope_type = ''folder''
        and new.permission_id in (''folder.read'', ''folder.modify''))
    ))
    or (new.role_id = ''mailbox.viewer'' and (
      (new.scope_type = ''mailbox''
        and new.permission_id in (''mailbox.read'', ''message.read'', ''attachment.read''))
      or (new.scope_type = ''folder'' and new.permission_id = ''folder.read'')
    ))
  )
  or exists (
    select 1
    from auth_role_permission mapping
    where mapping.role_id = new.role_id
      and mapping.permission_id = new.permission_id
      and mapping.scope_type_present = new.scope_type_present
      and mapping.scope_type = new.scope_type
  )
)
begin
  select raise(abort, ''canonical role permission mapping violates the catalog'');
end'
  and (select sql from sqlite_master where type = 'trigger'
    and name = 'app_canonical_role_permission_no_delete'
    and tbl_name = 'auth_role_permission')
    = 'CREATE TRIGGER app_canonical_role_permission_no_delete
before delete on auth_role_permission
when old.role_id in (
  ''organization.owner'', ''organization.admin'', ''organization.member'',
  ''mailbox.owner'', ''mailbox.manager'', ''mailbox.editor'', ''mailbox.viewer''
)
begin
  select raise(abort, ''canonical role permission mappings are immutable'');
end'
  and exists (select 1 from auth_role_definition
    where id = 'owner' and description = 'Full mailbox control'
      and created_at = 0 and updated_at = 0
      and disabled_at is null and deleted_at is null)
  and exists (select 1 from auth_role_definition
    where id = 'organization.owner'
      and description = 'Full organization control'
      and created_at = 0 and updated_at = 0
      and disabled_at is null and deleted_at is null)
  and not exists (
    select 1 from json_each('["mailbox.read","mailbox.modify","mailbox.send","mailbox.manage_settings","mailbox.manage_members","mailbox.export","message.read","message.modify","draft.create","draft.send","rule.manage","attachment.read","attachment.upload"]') as expected
    where not exists (select 1 from auth_role_permission mapping
      where mapping.role_id = 'owner'
        and mapping.permission_id = expected.value
        and mapping.scope_type_present = 1
        and mapping.scope_type = 'mailbox'))
  and not exists (
    select 1 from json_each('["folder.read","folder.modify"]') as expected
    where not exists (select 1 from auth_role_permission mapping
      where mapping.role_id = 'owner'
        and mapping.permission_id = expected.value
        and mapping.scope_type_present = 1
        and mapping.scope_type = 'folder'))
  and not exists (
    select 1 from auth_role_permission
    where role_id = 'owner' and not (
      scope_type_present = 1
      and ((scope_type = 'mailbox' and permission_id in (
        'mailbox.read', 'mailbox.modify', 'mailbox.send',
        'mailbox.manage_settings', 'mailbox.manage_members', 'mailbox.export',
        'message.read', 'message.modify', 'draft.create', 'draft.send',
        'rule.manage', 'attachment.read', 'attachment.upload'))
      or (scope_type = 'folder'
        and permission_id in ('folder.read', 'folder.modify')))))
  and not exists (
    select 1 from json_each('["organization.read","organization.manage_settings","organization.manage_members","organization.manage_domains","organization.manage_addresses","organization.manage_mailboxes","organization.read_audit","organization.transfer_ownership"]') as expected
    where not exists (select 1 from auth_role_permission mapping
      where mapping.role_id = 'organization.owner'
        and mapping.permission_id = expected.value
        and mapping.scope_type_present = 1
        and mapping.scope_type = 'organization'))
  and not exists (select 1 from auth_role_permission
    where role_id = 'organization.owner' and not (
      scope_type_present = 1 and scope_type = 'organization'
      and permission_id in (
        'organization.read', 'organization.manage_settings',
        'organization.manage_members', 'organization.manage_domains',
        'organization.manage_addresses', 'organization.manage_mailboxes',
        'organization.read_audit', 'organization.transfer_ownership')))
  and not exists (
    select 1 from json_each('["organization.read","organization.manage_settings","organization.manage_members","organization.manage_domains","organization.manage_addresses","organization.manage_mailboxes","organization.read_audit","organization.transfer_ownership"]') as expected
    where not exists (select 1 from auth_permission_definition definition
      where definition.id = expected.value
        and definition.scope_type_present = 1
        and definition.scope_type = 'organization'
        and definition.created_at = 0 and definition.updated_at = 0
        and definition.disabled_at is null and definition.deleted_at is null))
  and not exists (
    select 1 from json_each('["mailbox.read","mailbox.modify","mailbox.send","mailbox.manage_settings","mailbox.manage_members","mailbox.export","message.read","message.modify","draft.create","draft.send","rule.manage","attachment.read","attachment.upload"]') as expected
    where not exists (select 1 from auth_permission_definition definition
      where definition.id = expected.value
        and definition.scope_type_present = 1
        and definition.scope_type = 'mailbox'
        and definition.created_at = 0 and definition.updated_at = 0
        and definition.disabled_at is null and definition.deleted_at is null))
  and not exists (
    select 1 from json_each('["folder.read","folder.modify"]') as expected
    where not exists (select 1 from auth_permission_definition definition
      where definition.id = expected.value
        and definition.scope_type_present = 1
        and definition.scope_type = 'folder'
        and definition.created_at = 0 and definition.updated_at = 0
        and definition.disabled_at is null and definition.deleted_at is null))
  and not exists (select 1 from auth_role_grant
    where role_id = 'owner' and scope_type = 'global'
      and revoked_at is null
      and (expires_at is null
        or expires_at > cast(unixepoch('subsec') * 1000 as integer)))
  and not exists (select 1 from pragma_foreign_key_check)
then 1 else 0 end;

drop table app_organization_owner_assignment_expected_parent_trigger;

create temp view app_organization_owner_assignment_candidate as
select subject_id as user_id
from auth_role_grant
where subject_type = 'user'
  and role_id = 'owner'
  and scope_type = 'mailbox'
  and scope_id_present = 1
  and scope_id = 'primary'
  and expires_at is null
  and metadata is null
  and revoked_at is null;

create temp view app_organization_owner_assignment_history as
select
  (select count(*) from app_mailbox_administration_receipt
    where operation_kind = 'bootstrap-owner') as receipt_count,
  (select count(*) from app_administrative_audit_event
    where action = 'mailbox.owner-bootstrap') as audit_count;

-- First application either seals a genuinely empty deployment or validates one
-- grant-nominated owner chain. Configuration and identity values are absent.
insert into app_organization_owner_assignment_preflight (valid)
select case
  when (select receipt_was_present
          from app_organization_owner_assignment_application) = 0
    and not exists (select 1 from app_mailbox)
    and not exists (select 1 from app_organization)
    and not exists (select 1 from app_organization_owner_assignment_receipt)
    and not exists (select 1 from app_organization_member)
    and not exists (select 1 from app_mailbox_member)
    and not exists (select 1 from auth_role_grant
      where role_id = 'owner'
        and (scope_type = 'mailbox' or scope_type = 'global'))
    and not exists (select 1 from auth_role_grant
      where role_id = 'organization.owner')
    and not exists (select 1 from app_mailbox_administration_receipt
      where operation_kind = 'bootstrap-owner' or mailbox_id = 'primary')
    and not exists (select 1 from app_mailbox_bootstrap_receipt_v1_intent)
    and not exists (select 1 from app_mailbox_bootstrap_receipt_v2)
    and not exists (select 1 from app_administrative_audit_event
      where action = 'mailbox.owner-bootstrap'
        or (resource_type = 'mailbox' and resource_id = 'primary'))
    and not exists (select 1
      from app_mailbox_legacy_organization_assignment)
  then 1
  when (select receipt_was_present
          from app_organization_owner_assignment_application) = 0
    and (select count(*) from app_organization_owner_assignment_candidate) = 1
    and not exists (select 1 from app_organization_owner_assignment_receipt)
    and not exists (select 1 from app_organization_member)
    and not exists (select 1 from auth_role_grant
      where role_id = 'organization.owner')
    and exists (
      select 1
      from app_organization_owner_assignment_candidate as candidate
      join auth_user as user on user.id = candidate.user_id
      join app_mailbox_member as mailbox_member
        on mailbox_member.mailbox_id = 'primary'
       and mailbox_member.user_id = candidate.user_id
       and mailbox_member.revoked_at is null
      join app_mailbox as mailbox
        on mailbox.id = 'primary'
       and mailbox.created_by_user_id = candidate.user_id
      join app_organization as organization
        on organization.id = 'legacy_default_v1'
      join app_mailbox_legacy_organization_assignment as ancestry
        on ancestry.mailbox_id = mailbox.id
       and ancestry.organization_id = organization.id
       and ancestry.effective_at = mailbox.created_at
       and ancestry.effective_at = organization.created_at
       and ancestry.schema_version = 1
      where user.disabled_at is null
        and ((ancestry.source = 'legacy-cutover' and exists (
          select 1 from app_organization_legacy_cutover
          where id = 1 and schema_version = 1
            and outcome = 'legacy-primary'
            and source_mailbox_id = 'primary'
            and source_created_at = ancestry.effective_at
            and organization_id = 'legacy_default_v1'))
        or (ancestry.source = 'fresh-bootstrap' and exists (
          select 1 from app_organization_legacy_cutover
          where id = 1 and schema_version = 1
            and outcome = 'fresh-empty'
            and source_mailbox_id is null and source_created_at is null
            and organization_id is null)))
    )
    and (select receipt_count from app_organization_owner_assignment_history)
      in (0, 1)
    and (select audit_count from app_organization_owner_assignment_history)
      in (0, 1)
    and not ((select receipt_count
                from app_organization_owner_assignment_history) = 1
      and (select audit_count
             from app_organization_owner_assignment_history) <> 1)
    and not exists (
      select 1 from app_mailbox_administration_receipt as receipt
      where receipt.operation_kind = 'bootstrap-owner' and not (
        receipt.actor_user_id = (select user_id
          from app_organization_owner_assignment_candidate)
        and receipt.mailbox_id = 'primary'
        and receipt.expected_version is null
        and receipt.result_mailbox_id = 'primary'
        and receipt.result_created_by_user_id = receipt.actor_user_id
        and receipt.result_created_at = receipt.result_updated_at
        and receipt.result_created_at = receipt.committed_at
        and receipt.result_version = 1 and receipt.schema_version = 1
        and ((select count(*) from app_mailbox_bootstrap_receipt_v1_intent
               where operation_id = receipt.operation_id)
          + (select count(*) from app_mailbox_bootstrap_receipt_v2
               where operation_id = receipt.operation_id)) = 1
        and exists (select 1 from app_administrative_audit_event as audit
          where audit.operation_id = receipt.operation_id
            and audit.action = 'mailbox.owner-bootstrap'
            and audit.outcome = 'succeeded' and audit.actor_type = 'user'
            and audit.actor_id = receipt.actor_user_id
            and audit.tenant_scope_type = 'legacy-mailbox'
            and audit.tenant_scope_id = 'primary'
            and audit.resource_type = 'mailbox'
            and audit.resource_id = 'primary'
            and audit.reason_code = 'owner-bootstrap'
            and audit.change_type = 'mailbox-bootstrapped'
            and audit.resource_version_before is null
            and audit.resource_version_after = 1
            and audit.occurred_at = receipt.committed_at)
        and (select count(*) from app_administrative_audit_event
          where operation_id = receipt.operation_id) = 1))
    and not exists (
      select 1 from app_administrative_audit_event as audit
      where audit.action = 'mailbox.owner-bootstrap' and not (
        audit.outcome = 'succeeded' and audit.actor_type = 'user'
        and audit.actor_id = (select user_id
          from app_organization_owner_assignment_candidate)
        and audit.tenant_scope_type = 'legacy-mailbox'
        and audit.tenant_scope_id = 'primary'
        and audit.resource_type = 'mailbox' and audit.resource_id = 'primary'
        and audit.reason_code = 'owner-bootstrap'
        and audit.change_type = 'mailbox-bootstrapped'
        and audit.resource_version_before is null
        and audit.resource_version_after = 1
        and audit.occurred_at = (select created_at from app_mailbox
          where id = 'primary')
        and (select count(*) from app_administrative_audit_event
          where operation_id = audit.operation_id) = 1
        and (not exists (select 1 from app_mailbox_administration_receipt
              where operation_kind = 'bootstrap-owner')
          or exists (select 1 from app_mailbox_administration_receipt receipt
            where receipt.operation_id = audit.operation_id
              and receipt.operation_kind = 'bootstrap-owner'
              and receipt.committed_at = audit.occurred_at))))
  then 1
  when (select receipt_was_present
          from app_organization_owner_assignment_application) = 1
    and (select count(*) from app_organization_owner_assignment_cutover) = 1
    and exists (select 1 from app_organization_owner_assignment_cutover
      where id = 1 and schema_version = 1)
    and (
      (not exists (select 1 from app_mailbox)
        and not exists (select 1 from app_organization)
        and not exists (select 1
          from app_mailbox_legacy_organization_assignment)
        and exists (select 1 from app_organization_legacy_cutover
          where id = 1 and schema_version = 1 and outcome = 'fresh-empty'
            and source_mailbox_id is null and source_created_at is null
            and organization_id is null)
        and not exists (select 1 from app_mailbox_member)
        and not exists (select 1 from app_organization_member)
        and not exists (select 1 from auth_role_grant
          where role_id = 'owner'
            and (scope_type = 'mailbox' or scope_type = 'global'))
        and not exists (select 1 from auth_role_grant
          where role_id = 'organization.owner')
        and not exists (select 1 from app_mailbox_administration_receipt
          where operation_kind = 'bootstrap-owner')
        and not exists (select 1
          from app_mailbox_bootstrap_receipt_v1_intent)
        and not exists (select 1 from app_mailbox_bootstrap_receipt_v2)
        and not exists (select 1 from app_administrative_audit_event
          where action = 'mailbox.owner-bootstrap'
            or (resource_type = 'mailbox' and resource_id = 'primary'))
        and not exists (select 1
          from app_organization_owner_assignment_receipt))
      or exists (
        select 1
        from app_organization_owner_assignment_receipt as receipt
        join app_organization_member as member
          on member.id = receipt.membership_id
         and member.organization_id = receipt.organization_id
         and member.user_id = receipt.user_id
         and member.created_at = receipt.assigned_at
        join auth_role_grant as legacy
          on legacy.subject_type = receipt.legacy_subject_type
         and legacy.subject_id = receipt.legacy_subject_id
         and legacy.role_id = receipt.legacy_role_id
         and legacy.scope_type = receipt.legacy_scope_type
         and legacy.scope_id_present = receipt.legacy_scope_id_present
         and legacy.scope_id = receipt.legacy_scope_id
        join auth_role_grant as owner
          on owner.subject_type = receipt.organization_subject_type
         and owner.subject_id = receipt.organization_subject_id
         and owner.role_id = receipt.organization_role_id
         and owner.scope_type = receipt.organization_scope_type
         and owner.scope_id_present = receipt.organization_scope_id_present
         and owner.scope_id = receipt.organization_scope_id
        join app_mailbox as mailbox
          on mailbox.id = receipt.mailbox_id
        join app_organization as organization
          on organization.id = receipt.organization_id
        join app_mailbox_legacy_organization_assignment as ancestry
          on ancestry.mailbox_id = receipt.mailbox_id
         and ancestry.organization_id = receipt.organization_id
         and ancestry.effective_at = mailbox.created_at
         and ancestry.effective_at = organization.created_at
         and ancestry.source = receipt.source
         and ancestry.schema_version = 1
        where receipt.organization_id = 'legacy_default_v1'
          and receipt.mailbox_id = 'primary'
          and receipt.membership_id = 'legacy_default_v1_owner_v1'
          and receipt.schema_version = 1
          and receipt.legacy_subject_type = 'user'
          and receipt.legacy_subject_id = receipt.user_id
          and receipt.legacy_role_id = 'owner'
          and receipt.legacy_scope_type = 'mailbox'
          and receipt.legacy_scope_id_present = 1
          and receipt.legacy_scope_id = 'primary'
          and receipt.organization_subject_type = 'user'
          and receipt.organization_subject_id = receipt.user_id
          and receipt.organization_role_id = 'organization.owner'
          and receipt.organization_scope_type = 'organization'
          and receipt.organization_scope_id_present = 1
          and receipt.organization_scope_id = 'legacy_default_v1'
          and legacy.expires_at is null and legacy.metadata is null
          and owner.expires_at is null
          and owner.metadata = '{"membershipId":"legacy_default_v1_owner_v1","source":"organization-owner-bootstrap-v1"}'
          and (select count(*)
            from app_mailbox_legacy_organization_assignment) = 1
          and ((ancestry.source = 'legacy-cutover' and exists (
            select 1 from app_organization_legacy_cutover
            where id = 1 and schema_version = 1
              and outcome = 'legacy-primary'
              and source_mailbox_id = 'primary'
              and source_created_at = ancestry.effective_at
              and organization_id = 'legacy_default_v1'))
          or (ancestry.source = 'fresh-bootstrap' and exists (
            select 1 from app_organization_legacy_cutover
            where id = 1 and schema_version = 1
              and outcome = 'fresh-empty'
              and source_mailbox_id is null and source_created_at is null
              and organization_id is null)))
          and ((receipt.source = 'legacy-cutover'
            and ((receipt.source_bootstrap_operation_id is null
                  and receipt.source_audit_event_id is null
                  and not exists (select 1
                    from app_mailbox_administration_receipt
                    where operation_kind = 'bootstrap-owner')
                  and not exists (select 1
                    from app_administrative_audit_event
                    where action = 'mailbox.owner-bootstrap'))
              or (receipt.source_bootstrap_operation_id is null
                and exists (select 1 from app_administrative_audit_event audit
                  where audit.event_id = receipt.source_audit_event_id
                    and audit.action = 'mailbox.owner-bootstrap'
                    and audit.outcome = 'succeeded'
                    and audit.actor_type = 'user'
                    and audit.actor_id = receipt.user_id
                    and audit.tenant_scope_type = 'legacy-mailbox'
                    and audit.tenant_scope_id = 'primary'
                    and audit.resource_type = 'mailbox'
                    and audit.resource_id = 'primary'
                    and audit.reason_code = 'owner-bootstrap'
                    and audit.change_type = 'mailbox-bootstrapped'
                    and audit.resource_version_before is null
                    and audit.resource_version_after = 1
                    and audit.occurred_at = (select created_at
                      from app_mailbox where id = 'primary')
                    and (select count(*) from app_administrative_audit_event
                      where operation_id = audit.operation_id) = 1
                    and not exists (select 1
                      from app_mailbox_administration_receipt
                      where operation_kind = 'bootstrap-owner')
                    and (select count(*) from app_administrative_audit_event
                      where action = 'mailbox.owner-bootstrap') = 1))
              or (receipt.source_bootstrap_operation_id is not null
                and exists (select 1 from app_mailbox_administration_receipt bootstrap
                  join app_administrative_audit_event audit
                    on audit.operation_id = bootstrap.operation_id
                  where bootstrap.operation_id = receipt.source_bootstrap_operation_id
                    and audit.event_id = receipt.source_audit_event_id
                    and bootstrap.operation_kind = 'bootstrap-owner'
                    and bootstrap.actor_user_id = receipt.user_id
                    and bootstrap.mailbox_id = 'primary'
                    and bootstrap.expected_version is null
                    and bootstrap.result_mailbox_id = 'primary'
                    and bootstrap.result_created_by_user_id = receipt.user_id
                    and bootstrap.result_created_at = bootstrap.result_updated_at
                    and bootstrap.result_created_at = bootstrap.committed_at
                    and bootstrap.result_version = 1
                    and bootstrap.schema_version = 1
                    and audit.action = 'mailbox.owner-bootstrap'
                    and audit.outcome = 'succeeded'
                    and audit.actor_type = 'user'
                    and audit.actor_id = receipt.user_id
                    and audit.tenant_scope_type = 'legacy-mailbox'
                    and audit.tenant_scope_id = 'primary'
                    and audit.resource_type = 'mailbox'
                    and audit.resource_id = 'primary'
                    and audit.reason_code = 'owner-bootstrap'
                    and audit.change_type = 'mailbox-bootstrapped'
                    and audit.resource_version_before is null
                    and audit.resource_version_after = 1
                    and audit.occurred_at = bootstrap.committed_at
                    and ((select count(*)
                      from app_mailbox_bootstrap_receipt_v1_intent
                      where operation_id = bootstrap.operation_id)
                      + (select count(*) from app_mailbox_bootstrap_receipt_v2
                        where operation_id = bootstrap.operation_id)) = 1
                    and (select count(*) from app_administrative_audit_event
                      where operation_id = bootstrap.operation_id) = 1
                    and (select count(*) from app_mailbox_administration_receipt
                      where operation_kind = 'bootstrap-owner') = 1
                    and (select count(*) from app_administrative_audit_event
                      where action = 'mailbox.owner-bootstrap') = 1))))
          or (receipt.source = 'fresh-bootstrap'
            and receipt.source_bootstrap_operation_id is not null
            and receipt.source_audit_event_id is not null
            and exists (select 1 from app_mailbox_administration_receipt bootstrap
              join app_administrative_audit_event audit
                on audit.operation_id = bootstrap.operation_id
              where bootstrap.operation_id = receipt.source_bootstrap_operation_id
                and audit.event_id = receipt.source_audit_event_id
                and bootstrap.actor_user_id = receipt.user_id
                and bootstrap.operation_kind = 'bootstrap-owner'
                and bootstrap.mailbox_id = 'primary'
                and bootstrap.expected_version is null
                and bootstrap.result_mailbox_id = 'primary'
                and bootstrap.result_created_by_user_id = receipt.user_id
                and bootstrap.committed_at = receipt.assigned_at
                and bootstrap.result_created_at = receipt.assigned_at
                and bootstrap.result_updated_at = receipt.assigned_at
                and bootstrap.result_version = 1 and bootstrap.schema_version = 1
                and audit.action = 'mailbox.owner-bootstrap'
                and audit.outcome = 'succeeded' and audit.actor_type = 'user'
                and audit.actor_id = receipt.user_id
                and audit.tenant_scope_type = 'legacy-mailbox'
                and audit.tenant_scope_id = 'primary'
                and audit.resource_type = 'mailbox'
                and audit.resource_id = 'primary'
                and audit.reason_code = 'owner-bootstrap'
                and audit.change_type = 'mailbox-bootstrapped'
                and audit.resource_version_before is null
                and audit.resource_version_after = 1
                and audit.occurred_at = receipt.assigned_at
                and ((select count(*) from app_mailbox_bootstrap_receipt_v1_intent
                  where operation_id = bootstrap.operation_id)
                  + (select count(*) from app_mailbox_bootstrap_receipt_v2
                    where operation_id = bootstrap.operation_id)) = 1
                and (select count(*) from app_administrative_audit_event
                  where operation_id = bootstrap.operation_id) = 1
                and (select count(*) from app_mailbox_administration_receipt
                  where operation_kind = 'bootstrap-owner') = 1
                and (select count(*) from app_administrative_audit_event
                  where action = 'mailbox.owner-bootstrap') = 1)))))
    and (select count(*)
      from app_organization_owner_assignment_receipt) <= 1
  then 1
  else 0
end;

-- One migration timestamp is used for a legacy owner; fresh history retains the
-- real bootstrap audit timestamp. Never backdate legacy membership creation.
create temp table app_organization_owner_assignment_materialization (
  assigned_at integer not null,
  source text not null,
  user_id text not null,
  operation_id text,
  audit_event_id text
);

insert into app_organization_owner_assignment_materialization
  (assigned_at, source, user_id, operation_id, audit_event_id)
select
  case when ancestry.source = 'fresh-bootstrap' then audit.occurred_at
       else max(cast(unixepoch('subsec') * 1000 as integer),
                ancestry.effective_at) end,
  case when ancestry.source = 'fresh-bootstrap' then 'fresh-bootstrap'
       else 'legacy-cutover' end,
  candidate.user_id,
  receipt.operation_id,
  audit.event_id
from app_organization_owner_assignment_candidate as candidate
join app_mailbox_legacy_organization_assignment as ancestry
  on ancestry.mailbox_id = 'primary'
left join app_mailbox_administration_receipt as receipt
  on receipt.operation_kind = 'bootstrap-owner'
left join app_administrative_audit_event as audit
  on audit.action = 'mailbox.owner-bootstrap'
where (select receipt_was_present
         from app_organization_owner_assignment_application) = 0
  and exists (select 1 from app_mailbox)
  and (ancestry.source <> 'fresh-bootstrap'
    or (receipt.operation_id is not null and audit.event_id is not null))
group by candidate.user_id;

insert into app_organization_member (
  id, organization_id, user_id, status, created_at, updated_at,
  suspended_at, revoked_at, version
)
select 'legacy_default_v1_owner_v1', 'legacy_default_v1', user_id, 'active',
       assigned_at, assigned_at, null, null, 1
from app_organization_owner_assignment_materialization;

insert into auth_role_grant (
  subject_type, subject_id, role_id, scope_type, scope_id_present, scope_id,
  expires_at, metadata, revoked_at
)
select 'user', user_id, 'organization.owner', 'organization', 1,
       'legacy_default_v1', null,
       '{"membershipId":"legacy_default_v1_owner_v1","source":"organization-owner-bootstrap-v1"}',
       null
from app_organization_owner_assignment_materialization;

insert into app_organization_owner_assignment_receipt (
  organization_id, mailbox_id, user_id, membership_id, assigned_at, source,
  legacy_subject_type, legacy_subject_id, legacy_role_id, legacy_scope_type,
  legacy_scope_id_present, legacy_scope_id, organization_subject_type,
  organization_subject_id, organization_role_id, organization_scope_type,
  organization_scope_id_present, organization_scope_id,
  source_bootstrap_operation_id, source_audit_event_id, schema_version
)
select 'legacy_default_v1', 'primary', user_id,
       'legacy_default_v1_owner_v1', assigned_at, source,
       'user', user_id, 'owner', 'mailbox', 1, 'primary',
       'user', user_id, 'organization.owner', 'organization', 1,
       'legacy_default_v1', operation_id, audit_event_id, 1
from app_organization_owner_assignment_materialization;

insert into app_organization_owner_assignment_cutover (id, schema_version)
select 1, 1
where (select cutover_was_present
         from app_organization_owner_assignment_application) = 0;

delete from app_organization_owner_assignment_preflight;
insert into app_organization_owner_assignment_preflight (valid)
select case when
  (select count(*) from app_organization_owner_assignment_cutover) = 1
  and exists (select 1 from app_organization_owner_assignment_cutover
    where id = 1 and schema_version = 1)
  and ((not exists (select 1 from app_mailbox)
        and not exists (select 1
          from app_organization_owner_assignment_receipt))
    or ((select count(*)
           from app_organization_owner_assignment_receipt) = 1
      and exists (select 1
        from app_organization_owner_assignment_receipt
        where organization_id = 'legacy_default_v1'
          and mailbox_id = 'primary'
          and membership_id = 'legacy_default_v1_owner_v1'
          and schema_version = 1)))
  and not exists (select 1 from pragma_foreign_key_check)
then 1 else 0 end;

drop view app_organization_owner_assignment_history;
drop view app_organization_owner_assignment_candidate;
drop table app_organization_owner_assignment_materialization;
drop table app_organization_owner_assignment_preflight;
drop table app_organization_owner_assignment_application;

create trigger app_organization_owner_assignment_receipt_binding
before insert on app_organization_owner_assignment_receipt
when new.organization_id is not 'legacy_default_v1'
  or new.mailbox_id is not 'primary'
  or new.membership_id is not 'legacy_default_v1_owner_v1'
  or new.source is not 'fresh-bootstrap'
  or new.source_bootstrap_operation_id is null
  or new.source_audit_event_id is null
  or new.schema_version is not 1
  or not exists (select 1 from app_organization_owner_assignment_cutover
    where id = 1 and schema_version = 1)
  or exists (select 1 from app_organization_owner_assignment_receipt)
  or (select count(*) from app_organization_member) <> 1
  or (select count(*) from auth_role_grant
    where role_id = 'organization.owner'
      and scope_type = 'organization'
      and scope_id_present = 1
      and scope_id = 'legacy_default_v1') <> 1
  or (select count(*) from auth_role_grant
    where subject_type = 'user' and role_id = 'owner'
      and scope_type = 'mailbox' and scope_id_present = 1
      and scope_id = 'primary' and expires_at is null
      and metadata is null and revoked_at is null) <> 1
  or not exists (select 1 from app_organization_member
    where id = new.membership_id and organization_id = new.organization_id
      and user_id = new.user_id and status = 'active'
      and created_at = new.assigned_at and updated_at = new.assigned_at
      and suspended_at is null and revoked_at is null and version = 1)
  or not exists (select 1 from auth_role_grant
    where subject_type = 'user' and subject_id = new.user_id
      and role_id = 'owner' and scope_type = 'mailbox'
      and scope_id_present = 1 and scope_id = 'primary'
      and expires_at is null and metadata is null and revoked_at is null)
  or not exists (select 1 from auth_role_grant
    where subject_type = 'user' and subject_id = new.user_id
      and role_id = 'organization.owner' and scope_type = 'organization'
      and scope_id_present = 1 and scope_id = 'legacy_default_v1'
      and expires_at is null
      and metadata = '{"membershipId":"legacy_default_v1_owner_v1","source":"organization-owner-bootstrap-v1"}'
      and revoked_at is null)
  or not exists (select 1 from auth_user
    where id = new.user_id and disabled_at is null)
  or not exists (select 1 from app_mailbox_member
    where mailbox_id = 'primary' and user_id = new.user_id
      and revoked_at is null)
  or not exists (select 1 from app_mailbox
    where id = 'primary' and created_by_user_id = new.user_id
      and created_at = new.assigned_at)
  or not exists (select 1 from app_organization
    where id = 'legacy_default_v1' and created_at = new.assigned_at)
  or not exists (select 1 from app_mailbox_legacy_organization_assignment
    where mailbox_id = 'primary' and organization_id = 'legacy_default_v1'
      and effective_at = new.assigned_at and source = 'fresh-bootstrap'
      and schema_version = 1)
  or not exists (select 1 from app_organization_legacy_cutover
    where id = 1 and schema_version = 1 and outcome = 'fresh-empty'
      and source_mailbox_id is null and source_created_at is null
      and organization_id is null)
  or not exists (select 1 from app_mailbox_administration_receipt receipt
    join app_administrative_audit_event audit
      on audit.operation_id = receipt.operation_id
    where receipt.operation_id = new.source_bootstrap_operation_id
      and receipt.operation_kind = 'bootstrap-owner'
      and receipt.actor_user_id = new.user_id
      and receipt.mailbox_id = 'primary'
      and receipt.expected_version is null
      and receipt.result_mailbox_id = 'primary'
      and receipt.result_created_by_user_id = new.user_id
      and receipt.result_created_at = new.assigned_at
      and receipt.result_updated_at = new.assigned_at
      and receipt.committed_at = new.assigned_at
      and receipt.result_version = 1 and receipt.schema_version = 1
      and audit.event_id = new.source_audit_event_id
      and audit.action = 'mailbox.owner-bootstrap'
      and audit.outcome = 'succeeded' and audit.actor_type = 'user'
      and audit.actor_id = new.user_id
      and audit.tenant_scope_type = 'legacy-mailbox'
      and audit.tenant_scope_id = 'primary'
      and audit.resource_type = 'mailbox' and audit.resource_id = 'primary'
      and audit.reason_code = 'owner-bootstrap'
      and audit.change_type = 'mailbox-bootstrapped'
      and audit.resource_version_before is null
      and audit.resource_version_after = 1
      and audit.occurred_at = new.assigned_at)
  or ((select count(*) from app_mailbox_bootstrap_receipt_v1_intent
         where operation_id = new.source_bootstrap_operation_id)
    + (select count(*) from app_mailbox_bootstrap_receipt_v2
         where operation_id = new.source_bootstrap_operation_id)) <> 1
  or exists (select 1 from auth_role_grant
    where role_id = 'owner' and scope_type = 'global'
      and revoked_at is null
      and (expires_at is null or expires_at > new.assigned_at))
begin
  select raise(abort, 'invalid organization owner assignment receipt');
end;

create trigger app_organization_owner_assignment_receipt_no_replace
before insert on app_organization_owner_assignment_receipt
when exists (select 1 from app_organization_owner_assignment_receipt
  where organization_id = new.organization_id or membership_id = new.membership_id)
begin
  select raise(abort, 'organization owner assignment receipts are immutable');
end;

create trigger app_organization_owner_assignment_receipt_no_update
before update on app_organization_owner_assignment_receipt
begin
  select raise(abort, 'organization owner assignment receipts are immutable');
end;

create trigger app_organization_owner_assignment_receipt_no_delete
before delete on app_organization_owner_assignment_receipt
begin
  select raise(abort, 'organization owner assignment receipts are retained');
end;

create trigger app_organization_owner_assignment_cutover_no_insert
before insert on app_organization_owner_assignment_cutover
begin
  select raise(abort, 'organization owner assignment cutover is sealed');
end;

create trigger app_organization_owner_assignment_cutover_no_update
before update on app_organization_owner_assignment_cutover
begin
  select raise(abort, 'organization owner assignment cutover is immutable');
end;

create trigger app_organization_owner_assignment_cutover_no_delete
before delete on app_organization_owner_assignment_cutover
begin
  select raise(abort, 'organization owner assignment cutover is retained');
end;

-- Rolling compatibility for current and pre-ORG-008 mailbox bootstrap writers.
-- NEW.actor_id corroborates the unique grant nominee; it never selects one.
create trigger app_organization_owner_assignment_from_bootstrap_audit
after insert on app_administrative_audit_event
when new.action = 'mailbox.owner-bootstrap'
  and new.outcome = 'succeeded'
  and new.tenant_scope_type = 'legacy-mailbox'
  and new.tenant_scope_id = 'primary'
  and new.resource_type = 'mailbox'
  and new.resource_id = 'primary'
  and new.reason_code = 'owner-bootstrap'
  and new.change_type = 'mailbox-bootstrapped'
  and new.resource_version_before is null
  and new.resource_version_after = 1
begin
  select case when
    exists (select 1 from app_organization_member)
    or exists (select 1 from auth_role_grant
      where role_id = 'organization.owner')
    or exists (select 1 from app_organization_owner_assignment_receipt)
  then raise(abort, 'preexisting organization owner authority requires escalation') end;

  select case when not (
    new.actor_type = 'user'
    and new.occurred_at between 0 and 9007199254740991
    and (select count(*) from auth_role_grant
      where subject_type = 'user' and role_id = 'owner'
        and scope_type = 'mailbox' and scope_id_present = 1
        and scope_id = 'primary' and expires_at is null
        and metadata is null and revoked_at is null) = 1
    and exists (select 1 from auth_role_grant
      where subject_type = 'user' and subject_id = new.actor_id
        and role_id = 'owner' and scope_type = 'mailbox'
        and scope_id_present = 1 and scope_id = 'primary'
        and expires_at is null and metadata is null and revoked_at is null)
    and not exists (select 1 from auth_role_grant
      where role_id = 'owner' and scope_type = 'global'
        and revoked_at is null
        and (expires_at is null or expires_at > new.occurred_at))
    and exists (select 1 from auth_user
      where id = new.actor_id and disabled_at is null)
    and exists (select 1 from app_mailbox_member
      where mailbox_id = 'primary' and user_id = new.actor_id
        and revoked_at is null)
    and exists (select 1 from app_mailbox
      where id = 'primary' and created_by_user_id = new.actor_id
        and created_at = new.occurred_at)
    and exists (select 1 from app_organization
      where id = 'legacy_default_v1' and created_at = new.occurred_at)
    and exists (select 1 from app_mailbox_legacy_organization_assignment
      where mailbox_id = 'primary' and organization_id = 'legacy_default_v1'
        and effective_at = new.occurred_at and source = 'fresh-bootstrap'
        and schema_version = 1)
    and exists (select 1 from app_organization_legacy_cutover
      where id = 1 and schema_version = 1 and outcome = 'fresh-empty'
        and source_mailbox_id is null and source_created_at is null
        and organization_id is null)
    and (select count(*) from app_mailbox_administration_receipt
      where operation_kind = 'bootstrap-owner') = 1
    and exists (select 1 from app_mailbox_administration_receipt
      where operation_id = new.operation_id and operation_kind = 'bootstrap-owner'
        and actor_user_id = new.actor_id and mailbox_id = 'primary'
        and expected_version is null and result_mailbox_id = 'primary'
        and result_created_by_user_id = new.actor_id
        and result_created_at = new.occurred_at
        and result_updated_at = new.occurred_at
        and committed_at = new.occurred_at and result_version = 1
        and schema_version = 1)
    and ((select count(*) from app_mailbox_bootstrap_receipt_v1_intent
           where operation_id = new.operation_id)
      + (select count(*) from app_mailbox_bootstrap_receipt_v2
           where operation_id = new.operation_id)) = 1
    and (select count(*) from app_administrative_audit_event
      where action = 'mailbox.owner-bootstrap') = 1
    and (select count(*) from app_administrative_audit_event
      where operation_id = new.operation_id) = 1
    and exists (select 1 from auth_role_definition
      where id = 'owner' and description = 'Full mailbox control'
        and created_at = 0 and updated_at = 0
        and disabled_at is null and deleted_at is null)
    and exists (select 1 from auth_role_definition
      where id = 'organization.owner'
        and description = 'Full organization control'
        and created_at = 0 and updated_at = 0
        and disabled_at is null and deleted_at is null)
    and not exists (select 1 from auth_role_permission
      where role_id = 'owner' and not (
        scope_type_present = 1
        and ((scope_type = 'mailbox' and permission_id in (
          'mailbox.read', 'mailbox.modify', 'mailbox.send',
          'mailbox.manage_settings', 'mailbox.manage_members', 'mailbox.export',
          'message.read', 'message.modify', 'draft.create', 'draft.send',
          'rule.manage', 'attachment.read', 'attachment.upload'))
        or (scope_type = 'folder'
          and permission_id in ('folder.read', 'folder.modify')))))
    and not exists (select 1 from auth_role_permission
      where role_id = 'organization.owner' and not (
        scope_type_present = 1 and scope_type = 'organization'
        and permission_id in (
          'organization.read', 'organization.manage_settings',
          'organization.manage_members', 'organization.manage_domains',
          'organization.manage_addresses', 'organization.manage_mailboxes',
          'organization.read_audit', 'organization.transfer_ownership')))
    and not exists (
      select 1 from json_each('["organization.read","organization.manage_settings","organization.manage_members","organization.manage_domains","organization.manage_addresses","organization.manage_mailboxes","organization.read_audit","organization.transfer_ownership"]') as expected
      where not exists (select 1 from auth_role_permission mapping
        where mapping.role_id = 'organization.owner'
          and mapping.permission_id = expected.value
          and mapping.scope_type_present = 1
          and mapping.scope_type = 'organization'))
    and not exists (
      select 1 from json_each('["organization.read","organization.manage_settings","organization.manage_members","organization.manage_domains","organization.manage_addresses","organization.manage_mailboxes","organization.read_audit","organization.transfer_ownership"]') as expected
      where not exists (select 1 from auth_permission_definition definition
        where definition.id = expected.value
          and definition.scope_type_present = 1
          and definition.scope_type = 'organization'
          and definition.created_at = 0 and definition.updated_at = 0
          and definition.disabled_at is null and definition.deleted_at is null))
    and not exists (
      select 1 from json_each('["mailbox.read","mailbox.modify","mailbox.send","mailbox.manage_settings","mailbox.manage_members","mailbox.export","message.read","message.modify","draft.create","draft.send","rule.manage","attachment.read","attachment.upload"]') as expected
      where not exists (select 1 from auth_permission_definition definition
        where definition.id = expected.value
          and definition.scope_type_present = 1
          and definition.scope_type = 'mailbox'
          and definition.created_at = 0 and definition.updated_at = 0
          and definition.disabled_at is null and definition.deleted_at is null))
    and not exists (
      select 1 from json_each('["folder.read","folder.modify"]') as expected
      where not exists (select 1 from auth_permission_definition definition
        where definition.id = expected.value
          and definition.scope_type_present = 1
          and definition.scope_type = 'folder'
          and definition.created_at = 0 and definition.updated_at = 0
          and definition.disabled_at is null and definition.deleted_at is null))
    and not exists (
      select 1 from json_each('["mailbox.read","mailbox.modify","mailbox.send","mailbox.manage_settings","mailbox.manage_members","mailbox.export","message.read","message.modify","draft.create","draft.send","rule.manage","attachment.read","attachment.upload"]') as expected
      where not exists (select 1 from auth_role_permission mapping
        where mapping.role_id = 'owner'
          and mapping.permission_id = expected.value
          and mapping.scope_type_present = 1
          and mapping.scope_type = 'mailbox'))
    and not exists (
      select 1 from json_each('["folder.read","folder.modify"]') as expected
      where not exists (select 1 from auth_role_permission mapping
        where mapping.role_id = 'owner'
          and mapping.permission_id = expected.value
          and mapping.scope_type_present = 1
          and mapping.scope_type = 'folder'))
  ) then raise(abort, 'invalid fresh organization owner nomination') end;

  insert into app_organization_member (
    id, organization_id, user_id, status, created_at, updated_at,
    suspended_at, revoked_at, version
  )
  select 'legacy_default_v1_owner_v1', 'legacy_default_v1', grant_row.subject_id,
         'active', new.occurred_at, new.occurred_at, null, null, 1
  from auth_role_grant as grant_row
  where grant_row.subject_type = 'user'
    and grant_row.role_id = 'owner'
    and grant_row.scope_type = 'mailbox'
    and grant_row.scope_id_present = 1 and grant_row.scope_id = 'primary'
    and grant_row.expires_at is null and grant_row.metadata is null
    and grant_row.revoked_at is null
    and grant_row.subject_id = new.actor_id
    and new.actor_type = 'user'
    and new.occurred_at between 0 and 9007199254740991
    and (select count(*) from auth_role_grant
      where subject_type = 'user' and role_id = 'owner'
        and scope_type = 'mailbox' and scope_id_present = 1
        and scope_id = 'primary' and expires_at is null
        and metadata is null and revoked_at is null) = 1
    and not exists (select 1 from app_organization_owner_assignment_receipt)
    and not exists (select 1 from app_organization_member)
    and not exists (select 1 from auth_role_grant where role_id = 'organization.owner')
    and exists (select 1 from auth_user
      where id = grant_row.subject_id and disabled_at is null)
    and exists (select 1 from app_mailbox_member
      where mailbox_id = 'primary' and user_id = grant_row.subject_id
        and revoked_at is null)
    and exists (select 1 from app_mailbox
      where id = 'primary' and created_by_user_id = grant_row.subject_id
        and created_at = new.occurred_at)
    and exists (select 1 from app_organization
      where id = 'legacy_default_v1' and created_at = new.occurred_at)
    and exists (select 1
      from app_mailbox_legacy_organization_assignment
      where mailbox_id = 'primary' and organization_id = 'legacy_default_v1'
        and effective_at = new.occurred_at and source = 'fresh-bootstrap'
        and schema_version = 1)
    and exists (select 1 from app_organization_legacy_cutover
      where id = 1 and schema_version = 1 and outcome = 'fresh-empty'
        and source_mailbox_id is null and source_created_at is null
        and organization_id is null)
    and exists (select 1 from app_mailbox_administration_receipt
      where operation_id = new.operation_id and operation_kind = 'bootstrap-owner'
        and actor_user_id = grant_row.subject_id and mailbox_id = 'primary'
        and expected_version is null and result_mailbox_id = 'primary'
        and result_created_by_user_id = grant_row.subject_id
        and result_created_at = new.occurred_at
        and result_updated_at = new.occurred_at
        and committed_at = new.occurred_at and result_version = 1
        and schema_version = 1)
    and ((select count(*) from app_mailbox_bootstrap_receipt_v1_intent
           where operation_id = new.operation_id)
      + (select count(*) from app_mailbox_bootstrap_receipt_v2
           where operation_id = new.operation_id)) = 1
    and not exists (select 1 from auth_role_grant
      where role_id = 'owner' and scope_type = 'global'
        and revoked_at is null
        and (expires_at is null or expires_at > new.occurred_at))
    and exists (select 1 from auth_role_definition
      where id = 'owner' and description = 'Full mailbox control'
        and created_at = 0 and updated_at = 0
        and disabled_at is null and deleted_at is null)
    and (select count(*) from auth_role_permission where role_id = 'owner') = 15;

  insert into auth_role_grant (
    subject_type, subject_id, role_id, scope_type, scope_id_present, scope_id,
    expires_at, metadata, revoked_at
  )
  select 'user', user_id, 'organization.owner', 'organization', 1,
         'legacy_default_v1', null,
         '{"membershipId":"legacy_default_v1_owner_v1","source":"organization-owner-bootstrap-v1"}',
         null
  from app_organization_member
  where id = 'legacy_default_v1_owner_v1'
    and created_at = new.occurred_at;

  insert into app_organization_owner_assignment_receipt (
    organization_id, mailbox_id, user_id, membership_id, assigned_at, source,
    legacy_subject_type, legacy_subject_id, legacy_role_id, legacy_scope_type,
    legacy_scope_id_present, legacy_scope_id, organization_subject_type,
    organization_subject_id, organization_role_id, organization_scope_type,
    organization_scope_id_present, organization_scope_id,
    source_bootstrap_operation_id, source_audit_event_id, schema_version
  )
  select 'legacy_default_v1', 'primary', user_id,
         'legacy_default_v1_owner_v1', new.occurred_at, 'fresh-bootstrap',
         'user', user_id, 'owner', 'mailbox', 1, 'primary',
         'user', user_id, 'organization.owner', 'organization', 1,
         'legacy_default_v1', new.operation_id, new.event_id, 1
  from app_organization_member
  where id = 'legacy_default_v1_owner_v1'
    and created_at = new.occurred_at;

  select case when (select count(*)
    from app_organization_owner_assignment_receipt as receipt
    join app_organization_member as member on member.id = receipt.membership_id
    join auth_role_grant as owner
      on owner.subject_type = receipt.organization_subject_type
     and owner.subject_id = receipt.organization_subject_id
     and owner.role_id = receipt.organization_role_id
     and owner.scope_type = receipt.organization_scope_type
     and owner.scope_id_present = receipt.organization_scope_id_present
     and owner.scope_id = receipt.organization_scope_id
    where receipt.organization_id = 'legacy_default_v1'
      and receipt.user_id = new.actor_id
      and receipt.assigned_at = new.occurred_at
      and receipt.source_bootstrap_operation_id = new.operation_id
      and receipt.source_audit_event_id = new.event_id) <> 1
  then raise(abort, 'organization owner assignment materialization failed') end;
end;
