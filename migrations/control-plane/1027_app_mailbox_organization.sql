-- ORG-010 is intentionally forward-only. The migration ledger applies this
-- additive column transition once; manual reapplication fails in entry
-- preflight before any persistent schema or data mutation.
create temp table app_mailbox_organization_entry_preflight (
  valid integer not null check (valid = 1)
);

insert into app_mailbox_organization_entry_preflight (valid)
select case when
  not exists (select 1 from pragma_table_xinfo('app_mailbox')
    where name = 'organization_id')
  and (select count(*) from pragma_table_xinfo('app_mailbox')) = 8
  and (select sql from sqlite_master where type = 'table'
    and name = 'app_mailbox') = 'CREATE TABLE app_mailbox (
  id text primary key
    check (length(id) between 1 and 128),
  display_name text not null
    check (length(display_name) between 1 and 200),
  status text not null default ''active''
    check (status in (''active'', ''suspended'', ''deleting'', ''deleted'')),
  created_by_user_id text not null
    check (length(created_by_user_id) between 1 and 128),
  created_at integer not null
    check (created_at >= 0),
  updated_at integer not null
    check (updated_at >= created_at),
  deleted_at integer
    check (deleted_at is null or deleted_at >= created_at),
  version integer not null default 1
    check (version >= 1),
  constraint app_mailbox_deleted_state
    check (
      (status = ''deleted'' and deleted_at is not null)
      or (status <> ''deleted'' and deleted_at is null)
    )
)'
  and (select sql from sqlite_master where type = 'index'
    and name = 'app_mailbox_active_idx') = 'CREATE INDEX app_mailbox_active_idx
  on app_mailbox (status, id)
  where deleted_at is null'
  and (select sql from sqlite_master where type = 'index'
    and name = 'app_mailbox_creator_idx') = 'CREATE INDEX app_mailbox_creator_idx
  on app_mailbox (created_by_user_id, created_at)'
  and (select sql from sqlite_master where type = 'index'
    and name = 'app_mailbox_singleton_idx') = 'CREATE UNIQUE INDEX app_mailbox_singleton_idx
  on app_mailbox ((1))'
  and (select sql from sqlite_master where type = 'table'
    and name = 'app_organization') = 'CREATE TABLE app_organization (
  id text not null,
  status text not null default ''active'',
  created_at integer not null,
  updated_at integer not null,
  version integer not null default 1,
  constraint app_organization_pkey primary key (id),
  constraint app_organization_id_check
    check (
      typeof(id) = ''text''
      and length(id) between 1 and 128
      and length(cast(id as blob)) = length(id)
      and id not glob ''*[^A-Za-z0-9_-]*''
    ),
  constraint app_organization_status_check
    check (status in (''active'', ''suspended'')),
  constraint app_organization_created_at_check
    check (
      typeof(created_at) = ''integer''
      and created_at between 0 and 9007199254740991
    ),
  constraint app_organization_updated_at_check
    check (
      typeof(updated_at) = ''integer''
      and updated_at between created_at and 9007199254740991
    ),
  constraint app_organization_version_check
    check (
      typeof(version) = ''integer''
      and version between 1 and 9007199254740991
    )
)'
  and (select sql from sqlite_master where type = 'index'
    and name = 'app_organization_status_idx')
    = 'CREATE INDEX app_organization_status_idx
  on app_organization (status, id)'
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
  and (select sql from sqlite_master where type = 'table'
    and name = 'app_mailbox_legacy_organization_assignment') = 'CREATE TABLE app_mailbox_legacy_organization_assignment (
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
  and (select count(*) from app_mailbox_legacy_organization_assignment_cutover) = 1
  and exists (select 1 from app_mailbox_legacy_organization_assignment_cutover
    where id = 1 and schema_version = 1)
  and (select sql from sqlite_master where type = 'trigger'
    and name = 'app_mailbox_legacy_organization_assignment_from_fresh_mailbox'
    and tbl_name = 'app_mailbox') = 'CREATE TRIGGER app_mailbox_legacy_organization_assignment_from_fresh_mailbox
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
  and (select sql from sqlite_master where type = 'trigger'
    and name = 'app_mailbox_legacy_organization_assignment_no_update')
    = 'CREATE TRIGGER app_mailbox_legacy_organization_assignment_no_update
before update on app_mailbox_legacy_organization_assignment
begin
  select raise(abort, ''legacy organization ancestry is immutable'');
end'
  and (select sql from sqlite_master where type = 'trigger'
    and name = 'app_mailbox_legacy_organization_assignment_no_delete')
    = 'CREATE TRIGGER app_mailbox_legacy_organization_assignment_no_delete
before delete on app_mailbox_legacy_organization_assignment
begin
  select raise(abort, ''legacy organization ancestry is retained'');
end'
  and (select sql from sqlite_master where type = 'trigger'
    and name = 'app_mailbox_legacy_organization_assignment_no_replace')
    = 'CREATE TRIGGER app_mailbox_legacy_organization_assignment_no_replace
before insert on app_mailbox_legacy_organization_assignment
when exists (
  select 1 from app_mailbox_legacy_organization_assignment
  where mailbox_id = new.mailbox_id
)
begin
  select raise(abort, ''legacy organization ancestry is immutable'');
end'
  and (select sql from sqlite_master where type = 'trigger'
    and name = 'app_mailbox_legacy_organization_assignment_binding')
    = 'CREATE TRIGGER app_mailbox_legacy_organization_assignment_binding
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
end'
  and (select sql from sqlite_master where type = 'trigger'
    and name = 'app_mailbox_legacy_organization_assignment_cutover_no_insert')
    = 'CREATE TRIGGER app_mailbox_legacy_organization_assignment_cutover_no_insert
before insert on app_mailbox_legacy_organization_assignment_cutover
begin
  select raise(abort, ''legacy organization ancestry cutover is sealed'');
end'
  and (select sql from sqlite_master where type = 'trigger'
    and name = 'app_mailbox_legacy_organization_assignment_cutover_no_update')
    = 'CREATE TRIGGER app_mailbox_legacy_organization_assignment_cutover_no_update
before update on app_mailbox_legacy_organization_assignment_cutover
begin
  select raise(abort, ''legacy organization ancestry cutover is immutable'');
end'
  and (select sql from sqlite_master where type = 'trigger'
    and name = 'app_mailbox_legacy_organization_assignment_cutover_no_delete')
    = 'CREATE TRIGGER app_mailbox_legacy_organization_assignment_cutover_no_delete
before delete on app_mailbox_legacy_organization_assignment_cutover
begin
  select raise(abort, ''legacy organization ancestry cutover is retained'');
end'
  and (select sql from sqlite_master where type = 'trigger'
    and name = 'app_organization_identity_immutable')
    = 'CREATE TRIGGER app_organization_identity_immutable
before update of id, created_at on app_organization
when old.id is not new.id or old.created_at is not new.created_at
begin
  select raise(abort, ''organization identity and creation time are immutable'');
end'
  and (select sql from sqlite_master where type = 'trigger'
    and name = 'app_organization_insert_contract')
    = 'CREATE TRIGGER app_organization_insert_contract
before insert on app_organization
when new.status is not ''active''
  or new.version is not 1
  or new.created_at is not new.updated_at
begin
  select raise(abort, ''organization must start active at version 1'');
end'
  and (select sql from sqlite_master where type = 'trigger'
    and name = 'app_organization_no_delete')
    = 'CREATE TRIGGER app_organization_no_delete
before delete on app_organization
begin
  select raise(abort, ''organizations are retained'');
end'
  and (select sql from sqlite_master where type = 'trigger'
    and name = 'app_organization_update_lifecycle')
    = 'CREATE TRIGGER app_organization_update_lifecycle
before update on app_organization
when old.status is not new.status
  or old.updated_at is not new.updated_at
  or old.version is not new.version
begin
  select case when new.version <> old.version + 1
    or new.updated_at < old.updated_at
    then raise(abort, ''invalid organization lifecycle update'') end;
end'
  and (select sql from sqlite_master where type = 'trigger'
    and name = 'app_organization_no_replace')
    = 'CREATE TRIGGER app_organization_no_replace
before insert on app_organization
when exists (
  select 1 from app_organization where id = new.id
)
begin
  select raise(abort, ''organization identifiers are immutable and never reused'');
end'
  and (select count(*) from sqlite_master where type = 'trigger'
    and tbl_name = 'app_mailbox_legacy_organization_assignment') = 4
  and (select count(*) from sqlite_master where type = 'trigger'
    and tbl_name = 'app_mailbox_legacy_organization_assignment_cutover') = 3
  and (select count(*) from sqlite_master where type = 'trigger'
    and tbl_name = 'app_organization_legacy_cutover') = 3
  and (select sql from sqlite_master where type = 'trigger'
    and name = 'app_organization_legacy_cutover_no_insert')
    = 'CREATE TRIGGER app_organization_legacy_cutover_no_insert
before insert on app_organization_legacy_cutover
begin
  select raise(abort, ''organization legacy cutover is sealed'');
end'
  and (select sql from sqlite_master where type = 'trigger'
    and name = 'app_organization_legacy_cutover_no_update')
    = 'CREATE TRIGGER app_organization_legacy_cutover_no_update
before update on app_organization_legacy_cutover
begin
  select raise(abort, ''organization legacy cutover is immutable'');
end'
  and (select sql from sqlite_master where type = 'trigger'
    and name = 'app_organization_legacy_cutover_no_delete')
    = 'CREATE TRIGGER app_organization_legacy_cutover_no_delete
before delete on app_organization_legacy_cutover
begin
  select raise(abort, ''organization legacy cutover is retained'');
end'
  and (select count(*) from sqlite_master where type = 'trigger'
    and tbl_name = 'app_mailbox' and name in (
      'app_organization_fresh_mailbox_insert_guard',
      'app_organization_mailbox_creation_provenance',
      'app_organization_primary_mailbox_no_replace',
      'app_organization_primary_mailbox_no_delete'
    )) = 4
  and (select sql from sqlite_master where type = 'trigger'
    and name = 'app_organization_fresh_mailbox_insert_guard')
    = 'CREATE TRIGGER app_organization_fresh_mailbox_insert_guard
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
  and (select sql from sqlite_master where type = 'trigger'
    and name = 'app_organization_mailbox_creation_provenance')
    = 'CREATE TRIGGER app_organization_mailbox_creation_provenance
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
  and (select sql from sqlite_master where type = 'trigger'
    and name = 'app_organization_primary_mailbox_no_replace')
    = 'CREATE TRIGGER app_organization_primary_mailbox_no_replace
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
  and (select sql from sqlite_master where type = 'trigger'
    and name = 'app_organization_primary_mailbox_no_delete')
    = 'CREATE TRIGGER app_organization_primary_mailbox_no_delete
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
  and (select trigger_sql_json from app_mail_domain_claim_trigger_manifest
    where id = 1 and schema_version = 1) = (select json_group_array(sql) from (
      select sql from sqlite_master where type = 'trigger'
      and name in (
        'app_mail_domain_claim_receipt_binding',
        'app_mail_domain_claim_receipt_no_replace',
        'app_mail_domain_claim_receipt_no_update',
        'app_mail_domain_claim_receipt_no_delete',
        'app_mail_domain_claim_cutover_no_insert',
        'app_mail_domain_claim_cutover_no_update',
        'app_mail_domain_claim_cutover_no_delete',
        'app_mail_domain_claim_from_bootstrap_audit',
        'app_mailbox_bootstrap_domain_intent_binding',
        'app_mailbox_bootstrap_domain_intent_no_replace',
        'app_mailbox_bootstrap_domain_intent_no_update',
        'app_mailbox_bootstrap_domain_intent_no_delete',
        'app_mail_domain_reserved_claim_lifecycle_frozen'
      ) order by name))
  and not exists (select 1 from sqlite_master where name in (
    'app_mailbox_organization_status_idx',
    'app_mailbox_organization_insert_contract',
    'app_mailbox_organization_materialize_fresh',
    'app_mailbox_organization_immutable',
    'app_mailbox_identity_immutable',
    'app_mailbox_no_replace',
    'app_mailbox_no_delete',
    'app_mailbox_organization_successor_fence',
    'app_mailbox_organization_consistent_after_update'))
  and not exists (select 1 from sqlite_master
    where name glob 'app_mailbox_organization_*')
  and not exists (select 1 from sqlite_master
    where name glob 'app_organization_mailbox_*_v2')
  and not exists (select 1 from pragma_foreign_key_check)
  and (
    (not exists (select 1 from app_mailbox)
      and not exists (select 1
        from app_mailbox_legacy_organization_assignment))
    or (
      (select count(*) from app_mailbox)
        = (select count(*)
          from app_mailbox_legacy_organization_assignment)
      and not exists (
        select 1 from app_mailbox mailbox
        left join app_mailbox_legacy_organization_assignment ancestry
          on ancestry.mailbox_id = mailbox.id
        left join app_organization organization
          on organization.id = ancestry.organization_id
        where ancestry.mailbox_id is null
          or typeof(ancestry.organization_id) <> 'text'
          or ancestry.effective_at is not mailbox.created_at
          or ancestry.effective_at is not organization.created_at
          or ancestry.schema_version is not 1
          or not (
            (ancestry.source = 'legacy-cutover' and exists (
              select 1 from app_organization_legacy_cutover cutover
              where cutover.id = 1 and cutover.schema_version = 1
                and cutover.outcome = 'legacy-primary'
                and cutover.source_mailbox_id = ancestry.mailbox_id
                and cutover.source_created_at = ancestry.effective_at
                and cutover.organization_id = ancestry.organization_id
            ))
            or (ancestry.source = 'fresh-bootstrap' and exists (
              select 1 from app_organization_legacy_cutover cutover
              where cutover.id = 1 and cutover.schema_version = 1
                and cutover.outcome = 'fresh-empty'
                and cutover.source_mailbox_id is null
                and cutover.source_created_at is null
                and cutover.organization_id is null
            ))
          )
      )
      and not exists (
        select 1 from app_mailbox_legacy_organization_assignment ancestry
        left join app_mailbox mailbox on mailbox.id = ancestry.mailbox_id
        where mailbox.id is null
      )
    )
  )
then 1 else 0 end;

drop table app_mailbox_organization_entry_preflight;

alter table app_mailbox add column organization_id text
  references app_organization(id) on update restrict on delete restrict;

-- The retained ORG-007 bridge is the sole backfill write source.
update app_mailbox
set organization_id = (
  select ancestry.organization_id
  from app_mailbox_legacy_organization_assignment ancestry
  where ancestry.mailbox_id = app_mailbox.id
);

create index app_mailbox_organization_status_idx
  on app_mailbox (organization_id, status, id)
  where deleted_at is null;

drop trigger app_mailbox_legacy_organization_assignment_from_fresh_mailbox;

create trigger app_mailbox_organization_insert_contract
before insert on app_mailbox
when new.organization_id is not null and (
  typeof(new.organization_id) <> 'text'
  or length(new.organization_id) = 0
  or new.organization_id is not 'legacy_default_v1'
  or not exists (select 1 from app_organization organization
    where organization.id = new.organization_id)
)
begin
  select raise(abort, 'invalid mailbox organization ancestry');
end;

-- One AFTER INSERT body owns both the retained bridge and canonical column.
-- This avoids relying on SQLite trigger creation or execution order.
create trigger app_mailbox_organization_materialize_fresh
after insert on app_mailbox
begin
  insert into app_mailbox_legacy_organization_assignment (
    mailbox_id, organization_id, effective_at, source, schema_version
  )
  select new.id, 'legacy_default_v1', new.created_at, 'fresh-bootstrap', 1
  where exists (
    select 1 from app_organization_legacy_cutover
    where id = 1 and schema_version = 1 and outcome = 'fresh-empty'
      and source_mailbox_id is null and source_created_at is null
      and organization_id is null
  );

  update app_mailbox
  set organization_id = (
    select ancestry.organization_id
    from app_mailbox_legacy_organization_assignment ancestry
    where ancestry.mailbox_id = new.id
  )
  where rowid = new.rowid and organization_id is null;

  select case when (
    select count(*)
    from app_mailbox mailbox
    join app_mailbox_legacy_organization_assignment ancestry
      on ancestry.mailbox_id = mailbox.id
     and ancestry.organization_id = mailbox.organization_id
    join app_organization organization
      on organization.id = mailbox.organization_id
    where mailbox.rowid = new.rowid
      and typeof(mailbox.organization_id) = 'text'
      and length(mailbox.organization_id) > 0
      and ancestry.effective_at = mailbox.created_at
      and ancestry.effective_at = organization.created_at
      and ancestry.source = 'fresh-bootstrap'
      and ancestry.schema_version = 1
  ) <> 1 then raise(abort, 'mailbox organization materialization failed') end;
end;

create trigger app_mailbox_organization_immutable
before update of organization_id on app_mailbox
when not (
  old.organization_id is null
  and old.rowid = last_insert_rowid()
  and typeof(new.organization_id) = 'text'
  and exists (
    select 1
    from app_mailbox_legacy_organization_assignment ancestry
    join app_organization organization
      on organization.id = ancestry.organization_id
    where ancestry.mailbox_id = old.id
      and ancestry.organization_id = new.organization_id
      and ancestry.effective_at = old.created_at
      and ancestry.effective_at = organization.created_at
      and ancestry.source = 'fresh-bootstrap'
      and ancestry.schema_version = 1
      and old.status = 'active' and old.version = 1
      and old.updated_at = old.created_at and old.deleted_at is null
  )
)
begin
  select raise(abort, 'mailbox organization ancestry is immutable');
end;

create trigger app_mailbox_identity_immutable
before update of id, created_at on app_mailbox
when old.id is not new.id or old.created_at is not new.created_at
begin
  select raise(abort, 'mailbox identity and creation time are immutable');
end;

create trigger app_mailbox_no_replace
before insert on app_mailbox
when exists (select 1 from app_mailbox where id = new.id)
begin
  select raise(abort, 'mailbox identifiers are immutable and never reused');
end;

create trigger app_mailbox_no_delete
before delete on app_mailbox
begin
  select raise(abort, 'mailboxes are retained');
end;

-- This additive successor artifact is deliberately on the ORG-006 cutover
-- table. A manual 1023 reapply leaves it behind after tentative known-trigger
-- drops, fails 1023 preflight, and rolls the whole migration transaction back.
create trigger app_mailbox_organization_successor_fence
before insert on app_organization_legacy_cutover
begin
  select raise(abort, 'mailbox organization generation is active');
end;

create trigger app_mailbox_organization_consistent_after_update
after update on app_mailbox
when new.organization_id is null or not exists (
  select 1
  from app_mailbox_legacy_organization_assignment ancestry
  join app_organization organization
    on organization.id = ancestry.organization_id
  where ancestry.mailbox_id = new.id
    and ancestry.organization_id = new.organization_id
    and ancestry.effective_at = new.created_at
    and ancestry.effective_at = organization.created_at
    and ancestry.schema_version = 1
)
begin
  select raise(abort, 'mailbox organization ancestry is inconsistent');
end;

create table app_mailbox_organization_generation (
  id integer primary key,
  schema_version integer not null,
  artifact_sql_json text not null,
  column_json text not null,
  foreign_key_json text not null,
  constraint app_mailbox_organization_generation_id_check check (id = 1),
  constraint app_mailbox_organization_generation_schema_check
    check (schema_version = 1),
  constraint app_mailbox_organization_generation_json_check check (
    json_valid(artifact_sql_json) and json_type(artifact_sql_json) = 'array'
    and json_valid(column_json) and json_type(column_json) = 'array'
    and json_valid(foreign_key_json) and json_type(foreign_key_json) = 'array'
  )
);

create trigger app_mailbox_organization_generation_no_replace
before insert on app_mailbox_organization_generation
when exists (select 1 from app_mailbox_organization_generation where id = new.id)
begin
  select raise(abort, 'mailbox organization generation is sealed');
end;

create trigger app_mailbox_organization_generation_no_update
before update on app_mailbox_organization_generation
begin
  select raise(abort, 'mailbox organization generation is immutable');
end;

create trigger app_mailbox_organization_generation_no_delete
before delete on app_mailbox_organization_generation
begin
  select raise(abort, 'mailbox organization generation is retained');
end;

insert into app_mailbox_organization_generation (
  id, schema_version, artifact_sql_json, column_json, foreign_key_json
)
select 1, 1,
  (select json_group_array(json_object(
    'type', type, 'name', name, 'tbl_name', tbl_name, 'sql', sql
  )) from (
    select type, name, tbl_name, sql from sqlite_master
    where name in (
      'app_mailbox_legacy_organization_assignment',
      'app_mailbox_legacy_organization_assignment_cutover',
      'app_mailbox_legacy_organization_assignment_binding',
      'app_mailbox_legacy_organization_assignment_no_replace',
      'app_mailbox_legacy_organization_assignment_no_update',
      'app_mailbox_legacy_organization_assignment_no_delete',
      'app_mailbox_legacy_organization_assignment_cutover_no_insert',
      'app_mailbox_legacy_organization_assignment_cutover_no_update',
      'app_mailbox_legacy_organization_assignment_cutover_no_delete',
      'app_mailbox_organization_status_idx',
      'app_mailbox_organization_insert_contract',
      'app_mailbox_organization_materialize_fresh',
      'app_mailbox_organization_immutable',
      'app_mailbox_identity_immutable',
      'app_mailbox_no_replace',
      'app_mailbox_no_delete',
      'app_mailbox_organization_consistent_after_update',
      'app_mailbox_organization_successor_fence',
      'app_mailbox_organization_generation',
      'app_mailbox_organization_generation_no_replace',
      'app_mailbox_organization_generation_no_update',
      'app_mailbox_organization_generation_no_delete'
    ) order by type, name
  )),
  (select json_group_array(json_object(
    'cid', cid, 'name', name, 'type', type, 'notnull', "notnull",
    'dflt_value', dflt_value, 'pk', pk, 'hidden', hidden
  )) from (
    select * from pragma_table_xinfo('app_mailbox')
    where name = 'organization_id' order by cid
  )),
  (select json_group_array(json_object(
    'id', id, 'seq', seq, 'table', "table", 'from', "from", 'to', "to",
    'on_update', on_update, 'on_delete', on_delete, 'match', match
  )) from (
    select * from pragma_foreign_key_list('app_mailbox')
    where "from" = 'organization_id' order by id, seq
  ));

create temp table app_mailbox_organization_postflight (
  valid integer not null check (valid = 1)
);

insert into app_mailbox_organization_postflight (valid)
select case when
  (select count(*) from pragma_table_xinfo('app_mailbox')) = 9
  and exists (select 1 from pragma_table_xinfo('app_mailbox')
    where cid = 8 and name = 'organization_id' and type = 'TEXT'
      and "notnull" = 0 and dflt_value is null and pk = 0 and hidden = 0)
  and exists (select 1 from pragma_foreign_key_list('app_mailbox')
    where "table" = 'app_organization' and "from" = 'organization_id'
      and "to" = 'id' and on_update = 'RESTRICT' and on_delete = 'RESTRICT'
      and match = 'NONE')
  and not exists (select 1 from app_mailbox mailbox
    left join app_mailbox_legacy_organization_assignment ancestry
      on ancestry.mailbox_id = mailbox.id
     and ancestry.organization_id = mailbox.organization_id
    where mailbox.organization_id is null or ancestry.mailbox_id is null)
  and (select count(*) from app_mailbox_organization_generation) = 1
  and exists (select 1 from app_mailbox_organization_generation
    where id = 1 and schema_version = 1
      and json_array_length(artifact_sql_json) = 22
      and json_array_length(column_json) = 1
      and json_array_length(foreign_key_json) = 1)
  and not exists (select 1 from pragma_foreign_key_check)
then 1 else 0 end;

drop table app_mailbox_organization_postflight;
