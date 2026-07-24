create temp table app_organization_legacy_cutover_application (
  was_present integer not null check (was_present in (0, 1))
);

insert into app_organization_legacy_cutover_application (was_present)
select exists (
  select 1
  from sqlite_master
  where type = 'table'
    and name = 'app_organization_legacy_cutover'
);

drop trigger if exists app_organization_legacy_cutover_no_insert;
drop trigger if exists app_organization_legacy_cutover_no_update;
drop trigger if exists app_organization_legacy_cutover_no_delete;
drop trigger if exists app_organization_fresh_mailbox_insert_guard;
drop trigger if exists app_organization_mailbox_creation_provenance;
drop trigger if exists app_organization_primary_mailbox_no_replace;
drop trigger if exists app_organization_primary_mailbox_no_delete;

create table if not exists app_organization_legacy_cutover (
  id integer primary key,
  schema_version integer not null,
  outcome text not null,
  source_mailbox_id text,
  source_created_at integer,
  organization_id text,
  constraint app_organization_legacy_cutover_id_check
    check (id = 1),
  constraint app_organization_legacy_cutover_schema_check
    check (typeof(schema_version) = 'integer' and schema_version = 1),
  constraint app_organization_legacy_cutover_outcome_check
    check (
      (
        outcome = 'legacy-primary'
        and typeof(outcome) = 'text'
        and source_mailbox_id = 'primary'
        and typeof(source_mailbox_id) = 'text'
        and typeof(source_created_at) = 'integer'
        and source_created_at between 0 and 9007199254740991
        and organization_id = 'legacy_default_v1'
        and typeof(organization_id) = 'text'
      )
      or (
        outcome = 'fresh-empty'
        and typeof(outcome) = 'text'
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
);

create temp table app_organization_legacy_cutover_preflight (
  valid integer not null check (valid = 1)
);

insert into app_organization_legacy_cutover_preflight (valid)
select case when
  (select count(*) from pragma_table_xinfo('app_organization_legacy_cutover')) = 6
  and not exists (
    select 1
    from pragma_table_xinfo('app_organization_legacy_cutover')
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
  and not exists (
    select 1 from pragma_index_list('app_organization_legacy_cutover')
  )
  and (select count(*)
       from pragma_foreign_key_list('app_organization_legacy_cutover')) = 2
  and exists (
    select 1
    from pragma_foreign_key_list('app_organization_legacy_cutover')
    where "table" = 'app_mailbox'
      and "from" = 'source_mailbox_id'
      and "to" = 'id'
      and on_update = 'RESTRICT'
      and on_delete = 'RESTRICT'
      and match = 'NONE'
  )
  and exists (
    select 1
    from pragma_foreign_key_list('app_organization_legacy_cutover')
    where "table" = 'app_organization'
      and "from" = 'organization_id'
      and "to" = 'id'
      and on_update = 'RESTRICT'
      and on_delete = 'RESTRICT'
      and match = 'NONE'
  )
  and instr((select sql from sqlite_master
             where type = 'table'
               and name = 'app_organization_legacy_cutover'),
            'constraint app_organization_legacy_cutover_id_check') > 0
  and instr((select sql from sqlite_master
             where type = 'table'
               and name = 'app_organization_legacy_cutover'),
            'constraint app_organization_legacy_cutover_schema_check') > 0
  and instr((select sql from sqlite_master
             where type = 'table'
               and name = 'app_organization_legacy_cutover'),
            'constraint app_organization_legacy_cutover_outcome_check') > 0
  and instr((select sql from sqlite_master
             where type = 'table'
               and name = 'app_organization_legacy_cutover'),
            'check (typeof(schema_version) = ''integer'' and schema_version = 1)') > 0
  and instr((select sql from sqlite_master
             where type = 'table'
               and name = 'app_organization_legacy_cutover'),
            'outcome = ''legacy-primary''') > 0
  and instr((select sql from sqlite_master
             where type = 'table'
               and name = 'app_organization_legacy_cutover'),
            'source_created_at between 0 and 9007199254740991') > 0
  and instr((select sql from sqlite_master
             where type = 'table'
               and name = 'app_organization_legacy_cutover'),
            'organization_id = ''legacy_default_v1''') > 0
  and instr((select sql from sqlite_master
             where type = 'table'
               and name = 'app_organization_legacy_cutover'),
            'outcome = ''fresh-empty''') > 0
  and instr((select sql from sqlite_master
             where type = 'table'
               and name = 'app_organization_legacy_cutover'),
            'source_mailbox_id is null') > 0
  and instr((select sql from sqlite_master
             where type = 'table'
               and name = 'app_organization_legacy_cutover'),
            'organization_id is null') > 0
  and not exists (
    select 1
    from sqlite_master
    where type = 'trigger'
      and tbl_name = 'app_organization_legacy_cutover'
  )
  and not exists (
    select 1
    from sqlite_master
    where type = 'trigger'
      and name in (
        'app_organization_legacy_cutover_no_insert',
        'app_organization_legacy_cutover_no_update',
        'app_organization_legacy_cutover_no_delete',
        'app_organization_fresh_mailbox_insert_guard',
        'app_organization_mailbox_creation_provenance',
        'app_organization_primary_mailbox_no_replace',
        'app_organization_primary_mailbox_no_delete'
      )
  )
then 1 else 0 end;

create temp view app_organization_legacy_cutover_fresh_state as
select case when
  (
    not exists (select 1 from app_mailbox)
    and not exists (select 1 from app_organization)
  )
  or (
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
        and (
          mailbox.deleted_at is null
          or (
            typeof(mailbox.deleted_at) = 'integer'
            and mailbox.deleted_at between mailbox.created_at and 9007199254740991
          )
        )
        and typeof(mailbox.version) = 'integer'
        and mailbox.version between 1 and 9007199254740991
        and (
          (mailbox.status = 'deleted' and mailbox.deleted_at is not null)
          or (mailbox.status <> 'deleted' and mailbox.deleted_at is null)
        )
        and (
          mailbox.version > 1
          or (
            mailbox.status = 'active'
            and mailbox.updated_at = mailbox.created_at
            and mailbox.deleted_at is null
          )
        )
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
        and (
          organization.version > 1
          or (
            organization.status = 'active'
            and organization.updated_at = organization.created_at
          )
        )
    )
  )
then 1 else 0 end as valid;

insert into app_organization_legacy_cutover_preflight (valid)
select case
  when (select was_present from app_organization_legacy_cutover_application) = 0
    and not exists (select 1 from app_organization_legacy_cutover)
    and not exists (select 1 from app_organization)
    and (
      not exists (select 1 from app_mailbox)
      or (
        (select count(*) from app_mailbox) = 1
        and exists (
          select 1
          from app_mailbox
          where id = 'primary'
            and typeof(id) = 'text'
            and typeof(display_name) = 'text'
            and length(display_name) between 1 and 200
            and typeof(status) = 'text'
            and status in ('active', 'suspended', 'deleting', 'deleted')
            and typeof(created_by_user_id) = 'text'
            and length(created_by_user_id) between 1 and 128
            and typeof(created_at) = 'integer'
            and created_at between 0 and 9007199254740991
            and typeof(updated_at) = 'integer'
            and updated_at between created_at and 9007199254740991
            and (
              deleted_at is null
              or (
                typeof(deleted_at) = 'integer'
                and deleted_at between created_at and 9007199254740991
              )
            )
            and typeof(version) = 'integer'
            and version between 1 and 9007199254740991
            and (
              (status = 'deleted' and deleted_at is not null)
              or (status <> 'deleted' and deleted_at is null)
            )
        )
      )
    )
    then 1
  when (select was_present from app_organization_legacy_cutover_application) = 1
    and (select count(*) from app_organization_legacy_cutover) = 1
    and (
      exists (
        select 1
        from app_organization_legacy_cutover as cutover
        join app_mailbox as mailbox
          on mailbox.id = cutover.source_mailbox_id
         and mailbox.created_at = cutover.source_created_at
        join app_organization as organization
          on organization.id = cutover.organization_id
         and organization.created_at = cutover.source_created_at
        where cutover.id = 1
          and cutover.schema_version = 1
          and cutover.outcome = 'legacy-primary'
          and cutover.source_mailbox_id = 'primary'
          and typeof(cutover.source_created_at) = 'integer'
          and cutover.source_created_at between 0 and 9007199254740991
          and cutover.organization_id = 'legacy_default_v1'
      )
      or (
        exists (
          select 1
          from app_organization_legacy_cutover
          where id = 1
            and schema_version = 1
            and outcome = 'fresh-empty'
            and source_mailbox_id is null
            and source_created_at is null
            and organization_id is null
        )
        and (select valid
             from app_organization_legacy_cutover_fresh_state) = 1
      )
    )
    then 1
  else 0
end;

insert into app_organization (id, status, created_at, updated_at, version)
select 'legacy_default_v1', 'active', mailbox.created_at, mailbox.created_at, 1
from app_mailbox as mailbox
where mailbox.id = 'primary'
  and not exists (select 1 from app_organization_legacy_cutover);

insert into app_organization_legacy_cutover (
  id, schema_version, outcome, source_mailbox_id, source_created_at,
  organization_id
)
select 1, 1, 'legacy-primary', 'primary', mailbox.created_at,
       'legacy_default_v1'
from app_mailbox as mailbox
where mailbox.id = 'primary'
  and not exists (select 1 from app_organization_legacy_cutover)
union all
select 1, 1, 'fresh-empty', null, null, null
where not exists (select 1 from app_mailbox)
  and not exists (select 1 from app_organization_legacy_cutover);

delete from app_organization_legacy_cutover_preflight;

insert into app_organization_legacy_cutover_preflight (valid)
select case when (select count(*) from app_organization_legacy_cutover) = 1
  and (
    exists (
      select 1
      from app_organization_legacy_cutover as cutover
      join app_mailbox as mailbox
        on mailbox.id = cutover.source_mailbox_id
       and mailbox.created_at = cutover.source_created_at
      join app_organization as organization
        on organization.id = cutover.organization_id
       and organization.created_at = cutover.source_created_at
      where cutover.id = 1
        and cutover.schema_version = 1
        and cutover.outcome = 'legacy-primary'
        and cutover.source_mailbox_id = 'primary'
        and cutover.organization_id = 'legacy_default_v1'
    )
    or (
      exists (
        select 1
        from app_organization_legacy_cutover
        where id = 1
          and schema_version = 1
          and outcome = 'fresh-empty'
          and source_mailbox_id is null
          and source_created_at is null
          and organization_id is null
      )
      and (select valid
           from app_organization_legacy_cutover_fresh_state) = 1
    )
  ) then 1 else 0 end;

drop table app_organization_legacy_cutover_preflight;
drop table app_organization_legacy_cutover_application;
drop view app_organization_legacy_cutover_fresh_state;

create trigger app_organization_legacy_cutover_no_insert
before insert on app_organization_legacy_cutover
begin
  select raise(abort, 'organization legacy cutover is sealed');
end;

create trigger app_organization_legacy_cutover_no_update
before update on app_organization_legacy_cutover
begin
  select raise(abort, 'organization legacy cutover is immutable');
end;

create trigger app_organization_legacy_cutover_no_delete
before delete on app_organization_legacy_cutover
begin
  select raise(abort, 'organization legacy cutover is retained');
end;

create trigger app_organization_fresh_mailbox_insert_guard
before insert on app_mailbox
when exists (
  select 1
  from app_organization_legacy_cutover
  where id = 1
    and schema_version = 1
    and outcome = 'fresh-empty'
    and source_mailbox_id is null
    and source_created_at is null
    and organization_id is null
)
and (
  new.id is not 'primary'
  or new.status is not 'active'
  or new.version is not 1
  or new.created_at is not new.updated_at
  or new.deleted_at is not null
  or typeof(new.created_at) <> 'integer'
  or new.created_at not between 0 and 9007199254740991
  or not exists (
    select 1
    from app_organization
    where id = 'legacy_default_v1'
      and status = 'active'
      and version = 1
      and created_at = new.created_at
      and updated_at = new.created_at
  )
)
begin
  select raise(abort, 'fresh mailbox requires its reserved legacy organization');
end;

create trigger app_organization_mailbox_creation_provenance
before update of id, created_at on app_mailbox
when old.id = 'primary'
and (old.id is not new.id or old.created_at is not new.created_at)
and (
  exists (
    select 1
    from app_organization_legacy_cutover
    where id = 1
      and schema_version = 1
      and outcome = 'legacy-primary'
      and source_mailbox_id = 'primary'
      and typeof(source_created_at) = 'integer'
      and organization_id = 'legacy_default_v1'
  )
  or exists (
    select 1
    from app_organization_legacy_cutover as cutover
    join app_organization as organization
      on organization.id = 'legacy_default_v1'
     and organization.created_at = old.created_at
    where cutover.id = 1
      and cutover.schema_version = 1
      and cutover.outcome = 'fresh-empty'
      and cutover.source_mailbox_id is null
      and cutover.source_created_at is null
      and cutover.organization_id is null
  )
)
begin
  select raise(abort, 'organization mailbox creation provenance is immutable');
end;

create trigger app_organization_primary_mailbox_no_replace
before insert on app_mailbox
when new.id = 'primary'
and exists (
  select 1 from app_mailbox where id = 'primary'
)
and (
  exists (
    select 1
    from app_organization_legacy_cutover
    where id = 1
      and schema_version = 1
      and outcome = 'legacy-primary'
      and source_mailbox_id = 'primary'
      and typeof(source_created_at) = 'integer'
      and organization_id = 'legacy_default_v1'
  )
  or exists (
    select 1
    from app_organization_legacy_cutover as cutover
    join app_mailbox as mailbox
      on mailbox.id = 'primary'
    join app_organization as organization
      on organization.id = 'legacy_default_v1'
     and organization.created_at = mailbox.created_at
    where cutover.id = 1
      and cutover.schema_version = 1
      and cutover.outcome = 'fresh-empty'
      and cutover.source_mailbox_id is null
      and cutover.source_created_at is null
      and cutover.organization_id is null
  )
)
begin
  select raise(abort, 'organization primary mailbox replacement is forbidden');
end;

create trigger app_organization_primary_mailbox_no_delete
before delete on app_mailbox
when old.id = 'primary'
and (
  exists (
    select 1
    from app_organization_legacy_cutover
    where id = 1
      and schema_version = 1
      and outcome = 'legacy-primary'
      and source_mailbox_id = 'primary'
      and typeof(source_created_at) = 'integer'
      and organization_id = 'legacy_default_v1'
  )
  or exists (
    select 1
    from app_organization_legacy_cutover as cutover
    join app_organization as organization
      on organization.id = 'legacy_default_v1'
     and organization.created_at = old.created_at
    where cutover.id = 1
      and cutover.schema_version = 1
      and cutover.outcome = 'fresh-empty'
      and cutover.source_mailbox_id is null
      and cutover.source_created_at is null
      and cutover.organization_id is null
  )
)
begin
  select raise(abort, 'organization primary mailbox is retained');
end;
