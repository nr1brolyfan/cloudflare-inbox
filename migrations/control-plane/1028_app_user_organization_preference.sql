-- ORG-011 is a forward-only additive cutover. The migration ledger applies it
-- once; manual reapplication fails before persistent schema or data mutation.
create temp table app_user_organization_preference_entry_preflight (
  valid integer not null check (valid = 1)
);

insert into app_user_organization_preference_entry_preflight (valid)
select case when
  not exists (select 1 from sqlite_master where name in (
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
  ))
  and not exists (select 1 from sqlite_master
    where name glob 'app_user_organization_preference*')
  and not exists (select 1 from sqlite_master
    where name glob 'app_user_preference_frozen_*')
  and (select sql from sqlite_master where type = 'table'
    and name = 'app_user_preference') = 'CREATE TABLE app_user_preference (
  user_id text primary key
    check (length(user_id) between 1 and 128),
  default_mailbox_id text
    references app_mailbox (id) on delete set null,
  settings_json text not null default ''{}''
    check (
      length(settings_json) <= 65536
      and json_valid(settings_json)
      and json_type(settings_json) = ''object''
    ),
  created_at integer not null
    check (created_at >= 0),
  updated_at integer not null
    check (updated_at >= created_at),
  version integer not null default 1
    check (version >= 1)
)'
  and (select count(*) from app_mailbox_organization_generation) = 1
  and exists (select 1 from app_mailbox_organization_generation
    where id = 1 and schema_version = 1
      and artifact_sql_json = (select json_group_array(json_object(
        'type', type, 'name', name, 'tbl_name', tbl_name, 'sql', sql
      )) from (
        select type, name, tbl_name, sql from sqlite_master where name in (
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
      ))
      and column_json = (select json_group_array(json_object(
        'cid', cid, 'name', name, 'type', type, 'notnull', "notnull",
        'dflt_value', dflt_value, 'pk', pk, 'hidden', hidden
      )) from (select * from pragma_table_xinfo('app_mailbox')
        where name = 'organization_id' order by cid))
      and foreign_key_json = (select json_group_array(json_object(
        'id', id, 'seq', seq, 'table', "table", 'from', "from", 'to', "to",
        'on_update', on_update, 'on_delete', on_delete, 'match', match
      )) from (select * from pragma_foreign_key_list('app_mailbox')
        where "from" = 'organization_id' order by id, seq)))
  and exists (select 1 from pragma_table_xinfo('app_mailbox')
    where name = 'organization_id' and type = 'TEXT' and "notnull" = 0
      and dflt_value is null and pk = 0 and hidden = 0)
  and (select sql from sqlite_master where type = 'index'
    and name = 'app_mailbox_singleton_idx') = 'CREATE UNIQUE INDEX app_mailbox_singleton_idx
  on app_mailbox ((1))'
  and (select count(*) from app_organization_legacy_cutover) = 1
  and (
    exists (
      select 1
      from app_organization_legacy_cutover cutover
      join app_mailbox mailbox
        on mailbox.id = cutover.source_mailbox_id
       and mailbox.organization_id = cutover.organization_id
       and mailbox.created_at = cutover.source_created_at
      join app_organization organization
        on organization.id = cutover.organization_id
       and organization.created_at = cutover.source_created_at
      join app_mailbox_legacy_organization_assignment ancestry
        on ancestry.mailbox_id = cutover.source_mailbox_id
       and ancestry.organization_id = cutover.organization_id
       and ancestry.effective_at = cutover.source_created_at
      where cutover.id = 1 and cutover.schema_version = 1
        and cutover.outcome = 'legacy-primary'
        and cutover.source_mailbox_id = 'primary'
        and cutover.organization_id = 'legacy_default_v1'
        and typeof(cutover.source_created_at) = 'integer'
        and cutover.source_created_at between 0 and 9007199254740991
        and ancestry.source = 'legacy-cutover'
        and ancestry.schema_version = 1
    )
    or exists (
      select 1 from app_organization_legacy_cutover
      where id = 1 and schema_version = 1 and outcome = 'fresh-empty'
        and source_mailbox_id is null and source_created_at is null
        and organization_id is null
    )
  )
  and not exists (
    select 1 from app_mailbox mailbox
    left join app_mailbox_legacy_organization_assignment ancestry
      on ancestry.mailbox_id = mailbox.id
      and ancestry.organization_id = mailbox.organization_id
    left join app_organization organization
      on organization.id = mailbox.organization_id
    where mailbox.organization_id is null or ancestry.mailbox_id is null
      or ancestry.effective_at is not mailbox.created_at
      or ancestry.effective_at is not organization.created_at
      or ancestry.schema_version is not 1
  )
  and not exists (
    select 1 from app_user_preference preference
    left join auth_user user on user.id = preference.user_id
    where user.id is null
      or typeof(preference.user_id) <> 'text'
      or length(preference.user_id) not between 1 and 128
      or typeof(preference.settings_json) <> 'text'
      or length(preference.settings_json) > 65536
      or not json_valid(preference.settings_json)
      or json_type(preference.settings_json) <> 'object'
      or typeof(preference.created_at) <> 'integer'
      or preference.created_at not between 0 and 9007199254740991
      or typeof(preference.updated_at) <> 'integer'
      or preference.updated_at not between preference.created_at
        and 9007199254740991
      or typeof(preference.version) <> 'integer'
      or preference.version not between 1 and 9007199254740991
  )
  and not exists (
    select 1 from app_user_preference preference
    join app_organization_legacy_cutover cutover on cutover.id = 1
    where cutover.outcome = 'fresh-empty'
  )
  and not exists (
    select 1 from app_user_preference preference
    join app_organization_legacy_cutover cutover on cutover.id = 1
    where preference.default_mailbox_id is not null and not exists (
      select 1 from app_mailbox mailbox
      join app_mailbox_legacy_organization_assignment ancestry
        on ancestry.mailbox_id = mailbox.id
        and ancestry.organization_id = mailbox.organization_id
      where mailbox.id = preference.default_mailbox_id
        and mailbox.organization_id = cutover.organization_id
        and ancestry.effective_at = mailbox.created_at
        and ancestry.schema_version = 1
    )
  )
  and not exists (select 1 from pragma_foreign_key_check)
then 1 else 0 end;

drop table app_user_organization_preference_entry_preflight;

create unique index app_mailbox_organization_id_unique_idx
  on app_mailbox (organization_id, id);

create table app_user_organization_preference (
  organization_id text not null,
  user_id text not null,
  default_mailbox_id text,
  settings_json text not null default '{}',
  created_at integer not null,
  updated_at integer not null,
  version integer not null default 1,
  constraint app_user_organization_preference_pkey
    primary key (organization_id, user_id),
  constraint app_user_organization_preference_organization_fk
    foreign key (organization_id) references app_organization (id)
      on update restrict on delete restrict,
  constraint app_user_organization_preference_user_fk
    foreign key (user_id) references auth_user (id)
      on update restrict on delete restrict,
  constraint app_user_organization_preference_default_mailbox_fk
    foreign key (organization_id, default_mailbox_id)
      references app_mailbox (organization_id, id)
      on update restrict on delete restrict,
  constraint app_user_organization_preference_organization_check check (
    typeof(organization_id) = 'text' and length(organization_id) between 1 and 128
  ),
  constraint app_user_organization_preference_user_check check (
    typeof(user_id) = 'text' and length(user_id) between 1 and 128
  ),
  constraint app_user_organization_preference_default_check check (
    default_mailbox_id is null or (
      typeof(default_mailbox_id) = 'text'
      and length(default_mailbox_id) between 1 and 128
    )
  ),
  constraint app_user_organization_preference_settings_check check (
    typeof(settings_json) = 'text'
    and length(settings_json) <= 65536
    and json_valid(settings_json)
    and json_type(settings_json) = 'object'
  ),
  constraint app_user_organization_preference_created_check check (
    typeof(created_at) = 'integer'
    and created_at between 0 and 9007199254740991
  ),
  constraint app_user_organization_preference_updated_check check (
    typeof(updated_at) = 'integer'
    and updated_at between created_at and 9007199254740991
  ),
  constraint app_user_organization_preference_version_check check (
    typeof(version) = 'integer'
    and version between 1 and 9007199254740991
  )
);

create index app_user_organization_preference_user_idx
  on app_user_organization_preference (user_id, organization_id);

create index app_user_organization_preference_default_idx
  on app_user_organization_preference
    (organization_id, default_mailbox_id, user_id)
  where default_mailbox_id is not null;

-- The sealed ORG-006 row is the only organization write source.
insert into app_user_organization_preference (
  organization_id, user_id, default_mailbox_id, settings_json,
  created_at, updated_at, version
)
select cutover.organization_id, preference.user_id,
  preference.default_mailbox_id, preference.settings_json,
  preference.created_at, preference.updated_at, preference.version
from app_user_preference preference
join app_organization_legacy_cutover cutover
  on cutover.id = 1 and cutover.schema_version = 1
  and cutover.outcome = 'legacy-primary'
  and cutover.source_mailbox_id = 'primary'
  and cutover.organization_id = 'legacy_default_v1'
join app_mailbox mailbox
  on mailbox.id = cutover.source_mailbox_id
  and mailbox.organization_id = cutover.organization_id
  and mailbox.created_at = cutover.source_created_at
join app_organization organization
  on organization.id = cutover.organization_id
  and organization.created_at = cutover.source_created_at
join app_mailbox_legacy_organization_assignment ancestry
  on ancestry.mailbox_id = cutover.source_mailbox_id
  and ancestry.organization_id = cutover.organization_id
  and ancestry.effective_at = cutover.source_created_at
  and ancestry.source = 'legacy-cutover'
  and ancestry.schema_version = 1;

create trigger app_user_preference_frozen_insert
before insert on app_user_preference
begin
  select raise(abort, 'legacy user preferences are frozen');
end;

create trigger app_user_preference_frozen_update
before update on app_user_preference
begin
  select raise(abort, 'legacy user preferences are frozen');
end;

create trigger app_user_preference_frozen_delete
before delete on app_user_preference
begin
  select raise(abort, 'legacy user preferences are frozen');
end;

create trigger app_user_organization_preference_no_replace
before insert on app_user_organization_preference
when exists (select 1 from app_user_organization_preference
  where organization_id = new.organization_id and user_id = new.user_id)
begin
  select raise(abort, 'organization preference identity is immutable');
end;

create trigger app_user_organization_preference_insert_contract
before insert on app_user_organization_preference
when new.version is not 1 or new.created_at is not new.updated_at
  or not exists (select 1 from app_organization
    where id = new.organization_id)
  or not exists (select 1 from auth_user where id = new.user_id)
  or (new.default_mailbox_id is not null and not exists (
    select 1 from app_mailbox mailbox
    where mailbox.id = new.default_mailbox_id
      and mailbox.organization_id = new.organization_id
  ))
begin
  select raise(abort, 'invalid organization preference');
end;

create trigger app_user_organization_preference_identity_immutable
before update of organization_id, user_id, created_at
on app_user_organization_preference
when old.organization_id is not new.organization_id
  or old.user_id is not new.user_id or old.created_at is not new.created_at
begin
  select raise(abort, 'organization preference identity is immutable');
end;

create trigger app_user_organization_preference_update_contract
before update on app_user_organization_preference
when new.version <> old.version + 1 or new.updated_at < old.updated_at
begin
  select raise(abort, 'invalid organization preference update');
end;

create trigger app_user_organization_preference_parent_contract
before update on app_user_organization_preference
when not exists (select 1 from app_organization where id = new.organization_id)
  or not exists (select 1 from auth_user where id = new.user_id)
  or (new.default_mailbox_id is not null and not exists (
    select 1 from app_mailbox mailbox
    where mailbox.id = new.default_mailbox_id
      and mailbox.organization_id = new.organization_id
  ))
begin
  select raise(abort, 'invalid organization preference ancestry');
end;

create trigger app_user_organization_preference_no_delete
before delete on app_user_organization_preference
begin
  select raise(abort, 'organization preferences are retained');
end;

create table app_user_organization_preference_cutover (
  id integer primary key,
  schema_version integer not null,
  outcome text not null,
  source_mailbox_id text,
  source_created_at integer,
  source_organization_id text,
  bridge_effective_at integer,
  bridge_source text,
  constraint app_user_organization_preference_cutover_id_check check (id = 1),
  constraint app_user_organization_preference_cutover_schema_check
    check (schema_version = 1),
  constraint app_user_organization_preference_cutover_outcome_check check (
    (outcome = 'legacy-primary'
      and source_mailbox_id = 'primary'
      and source_organization_id = 'legacy_default_v1'
      and typeof(source_created_at) = 'integer'
      and source_created_at between 0 and 9007199254740991
      and bridge_effective_at = source_created_at
      and bridge_source = 'legacy-cutover')
    or (outcome = 'fresh-empty'
      and source_mailbox_id is null
      and source_created_at is null
      and source_organization_id is null
      and bridge_effective_at is null
      and bridge_source is null)
  ),
  constraint app_user_organization_preference_cutover_mailbox_fk
    foreign key (source_mailbox_id) references app_mailbox (id)
      on update restrict on delete restrict,
  constraint app_user_organization_preference_cutover_organization_fk
    foreign key (source_organization_id) references app_organization (id)
      on update restrict on delete restrict
);

insert into app_user_organization_preference_cutover
  (id, schema_version, outcome, source_mailbox_id, source_created_at,
   source_organization_id, bridge_effective_at, bridge_source)
select cutover.id, 1, cutover.outcome, cutover.source_mailbox_id,
  cutover.source_created_at, cutover.organization_id, ancestry.effective_at,
  ancestry.source
from app_organization_legacy_cutover cutover
left join app_mailbox_legacy_organization_assignment ancestry
  on cutover.outcome = 'legacy-primary'
  and ancestry.mailbox_id = cutover.source_mailbox_id
  and ancestry.organization_id = cutover.organization_id
where cutover.id = 1;

create trigger app_user_organization_preference_cutover_no_insert
before insert on app_user_organization_preference_cutover
begin
  select raise(abort, 'organization preference cutover is sealed');
end;

create trigger app_user_organization_preference_cutover_no_update
before update on app_user_organization_preference_cutover
begin
  select raise(abort, 'organization preference cutover is immutable');
end;

create trigger app_user_organization_preference_cutover_no_delete
before delete on app_user_organization_preference_cutover
begin
  select raise(abort, 'organization preference cutover is retained');
end;

create table app_user_organization_preference_generation (
  id integer primary key,
  schema_version integer not null,
  artifact_sql_json text not null,
  foreign_key_json text not null,
  index_json text not null,
  predecessor_generation_json text not null,
  constraint app_user_organization_preference_generation_id_check check (id = 1),
  constraint app_user_organization_preference_generation_schema_check
    check (schema_version = 1),
  constraint app_user_organization_preference_generation_json_check check (
    json_valid(artifact_sql_json) and json_type(artifact_sql_json) = 'array'
    and json_valid(foreign_key_json) and json_type(foreign_key_json) = 'array'
    and json_valid(index_json) and json_type(index_json) = 'array'
    and json_valid(predecessor_generation_json)
      and json_type(predecessor_generation_json) = 'object'
  )
);

create trigger app_user_organization_preference_generation_no_replace
before insert on app_user_organization_preference_generation
when exists (select 1 from app_user_organization_preference_generation
  where id = new.id)
begin
  select raise(abort, 'organization preference generation is sealed');
end;

create trigger app_user_organization_preference_generation_no_update
before update on app_user_organization_preference_generation
begin
  select raise(abort, 'organization preference generation is immutable');
end;

create trigger app_user_organization_preference_generation_no_delete
before delete on app_user_organization_preference_generation
begin
  select raise(abort, 'organization preference generation is retained');
end;

insert into app_user_organization_preference_generation (
  id, schema_version, artifact_sql_json, foreign_key_json, index_json,
  predecessor_generation_json
)
select 1, 1,
  (select json_group_array(json_object(
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
  ) order by type, name)),
  (select json_group_array(json_object(
    'id', id, 'seq', seq, 'table', "table", 'from', "from", 'to', "to",
    'on_update', on_update, 'on_delete', on_delete, 'match', match
  )) from (select * from pragma_foreign_key_list(
    'app_user_organization_preference') order by id, seq)),
  (select json_group_array(json_object(
    'seq', seq, 'name', name, 'unique', "unique", 'origin', origin,
    'partial', partial
  )) from (select * from pragma_index_list(
    'app_user_organization_preference') order by name)),
  (select json_object(
    'artifact_sql_json', artifact_sql_json,
    'column_json', column_json,
    'foreign_key_json', foreign_key_json
  ) from app_mailbox_organization_generation where id = 1);

create temp table app_user_organization_preference_postflight (
  valid integer not null check (valid = 1)
);

insert into app_user_organization_preference_postflight (valid)
select case when
  (select count(*) from app_user_organization_preference)
    = (select count(*) from app_user_preference)
  and not exists (
    select 1 from app_user_preference legacy
    join app_organization_legacy_cutover cutover on cutover.id = 1
    left join app_user_organization_preference canonical
      on canonical.organization_id = cutover.organization_id
      and canonical.user_id = legacy.user_id
    where canonical.user_id is null
      or canonical.default_mailbox_id is not legacy.default_mailbox_id
      or canonical.settings_json is not legacy.settings_json
      or canonical.created_at is not legacy.created_at
      or canonical.updated_at is not legacy.updated_at
      or canonical.version is not legacy.version
  )
  and (select count(*) from pragma_foreign_key_list(
    'app_user_organization_preference')) = 4
  and exists (select 1 from pragma_index_list('app_mailbox')
    where name = 'app_mailbox_organization_id_unique_idx'
      and "unique" = 1 and partial = 0)
  and exists (select 1 from sqlite_master where type = 'index'
    and name = 'app_user_organization_preference_default_idx'
    and sql = 'CREATE INDEX app_user_organization_preference_default_idx
  on app_user_organization_preference
    (organization_id, default_mailbox_id, user_id)
  where default_mailbox_id is not null')
  and (select count(*) from app_user_organization_preference_cutover) = 1
  and exists (
    select 1
    from app_user_organization_preference_cutover preference_cutover
    join app_organization_legacy_cutover organization_cutover
      on organization_cutover.id = preference_cutover.id
     and organization_cutover.outcome = preference_cutover.outcome
     and organization_cutover.source_mailbox_id
       is preference_cutover.source_mailbox_id
     and organization_cutover.source_created_at
       is preference_cutover.source_created_at
     and organization_cutover.organization_id
       is preference_cutover.source_organization_id
    left join app_mailbox mailbox
      on preference_cutover.outcome = 'legacy-primary'
     and mailbox.id = preference_cutover.source_mailbox_id
     and mailbox.organization_id = preference_cutover.source_organization_id
     and mailbox.created_at = preference_cutover.source_created_at
    left join app_organization organization
      on preference_cutover.outcome = 'legacy-primary'
     and organization.id = preference_cutover.source_organization_id
     and organization.created_at = preference_cutover.source_created_at
    left join app_mailbox_legacy_organization_assignment ancestry
      on preference_cutover.outcome = 'legacy-primary'
     and ancestry.mailbox_id = preference_cutover.source_mailbox_id
     and ancestry.organization_id = preference_cutover.source_organization_id
     and ancestry.effective_at = preference_cutover.bridge_effective_at
     and ancestry.source = preference_cutover.bridge_source
     and ancestry.schema_version = 1
    where preference_cutover.id = 1
      and preference_cutover.schema_version = 1
      and (
        (preference_cutover.outcome = 'legacy-primary'
          and preference_cutover.source_mailbox_id = 'primary'
          and preference_cutover.source_organization_id = 'legacy_default_v1'
          and preference_cutover.bridge_effective_at
            = preference_cutover.source_created_at
          and preference_cutover.bridge_source = 'legacy-cutover'
          and mailbox.id is not null
          and organization.id is not null
          and ancestry.mailbox_id is not null)
        or (preference_cutover.outcome = 'fresh-empty'
          and preference_cutover.source_mailbox_id is null
          and preference_cutover.source_created_at is null
          and preference_cutover.source_organization_id is null
          and preference_cutover.bridge_effective_at is null
          and preference_cutover.bridge_source is null)
      )
  )
  and (select count(*) from app_user_organization_preference_generation) = 1
  and exists (select 1 from app_user_organization_preference_generation
    where id = 1 and schema_version = 1
      and json_array_length(artifact_sql_json) = 21
      and json_array_length(foreign_key_json) = 4
      and json_array_length(index_json) = 3)
  and not exists (select 1 from pragma_foreign_key_check)
then 1 else 0 end;

drop table app_user_organization_preference_postflight;
