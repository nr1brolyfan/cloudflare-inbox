create temp table app_mailbox_legacy_organization_assignment_application (
  assignment_was_present integer not null check (assignment_was_present in (0, 1)),
  cutover_was_present integer not null check (cutover_was_present in (0, 1))
);

insert into app_mailbox_legacy_organization_assignment_application (
  assignment_was_present, cutover_was_present
)
select
  exists (
    select 1 from sqlite_master
    where type = 'table'
      and name = 'app_mailbox_legacy_organization_assignment'
  ),
  exists (
    select 1 from sqlite_master
    where type = 'table'
      and name = 'app_mailbox_legacy_organization_assignment_cutover'
  );

create temp table app_mailbox_legacy_organization_assignment_entry_preflight (
  valid integer not null check (valid = 1)
);

-- Refuse column-era schemas and inspect every reserved trigger name before any
-- DROP. On reapply a malformed trigger may be repaired only on its owned table.
insert into app_mailbox_legacy_organization_assignment_entry_preflight (valid)
select case when
  not exists (
    select 1 from pragma_table_xinfo('app_mailbox')
    where name = 'organization_id'
  )
  and not exists (
    select 1 from sqlite_master
    where name glob 'app_mailbox_organization_*'
  )
  and (select sql from sqlite_master
       where type = 'trigger'
         and name = 'app_organization_identity_immutable'
         and tbl_name = 'app_organization')
    = 'CREATE TRIGGER app_organization_identity_immutable
before update of id, created_at on app_organization
when old.id is not new.id or old.created_at is not new.created_at
begin
  select raise(abort, ''organization identity and creation time are immutable'');
end'
  and (select assignment_was_present
         from app_mailbox_legacy_organization_assignment_application)
    = (select cutover_was_present
         from app_mailbox_legacy_organization_assignment_application)
  and (
    (
      (select assignment_was_present
         from app_mailbox_legacy_organization_assignment_application) = 0
      and not exists (
        select 1 from sqlite_master
        where name in (
          'app_mailbox_legacy_organization_assignment_binding',
          'app_mailbox_legacy_organization_assignment_no_replace',
          'app_mailbox_legacy_organization_assignment_no_update',
          'app_mailbox_legacy_organization_assignment_no_delete',
          'app_mailbox_legacy_organization_assignment_cutover_no_insert',
          'app_mailbox_legacy_organization_assignment_cutover_no_update',
          'app_mailbox_legacy_organization_assignment_cutover_no_delete',
          'app_mailbox_legacy_organization_assignment_from_fresh_mailbox'
        )
      )
    )
    or (
      (select assignment_was_present
         from app_mailbox_legacy_organization_assignment_application) = 1
      and not exists (
        select 1 from sqlite_master
        where (
          name in (
            'app_mailbox_legacy_organization_assignment_binding',
            'app_mailbox_legacy_organization_assignment_no_replace',
            'app_mailbox_legacy_organization_assignment_no_update',
            'app_mailbox_legacy_organization_assignment_no_delete'
          )
          and (type <> 'trigger'
            or tbl_name <> 'app_mailbox_legacy_organization_assignment')
        ) or (
          name in (
            'app_mailbox_legacy_organization_assignment_cutover_no_insert',
            'app_mailbox_legacy_organization_assignment_cutover_no_update',
            'app_mailbox_legacy_organization_assignment_cutover_no_delete'
          )
          and (type <> 'trigger'
            or tbl_name <> 'app_mailbox_legacy_organization_assignment_cutover')
        ) or (
          name = 'app_mailbox_legacy_organization_assignment_from_fresh_mailbox'
          and (type <> 'trigger' or tbl_name <> 'app_mailbox')
        )
      )
    )
  )
then 1 else 0 end;

drop table app_mailbox_legacy_organization_assignment_entry_preflight;

create temp table app_mailbox_legacy_organization_assignment_expected_org006_trigger (
  name text not null primary key,
  table_name text not null,
  expected_sql text not null
);

insert into app_mailbox_legacy_organization_assignment_expected_org006_trigger
  (name, table_name, expected_sql)
values
  (
    'app_organization_legacy_cutover_no_insert',
    'app_organization_legacy_cutover',
    'CREATE TRIGGER app_organization_legacy_cutover_no_insert
before insert on app_organization_legacy_cutover
begin
  select raise(abort, ''organization legacy cutover is sealed'');
end'
  ),
  (
    'app_organization_legacy_cutover_no_update',
    'app_organization_legacy_cutover',
    'CREATE TRIGGER app_organization_legacy_cutover_no_update
before update on app_organization_legacy_cutover
begin
  select raise(abort, ''organization legacy cutover is immutable'');
end'
  ),
  (
    'app_organization_legacy_cutover_no_delete',
    'app_organization_legacy_cutover',
    'CREATE TRIGGER app_organization_legacy_cutover_no_delete
before delete on app_organization_legacy_cutover
begin
  select raise(abort, ''organization legacy cutover is retained'');
end'
  ),
  (
    'app_organization_fresh_mailbox_insert_guard',
    'app_mailbox',
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
end'
  ),
  (
    'app_organization_mailbox_creation_provenance',
    'app_mailbox',
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
end'
  ),
  (
    'app_organization_primary_mailbox_no_replace',
    'app_mailbox',
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
end'
  ),
  (
    'app_organization_primary_mailbox_no_delete',
    'app_mailbox',
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
end'
  );

drop trigger if exists app_mailbox_legacy_organization_assignment_binding;
drop trigger if exists app_mailbox_legacy_organization_assignment_no_replace;
drop trigger if exists app_mailbox_legacy_organization_assignment_no_update;
drop trigger if exists app_mailbox_legacy_organization_assignment_no_delete;
drop trigger if exists app_mailbox_legacy_organization_assignment_cutover_no_insert;
drop trigger if exists app_mailbox_legacy_organization_assignment_cutover_no_update;
drop trigger if exists app_mailbox_legacy_organization_assignment_cutover_no_delete;
drop trigger if exists app_mailbox_legacy_organization_assignment_from_fresh_mailbox;

create table if not exists app_mailbox_legacy_organization_assignment (
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
    check (typeof(mailbox_id) = 'text' and mailbox_id = 'primary'),
  constraint app_mailbox_legacy_organization_assignment_organization_check
    check (
      typeof(organization_id) = 'text'
      and organization_id = 'legacy_default_v1'
    ),
  constraint app_mailbox_legacy_organization_assignment_effective_check
    check (
      typeof(effective_at) = 'integer'
      and effective_at between 0 and 9007199254740991
    ),
  constraint app_mailbox_legacy_organization_assignment_source_check
    check (
      typeof(source) = 'text'
      and source in ('legacy-cutover', 'fresh-bootstrap')
    ),
  constraint app_mailbox_legacy_organization_assignment_schema_check
    check (typeof(schema_version) = 'integer' and schema_version = 1)
);

create table if not exists app_mailbox_legacy_organization_assignment_cutover (
  id integer primary key,
  schema_version integer not null,
  constraint app_mailbox_legacy_organization_assignment_cutover_id_check
    check (id = 1),
  constraint app_mailbox_legacy_organization_assignment_cutover_schema_check
    check (typeof(schema_version) = 'integer' and schema_version = 1)
);

create temp table app_mailbox_legacy_organization_assignment_preflight (
  valid integer not null check (valid = 1)
);

insert into app_mailbox_legacy_organization_assignment_preflight (valid)
select case when
  (select assignment_was_present
     from app_mailbox_legacy_organization_assignment_application)
  =
  (select cutover_was_present
     from app_mailbox_legacy_organization_assignment_application)
  and (select count(*)
         from pragma_table_xinfo('app_mailbox_legacy_organization_assignment')) = 5
  and not exists (
    select 1
    from pragma_table_xinfo('app_mailbox_legacy_organization_assignment')
    where not (
      (cid = 0 and name = 'mailbox_id' and type = 'TEXT' and "notnull" = 1
        and dflt_value is null and pk = 1 and hidden = 0)
      or (cid = 1 and name = 'organization_id' and type = 'TEXT'
        and "notnull" = 1 and dflt_value is null and pk = 0 and hidden = 0)
      or (cid = 2 and name = 'effective_at' and type = 'INTEGER'
        and "notnull" = 1 and dflt_value is null and pk = 0 and hidden = 0)
      or (cid = 3 and name = 'source' and type = 'TEXT'
        and "notnull" = 1 and dflt_value is null and pk = 0 and hidden = 0)
      or (cid = 4 and name = 'schema_version' and type = 'INTEGER'
        and "notnull" = 1 and dflt_value is null and pk = 0 and hidden = 0)
    )
  )
  and (select count(*)
         from pragma_index_list('app_mailbox_legacy_organization_assignment')) = 1
  and exists (
    select 1
    from pragma_index_list('app_mailbox_legacy_organization_assignment')
    where name = 'sqlite_autoindex_app_mailbox_legacy_organization_assignment_1'
      and "unique" = 1 and origin = 'pk' and partial = 0
  )
  and (select count(*) from pragma_index_info(
         'sqlite_autoindex_app_mailbox_legacy_organization_assignment_1')) = 1
  and exists (
    select 1 from pragma_index_info(
      'sqlite_autoindex_app_mailbox_legacy_organization_assignment_1')
    where seqno = 0 and cid = 0 and name = 'mailbox_id'
  )
  and (select count(*)
         from pragma_foreign_key_list('app_mailbox_legacy_organization_assignment')) = 2
  and exists (
    select 1
    from pragma_foreign_key_list('app_mailbox_legacy_organization_assignment')
    where "table" = 'app_mailbox' and "from" = 'mailbox_id' and "to" = 'id'
      and on_update = 'RESTRICT' and on_delete = 'RESTRICT' and match = 'NONE'
  )
  and exists (
    select 1
    from pragma_foreign_key_list('app_mailbox_legacy_organization_assignment')
    where "table" = 'app_organization' and "from" = 'organization_id'
      and "to" = 'id' and on_update = 'RESTRICT' and on_delete = 'RESTRICT'
      and match = 'NONE'
  )
  and (select sql from sqlite_master where type = 'table'
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
  and (select count(*) from pragma_table_xinfo(
         'app_mailbox_legacy_organization_assignment_cutover')) = 2
  and not exists (
    select 1
    from pragma_table_xinfo('app_mailbox_legacy_organization_assignment_cutover')
    where not (
      (cid = 0 and name = 'id' and type = 'INTEGER' and "notnull" = 0
        and dflt_value is null and pk = 1 and hidden = 0)
      or (cid = 1 and name = 'schema_version' and type = 'INTEGER'
        and "notnull" = 1 and dflt_value is null and pk = 0 and hidden = 0)
    )
  )
  and not exists (
    select 1
    from pragma_index_list('app_mailbox_legacy_organization_assignment_cutover')
  )
  and not exists (
    select 1
    from pragma_foreign_key_list(
      'app_mailbox_legacy_organization_assignment_cutover')
  )
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
  and not exists (
    select 1 from sqlite_master
    where type = 'trigger'
      and tbl_name in (
        'app_mailbox_legacy_organization_assignment',
        'app_mailbox_legacy_organization_assignment_cutover'
      )
  )
  and not exists (
    select 1 from sqlite_master
    where type = 'trigger'
      and name in (
        'app_mailbox_legacy_organization_assignment_binding',
        'app_mailbox_legacy_organization_assignment_no_replace',
        'app_mailbox_legacy_organization_assignment_no_update',
        'app_mailbox_legacy_organization_assignment_no_delete',
        'app_mailbox_legacy_organization_assignment_cutover_no_insert',
        'app_mailbox_legacy_organization_assignment_cutover_no_update',
        'app_mailbox_legacy_organization_assignment_cutover_no_delete',
        'app_mailbox_legacy_organization_assignment_from_fresh_mailbox'
      )
  )
then 1 else 0 end;

-- ORG-007 may run only over the exact sealed ORG-006 storage generation.
insert into app_mailbox_legacy_organization_assignment_preflight (valid)
select case when
  (select count(*) from pragma_table_xinfo('app_organization_legacy_cutover')) = 6
  and not exists (
    select 1 from pragma_table_xinfo('app_organization_legacy_cutover')
    where not (
      (cid = 0 and name = 'id' and type = 'INTEGER' and "notnull" = 0
        and dflt_value is null and pk = 1 and hidden = 0)
      or (cid = 1 and name = 'schema_version' and type = 'INTEGER'
        and "notnull" = 1 and dflt_value is null and pk = 0 and hidden = 0)
      or (cid = 2 and name = 'outcome' and type = 'TEXT'
        and "notnull" = 1 and dflt_value is null and pk = 0 and hidden = 0)
      or (cid = 3 and name = 'source_mailbox_id' and type = 'TEXT'
        and "notnull" = 0 and dflt_value is null and pk = 0 and hidden = 0)
      or (cid = 4 and name = 'source_created_at' and type = 'INTEGER'
        and "notnull" = 0 and dflt_value is null and pk = 0 and hidden = 0)
      or (cid = 5 and name = 'organization_id' and type = 'TEXT'
        and "notnull" = 0 and dflt_value is null and pk = 0 and hidden = 0)
    )
  )
  and not exists (select 1 from pragma_index_list('app_organization_legacy_cutover'))
  and (select count(*)
         from pragma_foreign_key_list('app_organization_legacy_cutover')) = 2
  and exists (
    select 1 from pragma_foreign_key_list('app_organization_legacy_cutover')
    where "table" = 'app_mailbox' and "from" = 'source_mailbox_id'
      and "to" = 'id' and on_update = 'RESTRICT' and on_delete = 'RESTRICT'
      and match = 'NONE'
  )
  and exists (
    select 1 from pragma_foreign_key_list('app_organization_legacy_cutover')
    where "table" = 'app_organization' and "from" = 'organization_id'
      and "to" = 'id' and on_update = 'RESTRICT' and on_delete = 'RESTRICT'
      and match = 'NONE'
  )
  and instr((select sql from sqlite_master where type = 'table'
               and name = 'app_organization_legacy_cutover'),
            'constraint app_organization_legacy_cutover_id_check') > 0
  and instr((select sql from sqlite_master where type = 'table'
               and name = 'app_organization_legacy_cutover'),
            'constraint app_organization_legacy_cutover_schema_check') > 0
  and instr((select sql from sqlite_master where type = 'table'
               and name = 'app_organization_legacy_cutover'),
            'constraint app_organization_legacy_cutover_outcome_check') > 0
  and instr((select sql from sqlite_master where type = 'table'
               and name = 'app_organization_legacy_cutover'),
            'source_created_at between 0 and 9007199254740991') > 0
  and instr((select sql from sqlite_master where type = 'table'
               and name = 'app_organization_legacy_cutover'),
            'outcome = ''legacy-primary''') > 0
  and instr((select sql from sqlite_master where type = 'table'
               and name = 'app_organization_legacy_cutover'),
            'outcome = ''fresh-empty''') > 0
  and (
    length((select sql from sqlite_master where type = 'table'
              and name = 'app_organization_legacy_cutover'))
    - length(replace((select sql from sqlite_master where type = 'table'
                       and name = 'app_organization_legacy_cutover'),
                     'check (', ''))
  ) / length('check (') = 3
  and (select count(*) from sqlite_master
       where type = 'trigger'
         and tbl_name = 'app_organization_legacy_cutover') = 3
  and not exists (
    select 1
    from app_mailbox_legacy_organization_assignment_expected_org006_trigger
      as expected
    left join sqlite_master as actual on actual.name = expected.name
    where actual.type is not 'trigger'
      or actual.tbl_name is not expected.table_name
      or actual.sql is not expected.expected_sql
  )
  and exists (
    select 1 from pragma_index_list('app_mailbox')
    where name = 'app_mailbox_singleton_idx'
      and "unique" = 1 and origin = 'c' and partial = 0
  )
  and (select count(*)
         from pragma_index_xinfo('app_mailbox_singleton_idx')) = 2
  and exists (
    select 1 from pragma_index_xinfo('app_mailbox_singleton_idx')
    where seqno = 0 and cid = -2 and name is null
      and "desc" = 0 and coll = 'BINARY' and key = 1
  )
  and exists (
    select 1 from pragma_index_xinfo('app_mailbox_singleton_idx')
    where seqno = 1 and cid = -1 and name is null
      and "desc" = 0 and coll = 'BINARY' and key = 0
  )
  and (select sql from sqlite_master
       where type = 'index' and name = 'app_mailbox_singleton_idx')
    = 'CREATE UNIQUE INDEX app_mailbox_singleton_idx
  on app_mailbox ((1))'
  and not exists (select 1 from pragma_foreign_key_check)
then 1 else 0 end;

drop table app_mailbox_legacy_organization_assignment_expected_org006_trigger;

create temp view app_mailbox_legacy_organization_assignment_parent_state as
select
  case when
    (select count(*) from app_mailbox) = 1
    and (select count(*) from app_organization) = 1
    and exists (
      select 1
      from app_mailbox as mailbox
      join app_organization as organization
        on organization.id = 'legacy_default_v1'
       and organization.created_at = mailbox.created_at
      where mailbox.id = 'primary'
        and typeof(mailbox.id) = 'text'
        and typeof(mailbox.display_name) = 'text'
        and length(mailbox.display_name) between 1 and 200
        and typeof(mailbox.status) = 'text'
        and mailbox.status in ('active', 'suspended', 'deleting', 'deleted')
        and typeof(mailbox.created_by_user_id) = 'text'
        and length(mailbox.created_by_user_id) between 1 and 128
        and typeof(mailbox.created_at) = 'integer'
        and mailbox.created_at between 0 and 9007199254740991
        and typeof(mailbox.updated_at) = 'integer'
        and mailbox.updated_at between mailbox.created_at and 9007199254740991
        and (mailbox.deleted_at is null or (
          typeof(mailbox.deleted_at) = 'integer'
          and mailbox.deleted_at between mailbox.created_at and 9007199254740991
        ))
        and typeof(mailbox.version) = 'integer'
        and mailbox.version between 1 and 9007199254740991
        and ((mailbox.status = 'deleted' and mailbox.deleted_at is not null)
          or (mailbox.status <> 'deleted' and mailbox.deleted_at is null))
        and (mailbox.version > 1 or (
          mailbox.status = 'active'
          and mailbox.updated_at = mailbox.created_at
          and mailbox.deleted_at is null
        ))
        and typeof(organization.id) = 'text'
        and typeof(organization.status) = 'text'
        and organization.status in ('active', 'suspended')
        and typeof(organization.created_at) = 'integer'
        and organization.created_at between 0 and 9007199254740991
        and typeof(organization.updated_at) = 'integer'
        and organization.updated_at between organization.created_at
          and 9007199254740991
        and typeof(organization.version) = 'integer'
        and organization.version between 1 and 9007199254740991
        and (organization.version > 1 or (
          organization.status = 'active'
          and organization.updated_at = organization.created_at
        ))
    )
  then 1 else 0 end as valid,
  case when exists (
    select 1 from app_mailbox as mailbox
    join app_organization as organization
      on organization.id = 'legacy_default_v1'
     and organization.created_at = mailbox.created_at
    where mailbox.id = 'primary'
      and mailbox.status = 'active'
      and mailbox.version = 1
      and mailbox.updated_at = mailbox.created_at
      and mailbox.deleted_at is null
      and organization.status = 'active'
      and organization.version = 1
      and organization.updated_at = organization.created_at
  ) then 1 else 0 end as initial_pair;

-- First application accepts only legacy-primary, exact fresh-empty, or an exact
-- reserved pair created by a post-ORG-006 writer before this migration arrived.
insert into app_mailbox_legacy_organization_assignment_preflight (valid)
select case
  when (select assignment_was_present
          from app_mailbox_legacy_organization_assignment_application) = 0
    and (select count(*) from app_mailbox_legacy_organization_assignment) = 0
    and (select count(*)
           from app_mailbox_legacy_organization_assignment_cutover) = 0
    and (
      (
        exists (
          select 1
          from app_organization_legacy_cutover as cutover
          join app_mailbox as mailbox
            on mailbox.id = cutover.source_mailbox_id
           and mailbox.created_at = cutover.source_created_at
          join app_organization as organization
            on organization.id = cutover.organization_id
           and organization.created_at = cutover.source_created_at
          where cutover.id = 1 and cutover.schema_version = 1
            and cutover.outcome = 'legacy-primary'
            and cutover.source_mailbox_id = 'primary'
            and cutover.organization_id = 'legacy_default_v1'
        )
        and (select valid
               from app_mailbox_legacy_organization_assignment_parent_state) = 1
      )
      or (
        exists (
          select 1 from app_organization_legacy_cutover
          where id = 1 and schema_version = 1 and outcome = 'fresh-empty'
            and source_mailbox_id is null and source_created_at is null
            and organization_id is null
        )
        and (
          (not exists (select 1 from app_mailbox)
            and not exists (select 1 from app_organization))
          or (
            (select valid
               from app_mailbox_legacy_organization_assignment_parent_state) = 1
            and (select initial_pair
                   from app_mailbox_legacy_organization_assignment_parent_state) = 1
          )
        )
      )
    )
  then 1
  when (select assignment_was_present
          from app_mailbox_legacy_organization_assignment_application) = 1
    and (select count(*)
           from app_mailbox_legacy_organization_assignment_cutover) = 1
    and exists (
      select 1 from app_mailbox_legacy_organization_assignment_cutover
      where id = 1 and schema_version = 1
    )
    and (
      (
        not exists (select 1 from app_mailbox)
        and not exists (select 1 from app_organization)
        and not exists (
          select 1 from app_mailbox_legacy_organization_assignment
        )
        and exists (
          select 1 from app_organization_legacy_cutover
          where id = 1 and schema_version = 1 and outcome = 'fresh-empty'
            and source_mailbox_id is null and source_created_at is null
            and organization_id is null
        )
      )
      or (
        (select valid
           from app_mailbox_legacy_organization_assignment_parent_state) = 1
        and (select count(*)
               from app_mailbox_legacy_organization_assignment) = 1
        and exists (
          select 1
          from app_mailbox_legacy_organization_assignment as assignment
          join app_mailbox as mailbox on mailbox.id = assignment.mailbox_id
          join app_organization as organization
            on organization.id = assignment.organization_id
          where assignment.mailbox_id = 'primary'
            and assignment.organization_id = 'legacy_default_v1'
            and assignment.effective_at = mailbox.created_at
            and assignment.effective_at = organization.created_at
            and assignment.schema_version = 1
            and (
              (assignment.source = 'legacy-cutover' and exists (
                select 1 from app_organization_legacy_cutover
                where id = 1 and schema_version = 1
                  and outcome = 'legacy-primary'
                  and source_mailbox_id = 'primary'
                  and source_created_at = assignment.effective_at
                  and organization_id = 'legacy_default_v1'
              ))
              or (assignment.source = 'fresh-bootstrap' and exists (
                select 1 from app_organization_legacy_cutover
                where id = 1 and schema_version = 1
                  and outcome = 'fresh-empty'
                  and source_mailbox_id is null and source_created_at is null
                  and organization_id is null
              ))
            )
        )
      )
    )
  then 1
  else 0
end;

insert into app_mailbox_legacy_organization_assignment_cutover (
  id, schema_version
)
select 1, 1
where (select assignment_was_present
         from app_mailbox_legacy_organization_assignment_application) = 0;

insert into app_mailbox_legacy_organization_assignment (
  mailbox_id, organization_id, effective_at, source, schema_version
)
select 'primary', 'legacy_default_v1', mailbox.created_at,
       'legacy-cutover', 1
from app_mailbox as mailbox
join app_organization_legacy_cutover as cutover
  on cutover.id = 1
 and cutover.schema_version = 1
 and cutover.outcome = 'legacy-primary'
 and cutover.source_mailbox_id = mailbox.id
 and cutover.source_created_at = mailbox.created_at
 and cutover.organization_id = 'legacy_default_v1'
where mailbox.id = 'primary'
  and (select assignment_was_present
         from app_mailbox_legacy_organization_assignment_application) = 0
union all
select 'primary', 'legacy_default_v1', mailbox.created_at,
       'fresh-bootstrap', 1
from app_mailbox as mailbox
join app_organization as organization
  on organization.id = 'legacy_default_v1'
 and organization.created_at = mailbox.created_at
join app_organization_legacy_cutover as cutover
  on cutover.id = 1
 and cutover.schema_version = 1
 and cutover.outcome = 'fresh-empty'
 and cutover.source_mailbox_id is null
 and cutover.source_created_at is null
 and cutover.organization_id is null
where mailbox.id = 'primary'
  and (select assignment_was_present
         from app_mailbox_legacy_organization_assignment_application) = 0;

delete from app_mailbox_legacy_organization_assignment_preflight;

insert into app_mailbox_legacy_organization_assignment_preflight (valid)
select case when
  (select count(*)
     from app_mailbox_legacy_organization_assignment_cutover) = 1
  and exists (
    select 1 from app_mailbox_legacy_organization_assignment_cutover
    where id = 1 and schema_version = 1
  )
  and (
    (
      not exists (select 1 from app_mailbox)
      and not exists (select 1 from app_organization)
      and not exists (select 1 from app_mailbox_legacy_organization_assignment)
      and exists (
        select 1 from app_organization_legacy_cutover
        where id = 1 and schema_version = 1 and outcome = 'fresh-empty'
          and source_mailbox_id is null and source_created_at is null
          and organization_id is null
      )
    )
    or (
      (select valid
         from app_mailbox_legacy_organization_assignment_parent_state) = 1
      and (select count(*)
             from app_mailbox_legacy_organization_assignment) = 1
      and exists (
        select 1
        from app_mailbox_legacy_organization_assignment as assignment
        join app_mailbox as mailbox on mailbox.id = assignment.mailbox_id
        join app_organization as organization
          on organization.id = assignment.organization_id
        where assignment.mailbox_id = 'primary'
          and assignment.organization_id = 'legacy_default_v1'
          and assignment.effective_at = mailbox.created_at
          and assignment.effective_at = organization.created_at
          and assignment.schema_version = 1
          and (
            (assignment.source = 'legacy-cutover' and exists (
              select 1 from app_organization_legacy_cutover
              where id = 1 and schema_version = 1
                and outcome = 'legacy-primary'
                and source_mailbox_id = 'primary'
                and source_created_at = assignment.effective_at
                and organization_id = 'legacy_default_v1'
            ))
            or (assignment.source = 'fresh-bootstrap' and exists (
              select 1 from app_organization_legacy_cutover
              where id = 1 and schema_version = 1
                and outcome = 'fresh-empty'
                and source_mailbox_id is null and source_created_at is null
                and organization_id is null
            ))
          )
      )
    )
  )
  and not exists (select 1 from pragma_foreign_key_check)
then 1 else 0 end;

drop table app_mailbox_legacy_organization_assignment_preflight;
drop table app_mailbox_legacy_organization_assignment_application;
drop view app_mailbox_legacy_organization_assignment_parent_state;

create trigger app_mailbox_legacy_organization_assignment_binding
before insert on app_mailbox_legacy_organization_assignment
when new.mailbox_id is not 'primary'
  or new.organization_id is not 'legacy_default_v1'
  or new.source is not 'fresh-bootstrap'
  or new.schema_version is not 1
  or typeof(new.effective_at) <> 'integer'
  or new.effective_at not between 0 and 9007199254740991
  or not exists (
    select 1
    from app_mailbox_legacy_organization_assignment_cutover
    where id = 1 and schema_version = 1
  )
  or not exists (
    select 1 from app_organization_legacy_cutover
    where id = 1 and schema_version = 1 and outcome = 'fresh-empty'
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
      and typeof(mailbox.id) = 'text'
      and typeof(mailbox.display_name) = 'text'
      and length(mailbox.display_name) between 1 and 200
      and typeof(mailbox.created_by_user_id) = 'text'
      and length(mailbox.created_by_user_id) between 1 and 128
      and typeof(mailbox.created_at) = 'integer'
      and mailbox.created_at between 0 and 9007199254740991
      and mailbox.created_at = new.effective_at
      and mailbox.status = 'active'
      and mailbox.version = 1
      and mailbox.updated_at = mailbox.created_at
      and mailbox.deleted_at is null
      and typeof(organization.id) = 'text'
      and typeof(organization.created_at) = 'integer'
      and organization.created_at between 0 and 9007199254740991
      and organization.status = 'active'
      and organization.version = 1
      and organization.updated_at = organization.created_at
  )
begin
  select raise(abort, 'invalid fresh mailbox legacy organization ancestry');
end;

create trigger app_mailbox_legacy_organization_assignment_no_replace
before insert on app_mailbox_legacy_organization_assignment
when exists (
  select 1 from app_mailbox_legacy_organization_assignment
  where mailbox_id = new.mailbox_id
)
begin
  select raise(abort, 'legacy organization ancestry is immutable');
end;

create trigger app_mailbox_legacy_organization_assignment_no_update
before update on app_mailbox_legacy_organization_assignment
begin
  select raise(abort, 'legacy organization ancestry is immutable');
end;

create trigger app_mailbox_legacy_organization_assignment_no_delete
before delete on app_mailbox_legacy_organization_assignment
begin
  select raise(abort, 'legacy organization ancestry is retained');
end;

create trigger app_mailbox_legacy_organization_assignment_cutover_no_insert
before insert on app_mailbox_legacy_organization_assignment_cutover
begin
  select raise(abort, 'legacy organization ancestry cutover is sealed');
end;

create trigger app_mailbox_legacy_organization_assignment_cutover_no_update
before update on app_mailbox_legacy_organization_assignment_cutover
begin
  select raise(abort, 'legacy organization ancestry cutover is immutable');
end;

create trigger app_mailbox_legacy_organization_assignment_cutover_no_delete
before delete on app_mailbox_legacy_organization_assignment_cutover
begin
  select raise(abort, 'legacy organization ancestry cutover is retained');
end;

-- Temporary rolling bridge. ORG-010 atomically replaces this trigger when the
-- canonical mailbox organization column becomes the ancestry source of truth.
create trigger app_mailbox_legacy_organization_assignment_from_fresh_mailbox
after insert on app_mailbox
when exists (
  select 1 from app_organization_legacy_cutover
  where id = 1 and schema_version = 1 and outcome = 'fresh-empty'
    and source_mailbox_id is null and source_created_at is null
    and organization_id is null
)
begin
  insert into app_mailbox_legacy_organization_assignment (
    mailbox_id, organization_id, effective_at, source, schema_version
  ) values (
    new.id, 'legacy_default_v1', new.created_at, 'fresh-bootstrap', 1
  );
  select case when (
    select count(*)
    from app_mailbox_legacy_organization_assignment as assignment
    join app_mailbox as mailbox on mailbox.id = assignment.mailbox_id
    join app_organization as organization
      on organization.id = assignment.organization_id
    where assignment.mailbox_id = 'primary'
      and assignment.organization_id = 'legacy_default_v1'
      and assignment.effective_at = new.created_at
      and assignment.effective_at = mailbox.created_at
      and assignment.effective_at = organization.created_at
      and assignment.source = 'fresh-bootstrap'
      and assignment.schema_version = 1
  ) <> 1 then raise(abort, 'fresh mailbox ancestry materialization failed') end;
end;
