create temp table app_mail_domain_claim_application (
  cutover_was_present integer not null check (cutover_was_present in (0, 1)),
  receipt_was_present integer not null check (receipt_was_present in (0, 1)),
  intent_was_present integer not null check (intent_was_present in (0, 1)),
  manifest_was_present integer not null check (manifest_was_present in (0, 1))
);

insert into app_mail_domain_claim_application
  (cutover_was_present, receipt_was_present, intent_was_present,
   manifest_was_present)
select
  exists (select 1 from sqlite_master where type = 'table'
    and name = 'app_mail_domain_claim_cutover'),
  exists (select 1 from sqlite_master where type = 'table'
    and name = 'app_mail_domain_claim_receipt'),
  exists (select 1 from sqlite_master where type = 'table'
    and name = 'app_mailbox_bootstrap_domain_intent'),
  exists (select 1 from sqlite_master where type = 'table'
    and name = 'app_mail_domain_claim_trigger_manifest');

create table if not exists app_mail_domain_claim_trigger_manifest (
  id integer primary key,
  schema_version integer not null,
  trigger_sql_json text not null,
  constraint app_mail_domain_claim_trigger_manifest_id_check check (id = 1),
  constraint app_mail_domain_claim_trigger_manifest_schema_check
    check (schema_version = 1),
  constraint app_mail_domain_claim_trigger_manifest_json_check
    check (json_valid(trigger_sql_json) and json_type(trigger_sql_json) = 'array')
);

create temp table app_mail_domain_claim_entry_preflight (
  valid integer not null check (valid = 1)
);

-- Reserved-name and successor-generation collisions are rejected before DROP.
insert into app_mail_domain_claim_entry_preflight (valid)
select case when
  (select cutover_was_present from app_mail_domain_claim_application)
    = (select receipt_was_present from app_mail_domain_claim_application)
  and (select cutover_was_present from app_mail_domain_claim_application)
    = (select intent_was_present from app_mail_domain_claim_application)
  and (select cutover_was_present from app_mail_domain_claim_application)
    = (select manifest_was_present from app_mail_domain_claim_application)
  and (select sql from sqlite_master where type = 'table'
    and name = 'app_mail_domain_claim_trigger_manifest')
      = 'CREATE TABLE app_mail_domain_claim_trigger_manifest (
  id integer primary key,
  schema_version integer not null,
  trigger_sql_json text not null,
  constraint app_mail_domain_claim_trigger_manifest_id_check check (id = 1),
  constraint app_mail_domain_claim_trigger_manifest_schema_check
    check (schema_version = 1),
  constraint app_mail_domain_claim_trigger_manifest_json_check
    check (json_valid(trigger_sql_json) and json_type(trigger_sql_json) = ''array'')
)'
  and not exists (select 1 from sqlite_master
    where name glob 'app_mail_domain_claim_*'
      and name not in (
        'app_mail_domain_claim_cutover',
        'app_mail_domain_claim_receipt',
        'app_mail_domain_claim_trigger_manifest',
        'app_mail_domain_claim_receipt_address_idx',
        'app_mail_domain_claim_receipt_binding',
        'app_mail_domain_claim_receipt_no_replace',
        'app_mail_domain_claim_receipt_no_update',
        'app_mail_domain_claim_receipt_no_delete',
        'app_mail_domain_claim_cutover_no_insert',
        'app_mail_domain_claim_cutover_no_update',
        'app_mail_domain_claim_cutover_no_delete',
        'app_mail_domain_claim_from_bootstrap_audit'))
  and not exists (select 1 from sqlite_master
    where name glob 'app_mailbox_bootstrap_domain_intent_*'
      and name not in (
        'app_mailbox_bootstrap_domain_intent_binding',
        'app_mailbox_bootstrap_domain_intent_no_replace',
        'app_mailbox_bootstrap_domain_intent_no_update',
        'app_mailbox_bootstrap_domain_intent_no_delete'))
  and not exists (select 1 from sqlite_master where
    (name in (
      'app_mail_domain_claim_receipt_binding',
      'app_mail_domain_claim_receipt_no_replace',
      'app_mail_domain_claim_receipt_no_update',
      'app_mail_domain_claim_receipt_no_delete')
      and (type <> 'trigger' or tbl_name <> 'app_mail_domain_claim_receipt'))
    or (name in (
      'app_mail_domain_claim_cutover_no_insert',
      'app_mail_domain_claim_cutover_no_update',
      'app_mail_domain_claim_cutover_no_delete')
      and (type <> 'trigger' or tbl_name <> 'app_mail_domain_claim_cutover'))
    or (name in (
      'app_mailbox_bootstrap_domain_intent_binding',
      'app_mailbox_bootstrap_domain_intent_no_replace',
      'app_mailbox_bootstrap_domain_intent_no_update',
      'app_mailbox_bootstrap_domain_intent_no_delete')
      and (type <> 'trigger'
        or tbl_name <> 'app_mailbox_bootstrap_domain_intent'))
    or (name = 'app_mail_domain_claim_from_bootstrap_audit'
      and (type <> 'trigger'
        or tbl_name <> 'app_administrative_audit_event'))
    or (name = 'app_mail_domain_reserved_claim_lifecycle_frozen'
      and (type <> 'trigger' or tbl_name <> 'app_mail_domain')))
  and (
    ((select cutover_was_present from app_mail_domain_claim_application) = 0
      and not exists (select 1 from sqlite_master where name in (
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
        'app_mail_domain_reserved_claim_lifecycle_frozen')))
    or
    ((select cutover_was_present from app_mail_domain_claim_application) = 1
      and (select count(*) from app_mail_domain_claim_trigger_manifest) = 1
      and exists (select 1 from app_mail_domain_claim_trigger_manifest
        where id = 1 and schema_version = 1)
      and (select count(*) from sqlite_master where type = 'trigger'
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
          'app_mail_domain_reserved_claim_lifecycle_frozen')) = 13
      and (select trigger_sql_json
        from app_mail_domain_claim_trigger_manifest where id = 1)
        = (select json_group_array(sql) from (
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
              'app_mail_domain_reserved_claim_lifecycle_frozen')
          order by name)))
  )
  and not exists (select 1 from pragma_table_xinfo('app_mailbox')
    where name = 'organization_id')
  and exists (select 1 from sqlite_master where type = 'table'
    and name = 'app_mail_domain')
  and exists (select 1 from sqlite_master where type = 'table'
    and name = 'app_mailbox_legacy_organization_assignment')
  and exists (select 1 from sqlite_master where type = 'table'
    and name = 'app_organization_owner_assignment_receipt')
  and exists (select 1 from app_mailbox_legacy_organization_assignment_cutover
    where id = 1 and schema_version = 1)
  and exists (select 1 from app_organization_owner_assignment_cutover
    where id = 1 and schema_version = 1)
  and (select count(*) from pragma_table_xinfo('app_mail_domain')) = 9
  and (select count(*) from pragma_foreign_key_list('app_mail_domain')) = 1
  and (select count(*) from pragma_index_list('app_mail_domain')) = 4
  and (select count(*)
    from pragma_table_xinfo('app_mailbox_legacy_organization_assignment')) = 5
  and (select count(*) from pragma_foreign_key_list(
    'app_mailbox_legacy_organization_assignment')) = 2
  and (select count(*) from pragma_index_list(
    'app_mailbox_legacy_organization_assignment')) = 1
  and (select count(*) from pragma_table_xinfo(
    'app_organization_owner_assignment_receipt')) = 21
  and (select count(*) from pragma_foreign_key_list(
    'app_organization_owner_assignment_receipt')) = 18
  and (select count(*) from pragma_index_list(
    'app_organization_owner_assignment_receipt')) = 2
  and (select count(*)
    from pragma_table_xinfo('app_mailbox_bootstrap_receipt_v1_intent')) = 2
  and (select count(*)
    from pragma_table_xinfo('app_mailbox_bootstrap_receipt_v2')) = 3
  and (select count(*) from pragma_table_xinfo('app_mailbox_address')) = 10
  and (select count(*) from pragma_foreign_key_list('app_mailbox_address')) = 1
  and (select count(*) from pragma_index_list('app_mailbox_address')) = 4
  and (select sql from sqlite_master where type = 'table'
    and name = 'app_mail_domain')
      = 'CREATE TABLE app_mail_domain (
  id text not null,
  organization_id text not null,
  canonical_domain text not null,
  canonicalization_profile_id text not null,
  canonicalization_version integer not null default 1,
  status text not null default ''pending_verification'',
  created_at integer not null,
  updated_at integer not null,
  version integer not null default 1,
  constraint app_mail_domain_pkey primary key (id),
  constraint app_mail_domain_organization_fk
    foreign key (organization_id) references app_organization (id)
      on update restrict on delete restrict,
  constraint app_mail_domain_id_check
    check (
      typeof(id) = ''text''
      and length(id) between 1 and 128
      and length(cast(id as blob)) = length(id)
      and id not glob ''*[^A-Za-z0-9_-]*''
    ),
  constraint app_mail_domain_organization_id_check
    check (typeof(organization_id) = ''text'' and length(organization_id) > 0),
  constraint app_mail_domain_canonical_domain_check
    check (
      typeof(canonical_domain) = ''text''
      and length(canonical_domain) between 3 and 253
      and length(cast(canonical_domain as blob)) = length(canonical_domain)
      and canonical_domain = lower(canonical_domain)
      and canonical_domain not glob ''*[^a-z0-9.-]*''
      and canonical_domain glob ''*.*''
      and canonical_domain not like ''.%''
      and canonical_domain not like ''%.''
      and canonical_domain not like ''%..%''
      and canonical_domain not like ''-%''
      and canonical_domain not like ''%-''
      and canonical_domain not like ''%.-%''
      and canonical_domain not like ''%-.%''
      and substr(canonical_domain, instr(canonical_domain, ''.'') + 1) <> ''''
    ),
  constraint app_mail_domain_profile_check
    check (
      typeof(canonicalization_profile_id) = ''text''
      and canonicalization_profile_id = ''mail-domain/ascii-alabel-input/uts46-nontransitional-std3/unicode-17/v1''
    ),
  constraint app_mail_domain_canonicalization_version_check
    check (
      typeof(canonicalization_version) = ''integer''
      and canonicalization_version = 1
    ),
  constraint app_mail_domain_status_check
    check (
      typeof(status) = ''text''
      and status in (
        ''pending_verification'', ''verified'', ''active'', ''suspended'', ''retired''
      )
    ),
  constraint app_mail_domain_created_at_check
    check (
      typeof(created_at) = ''integer''
      and created_at between 0 and 9007199254740991
    ),
  constraint app_mail_domain_updated_at_check
    check (
      typeof(updated_at) = ''integer''
      and updated_at between created_at and 9007199254740991
    ),
  constraint app_mail_domain_version_check
    check (
      typeof(version) = ''integer''
      and version between 1 and 9007199254740991
    )
)'
  and (select sql from sqlite_master where type = 'index'
    and name = 'app_mail_domain_current_canonical_idx')
      = 'CREATE UNIQUE INDEX app_mail_domain_current_canonical_idx
  on app_mail_domain (canonical_domain)
  where status <> ''retired'''
  and (select sql from sqlite_master where type = 'index'
    and name = 'app_mail_domain_organization_status_idx')
      = 'CREATE INDEX app_mail_domain_organization_status_idx
  on app_mail_domain (organization_id, status, id)'
  and (select sql from sqlite_master where type = 'index'
    and name = 'app_mail_domain_canonical_history_idx')
      = 'CREATE INDEX app_mail_domain_canonical_history_idx
  on app_mail_domain (canonical_domain, status, updated_at, id)'
  and (select sql from sqlite_master where type = 'trigger'
    and name = 'app_mail_domain_insert_contract'
    and tbl_name = 'app_mail_domain')
      = 'CREATE TRIGGER app_mail_domain_insert_contract
before insert on app_mail_domain
when new.status is not ''pending_verification''
  or new.canonicalization_profile_id is not ''mail-domain/ascii-alabel-input/uts46-nontransitional-std3/unicode-17/v1''
  or new.canonicalization_version is not 1
  or new.version is not 1
  or new.created_at is not new.updated_at
begin
  select raise(abort, ''mail domain must start pending at canonicalization version 1'');
end'
  and (select sql from sqlite_master where type = 'trigger'
    and name = 'app_mail_domain_label_grammar_insert'
    and tbl_name = 'app_mail_domain')
      = 'CREATE TRIGGER app_mail_domain_label_grammar_insert
before insert on app_mail_domain
begin
  select case when exists (
    with recursive labels(label, rest) as (
      values ('''', new.canonical_domain || ''.'')
      union all
      select substr(rest, 1, instr(rest, ''.'') - 1),
             substr(rest, instr(rest, ''.'') + 1)
      from labels
      where rest <> ''''
    )
    select 1
    from labels
    where (label <> '''' and length(label) not between 1 and 63)
      or (substr(label, 3, 2) = ''--'' and substr(label, 1, 4) <> ''xn--'')
      or (rest = '''' and label <> '''' and label not glob ''*[^0-9]*'')
  ) then raise(abort, ''mail domain labels violate canonical DNS grammar'') end;
end'
  and (select sql from sqlite_master where type = 'trigger'
    and name = 'app_mail_domain_core_immutable'
    and tbl_name = 'app_mail_domain')
      = 'CREATE TRIGGER app_mail_domain_core_immutable
before update of id, organization_id, canonical_domain,
  canonicalization_profile_id, canonicalization_version, created_at
on app_mail_domain
when old.id is not new.id
  or old.organization_id is not new.organization_id
  or old.canonical_domain is not new.canonical_domain
  or old.canonicalization_profile_id is not new.canonicalization_profile_id
  or old.canonicalization_version is not new.canonicalization_version
  or old.created_at is not new.created_at
begin
  select raise(abort, ''mail domain core fields are immutable'');
end'
  and (select sql from sqlite_master where type = 'trigger'
    and name = 'app_mail_domain_no_replace' and tbl_name = 'app_mail_domain')
      = 'CREATE TRIGGER app_mail_domain_no_replace
before insert on app_mail_domain
when exists (select 1 from app_mail_domain where id = new.id)
begin
  select raise(abort, ''mail domain identifiers are immutable and never reused'');
end'
  and (select sql from sqlite_master where type = 'trigger'
    and name = 'app_mail_domain_insert_epoch_guard'
    and tbl_name = 'app_mail_domain')
      = 'CREATE TRIGGER app_mail_domain_insert_epoch_guard
before insert on app_mail_domain
begin
  select case when exists (
    select 1
    from app_mail_domain
    where canonical_domain = new.canonical_domain
      and status <> ''retired''
  ) then raise(abort, ''canonical mail domain already has a current claim'') end;
  select case when new.created_at < (
    select max(updated_at)
    from app_mail_domain
    where canonical_domain = new.canonical_domain
      and status = ''retired''
  ) then raise(abort, ''mail domain epoch predates prior retirement'') end;
end'
  and (select sql from sqlite_master where type = 'trigger'
    and name = 'app_mail_domain_update_lifecycle'
    and tbl_name = 'app_mail_domain')
      = 'CREATE TRIGGER app_mail_domain_update_lifecycle
before update on app_mail_domain
when old.status is not new.status
  or old.updated_at is not new.updated_at
  or old.version is not new.version
begin
  select case when old.status is new.status
    or new.version <> old.version + 1
    or new.updated_at < old.updated_at
    or not (
      (old.status = ''pending_verification'' and new.status in (''verified'', ''retired''))
      or (old.status = ''verified'' and new.status in (''active'', ''pending_verification'', ''retired''))
      or (old.status = ''active'' and new.status in (''suspended'', ''pending_verification'', ''retired''))
      or (old.status = ''suspended'' and new.status in (''active'', ''pending_verification'', ''retired''))
    )
    then raise(abort, ''invalid mail domain lifecycle update'') end;
end'
  and (select sql from sqlite_master where type = 'trigger'
    and name = 'app_mail_domain_no_delete' and tbl_name = 'app_mail_domain')
      = 'CREATE TRIGGER app_mail_domain_no_delete
before delete on app_mail_domain
begin
  select raise(abort, ''mail domains are retained'');
end'
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
    and name = 'app_organization_owner_assignment_receipt_no_update'
    and tbl_name = 'app_organization_owner_assignment_receipt')
      = 'CREATE TRIGGER app_organization_owner_assignment_receipt_no_update
before update on app_organization_owner_assignment_receipt
begin
  select raise(abort, ''organization owner assignment receipts are immutable'');
end'
  and (select sql from sqlite_master where type = 'trigger'
    and name = 'app_organization_owner_assignment_receipt_no_delete'
    and tbl_name = 'app_organization_owner_assignment_receipt')
      = 'CREATE TRIGGER app_organization_owner_assignment_receipt_no_delete
before delete on app_organization_owner_assignment_receipt
begin
  select raise(abort, ''organization owner assignment receipts are retained'');
end'
  and instr((select sql from sqlite_master where type = 'table'
      and name = 'app_mailbox_legacy_organization_assignment'),
    'constraint app_mailbox_legacy_organization_assignment_schema_check') > 0
  and instr((select sql from sqlite_master where type = 'table'
      and name = 'app_organization_owner_assignment_receipt'),
    'constraint app_organization_owner_assignment_receipt_source_check') > 0
  and instr((select sql from sqlite_master where type = 'table'
      and name = 'app_organization_owner_assignment_receipt'),
    'constraint app_organization_owner_assignment_receipt_identity_check') > 0
  and not exists (select 1 from pragma_foreign_key_check)
then 1 else 0 end;

drop table app_mail_domain_claim_entry_preflight;

drop trigger if exists app_mail_domain_claim_receipt_binding;
drop trigger if exists app_mail_domain_claim_receipt_no_replace;
drop trigger if exists app_mail_domain_claim_receipt_no_update;
drop trigger if exists app_mail_domain_claim_receipt_no_delete;
drop trigger if exists app_mail_domain_claim_cutover_no_insert;
drop trigger if exists app_mail_domain_claim_cutover_no_update;
drop trigger if exists app_mail_domain_claim_cutover_no_delete;
drop trigger if exists app_mail_domain_claim_from_bootstrap_audit;
drop trigger if exists app_mailbox_bootstrap_domain_intent_binding;
drop trigger if exists app_mailbox_bootstrap_domain_intent_no_replace;
drop trigger if exists app_mailbox_bootstrap_domain_intent_no_update;
drop trigger if exists app_mailbox_bootstrap_domain_intent_no_delete;
drop trigger if exists app_mail_domain_reserved_claim_lifecycle_frozen;

create table if not exists app_mail_domain_claim_cutover (
  id integer primary key,
  schema_version integer not null,
  initial_outcome text not null,
  initial_status text not null,
  constraint app_mail_domain_claim_cutover_id_check check (id = 1),
  constraint app_mail_domain_claim_cutover_schema_check
    check (typeof(schema_version) = 'integer' and schema_version = 1),
  constraint app_mail_domain_claim_cutover_outcome_check check (
    typeof(initial_outcome) = 'text'
    and initial_outcome in (
      'fresh-empty', 'legacy-awaiting-reconciliation',
      'already-bootstrapped-awaiting-reconciliation', 'complete-pair'
    )
  ),
  constraint app_mail_domain_claim_cutover_status_check check (
    (initial_outcome = 'fresh-empty' and initial_status = 'awaiting-bootstrap')
    or (initial_outcome in (
      'legacy-awaiting-reconciliation',
      'already-bootstrapped-awaiting-reconciliation'
    ) and initial_status = 'awaiting-reconciliation')
    or (initial_outcome = 'complete-pair' and initial_status = 'complete')
  )
);

create table if not exists app_mailbox_bootstrap_domain_intent (
  operation_id text not null primary key,
  canonical_domain text not null,
  canonicalization_profile_id text not null,
  canonicalization_version integer not null,
  schema_version integer not null,
  constraint app_mailbox_bootstrap_domain_intent_operation_fk
    foreign key (operation_id)
      references app_mailbox_administration_receipt (operation_id)
      on update restrict on delete restrict,
  constraint app_mailbox_bootstrap_domain_intent_domain_check check (
    typeof(canonical_domain) = 'text'
    and length(canonical_domain) between 3 and 253
    and length(cast(canonical_domain as blob)) = length(canonical_domain)
    and canonical_domain = lower(canonical_domain)
    and canonical_domain not glob '*[^a-z0-9.-]*'
    and canonical_domain glob '*.*'
    and canonical_domain not like '.%'
    and canonical_domain not like '%.'
    and canonical_domain not like '%..%'
    and canonical_domain not like '-%'
    and canonical_domain not like '%-'
    and canonical_domain not like '%.-%'
    and canonical_domain not like '%-.%'
  ),
  constraint app_mailbox_bootstrap_domain_intent_profile_check check (
    canonicalization_profile_id = 'mail-domain/ascii-alabel-input/uts46-nontransitional-std3/unicode-17/v1'
    and canonicalization_version = 1
    and schema_version = 1
  )
);

create table if not exists app_mail_domain_claim_receipt (
  domain_id text not null primary key,
  organization_id text not null,
  mailbox_id text not null,
  primary_address_id text not null,
  raw_address_snapshot text not null,
  normalized_address_snapshot text not null,
  canonical_domain text not null,
  canonicalization_profile_id text not null,
  canonicalization_version integer not null,
  source text not null,
  effective_at integer not null,
  source_bootstrap_operation_id text,
  source_audit_event_id text,
  schema_version integer not null,
  constraint app_mail_domain_claim_receipt_domain_fk
    foreign key (domain_id) references app_mail_domain (id)
      on update restrict on delete restrict,
  constraint app_mail_domain_claim_receipt_organization_fk
    foreign key (organization_id) references app_organization (id)
      on update restrict on delete restrict,
  constraint app_mail_domain_claim_receipt_address_fk
    foreign key (mailbox_id, primary_address_id)
      references app_mailbox_address (mailbox_id, id)
      on update restrict on delete restrict,
  constraint app_mail_domain_claim_receipt_operation_fk
    foreign key (source_bootstrap_operation_id)
      references app_mailbox_administration_receipt (operation_id)
      on update restrict on delete restrict,
  constraint app_mail_domain_claim_receipt_audit_fk
    foreign key (source_audit_event_id)
      references app_administrative_audit_event (event_id)
      on update restrict on delete restrict,
  constraint app_mail_domain_claim_receipt_identity_check check (
    domain_id = 'legacy_default_v1_domain_v1'
    and organization_id = 'legacy_default_v1'
    and mailbox_id = 'primary'
    and primary_address_id = 'primary'
  ),
  constraint app_mail_domain_claim_receipt_snapshot_check check (
    typeof(raw_address_snapshot) = 'text'
    and length(raw_address_snapshot) between 3 and 320
    and typeof(normalized_address_snapshot) = 'text'
    and length(normalized_address_snapshot) between 3 and 320
    and instr(raw_address_snapshot, '@') between 2
      and length(raw_address_snapshot) - 2
    and instr(substr(raw_address_snapshot,
      instr(raw_address_snapshot, '@') + 1), '@') = 0
    and instr(normalized_address_snapshot, '@') between 2
      and length(normalized_address_snapshot) - 2
    and instr(substr(normalized_address_snapshot,
      instr(normalized_address_snapshot, '@') + 1), '@') = 0
  ),
  constraint app_mail_domain_claim_receipt_domain_check check (
    typeof(canonical_domain) = 'text'
    and canonical_domain = lower(canonical_domain)
    and canonical_domain not glob '*[^a-z0-9.-]*'
    and canonicalization_profile_id = 'mail-domain/ascii-alabel-input/uts46-nontransitional-std3/unicode-17/v1'
    and canonicalization_version = 1
  ),
  constraint app_mail_domain_claim_receipt_source_check check (
    (source = 'fresh-bootstrap'
      and source_bootstrap_operation_id is not null
      and source_audit_event_id is not null)
    or (source = 'legacy-reconciliation' and (
      (source_bootstrap_operation_id is null
        and source_audit_event_id is null)
      or (source_bootstrap_operation_id is null
        and source_audit_event_id is not null)
      or (source_bootstrap_operation_id is not null
        and source_audit_event_id is not null)
    ))
  ),
  constraint app_mail_domain_claim_receipt_time_check check (
    typeof(effective_at) = 'integer'
    and effective_at between 0 and 9007199254740991
  ),
  constraint app_mail_domain_claim_receipt_schema_check
    check (typeof(schema_version) = 'integer' and schema_version = 1)
);

create unique index if not exists app_mail_domain_claim_receipt_address_idx
  on app_mail_domain_claim_receipt (mailbox_id, primary_address_id);

create temp table app_mail_domain_claim_preflight (
  valid integer not null check (valid = 1)
);

-- Exact owned generation: columns, FK actions, named constraints, and index.
insert into app_mail_domain_claim_preflight (valid)
select case when
  (select sql from sqlite_master where type = 'table'
    and name = 'app_mail_domain_claim_cutover')
    = 'CREATE TABLE app_mail_domain_claim_cutover (
  id integer primary key,
  schema_version integer not null,
  initial_outcome text not null,
  initial_status text not null,
  constraint app_mail_domain_claim_cutover_id_check check (id = 1),
  constraint app_mail_domain_claim_cutover_schema_check
    check (typeof(schema_version) = ''integer'' and schema_version = 1),
  constraint app_mail_domain_claim_cutover_outcome_check check (
    typeof(initial_outcome) = ''text''
    and initial_outcome in (
      ''fresh-empty'', ''legacy-awaiting-reconciliation'',
      ''already-bootstrapped-awaiting-reconciliation'', ''complete-pair''
    )
  ),
  constraint app_mail_domain_claim_cutover_status_check check (
    (initial_outcome = ''fresh-empty'' and initial_status = ''awaiting-bootstrap'')
    or (initial_outcome in (
      ''legacy-awaiting-reconciliation'',
      ''already-bootstrapped-awaiting-reconciliation''
    ) and initial_status = ''awaiting-reconciliation'')
    or (initial_outcome = ''complete-pair'' and initial_status = ''complete'')
  )
)'
  and (select sql from sqlite_master where type = 'table'
    and name = 'app_mailbox_bootstrap_domain_intent')
    = 'CREATE TABLE app_mailbox_bootstrap_domain_intent (
  operation_id text not null primary key,
  canonical_domain text not null,
  canonicalization_profile_id text not null,
  canonicalization_version integer not null,
  schema_version integer not null,
  constraint app_mailbox_bootstrap_domain_intent_operation_fk
    foreign key (operation_id)
      references app_mailbox_administration_receipt (operation_id)
      on update restrict on delete restrict,
  constraint app_mailbox_bootstrap_domain_intent_domain_check check (
    typeof(canonical_domain) = ''text''
    and length(canonical_domain) between 3 and 253
    and length(cast(canonical_domain as blob)) = length(canonical_domain)
    and canonical_domain = lower(canonical_domain)
    and canonical_domain not glob ''*[^a-z0-9.-]*''
    and canonical_domain glob ''*.*''
    and canonical_domain not like ''.%''
    and canonical_domain not like ''%.''
    and canonical_domain not like ''%..%''
    and canonical_domain not like ''-%''
    and canonical_domain not like ''%-''
    and canonical_domain not like ''%.-%''
    and canonical_domain not like ''%-.%''
  ),
  constraint app_mailbox_bootstrap_domain_intent_profile_check check (
    canonicalization_profile_id = ''mail-domain/ascii-alabel-input/uts46-nontransitional-std3/unicode-17/v1''
    and canonicalization_version = 1
    and schema_version = 1
  )
)'
  and (select sql from sqlite_master where type = 'table'
    and name = 'app_mail_domain_claim_receipt')
    = 'CREATE TABLE app_mail_domain_claim_receipt (
  domain_id text not null primary key,
  organization_id text not null,
  mailbox_id text not null,
  primary_address_id text not null,
  raw_address_snapshot text not null,
  normalized_address_snapshot text not null,
  canonical_domain text not null,
  canonicalization_profile_id text not null,
  canonicalization_version integer not null,
  source text not null,
  effective_at integer not null,
  source_bootstrap_operation_id text,
  source_audit_event_id text,
  schema_version integer not null,
  constraint app_mail_domain_claim_receipt_domain_fk
    foreign key (domain_id) references app_mail_domain (id)
      on update restrict on delete restrict,
  constraint app_mail_domain_claim_receipt_organization_fk
    foreign key (organization_id) references app_organization (id)
      on update restrict on delete restrict,
  constraint app_mail_domain_claim_receipt_address_fk
    foreign key (mailbox_id, primary_address_id)
      references app_mailbox_address (mailbox_id, id)
      on update restrict on delete restrict,
  constraint app_mail_domain_claim_receipt_operation_fk
    foreign key (source_bootstrap_operation_id)
      references app_mailbox_administration_receipt (operation_id)
      on update restrict on delete restrict,
  constraint app_mail_domain_claim_receipt_audit_fk
    foreign key (source_audit_event_id)
      references app_administrative_audit_event (event_id)
      on update restrict on delete restrict,
  constraint app_mail_domain_claim_receipt_identity_check check (
    domain_id = ''legacy_default_v1_domain_v1''
    and organization_id = ''legacy_default_v1''
    and mailbox_id = ''primary''
    and primary_address_id = ''primary''
  ),
  constraint app_mail_domain_claim_receipt_snapshot_check check (
    typeof(raw_address_snapshot) = ''text''
    and length(raw_address_snapshot) between 3 and 320
    and typeof(normalized_address_snapshot) = ''text''
    and length(normalized_address_snapshot) between 3 and 320
    and instr(raw_address_snapshot, ''@'') between 2
      and length(raw_address_snapshot) - 2
    and instr(substr(raw_address_snapshot,
      instr(raw_address_snapshot, ''@'') + 1), ''@'') = 0
    and instr(normalized_address_snapshot, ''@'') between 2
      and length(normalized_address_snapshot) - 2
    and instr(substr(normalized_address_snapshot,
      instr(normalized_address_snapshot, ''@'') + 1), ''@'') = 0
  ),
  constraint app_mail_domain_claim_receipt_domain_check check (
    typeof(canonical_domain) = ''text''
    and canonical_domain = lower(canonical_domain)
    and canonical_domain not glob ''*[^a-z0-9.-]*''
    and canonicalization_profile_id = ''mail-domain/ascii-alabel-input/uts46-nontransitional-std3/unicode-17/v1''
    and canonicalization_version = 1
  ),
  constraint app_mail_domain_claim_receipt_source_check check (
    (source = ''fresh-bootstrap''
      and source_bootstrap_operation_id is not null
      and source_audit_event_id is not null)
    or (source = ''legacy-reconciliation'' and (
      (source_bootstrap_operation_id is null
        and source_audit_event_id is null)
      or (source_bootstrap_operation_id is null
        and source_audit_event_id is not null)
      or (source_bootstrap_operation_id is not null
        and source_audit_event_id is not null)
    ))
  ),
  constraint app_mail_domain_claim_receipt_time_check check (
    typeof(effective_at) = ''integer''
    and effective_at between 0 and 9007199254740991
  ),
  constraint app_mail_domain_claim_receipt_schema_check
    check (typeof(schema_version) = ''integer'' and schema_version = 1)
)'
  and (select count(*) from pragma_table_xinfo('app_mail_domain_claim_cutover')) = 4
  and not exists (select 1 from pragma_table_xinfo('app_mail_domain_claim_cutover')
    where not (
      (cid = 0 and name = 'id' and type = 'INTEGER' and "notnull" = 0
        and dflt_value is null and pk = 1 and hidden = 0)
      or (cid = 1 and name = 'schema_version' and type = 'INTEGER'
        and "notnull" = 1 and dflt_value is null and pk = 0 and hidden = 0)
      or (cid = 2 and name = 'initial_outcome' and type = 'TEXT'
        and "notnull" = 1 and dflt_value is null and pk = 0 and hidden = 0)
      or (cid = 3 and name = 'initial_status' and type = 'TEXT'
        and "notnull" = 1 and dflt_value is null and pk = 0 and hidden = 0)))
  and (select count(*)
    from pragma_table_xinfo('app_mailbox_bootstrap_domain_intent')) = 5
  and not exists (select 1
    from pragma_table_xinfo('app_mailbox_bootstrap_domain_intent')
    where dflt_value is not null or hidden <> 0 or not (
      (cid = 0 and name = 'operation_id' and type = 'TEXT'
        and "notnull" = 1 and pk = 1)
      or (cid = 1 and name = 'canonical_domain' and type = 'TEXT'
        and "notnull" = 1 and pk = 0)
      or (cid = 2 and name = 'canonicalization_profile_id' and type = 'TEXT'
        and "notnull" = 1 and pk = 0)
      or (cid = 3 and name = 'canonicalization_version' and type = 'INTEGER'
        and "notnull" = 1 and pk = 0)
      or (cid = 4 and name = 'schema_version' and type = 'INTEGER'
        and "notnull" = 1 and pk = 0)))
  and (select count(*)
    from pragma_table_xinfo('app_mail_domain_claim_receipt')) = 14
  and not exists (select 1
    from pragma_table_xinfo('app_mail_domain_claim_receipt')
    where dflt_value is not null or hidden <> 0 or not (
      (cid = 0 and name = 'domain_id' and type = 'TEXT'
        and "notnull" = 1 and pk = 1)
      or (cid = 1 and name = 'organization_id' and type = 'TEXT'
        and "notnull" = 1 and pk = 0)
      or (cid = 2 and name = 'mailbox_id' and type = 'TEXT'
        and "notnull" = 1 and pk = 0)
      or (cid = 3 and name = 'primary_address_id' and type = 'TEXT'
        and "notnull" = 1 and pk = 0)
      or (cid = 4 and name = 'raw_address_snapshot' and type = 'TEXT'
        and "notnull" = 1 and pk = 0)
      or (cid = 5 and name = 'normalized_address_snapshot' and type = 'TEXT'
        and "notnull" = 1 and pk = 0)
      or (cid = 6 and name = 'canonical_domain' and type = 'TEXT'
        and "notnull" = 1 and pk = 0)
      or (cid = 7 and name = 'canonicalization_profile_id' and type = 'TEXT'
        and "notnull" = 1 and pk = 0)
      or (cid = 8 and name = 'canonicalization_version' and type = 'INTEGER'
        and "notnull" = 1 and pk = 0)
      or (cid = 9 and name = 'source' and type = 'TEXT'
        and "notnull" = 1 and pk = 0)
      or (cid = 10 and name = 'effective_at' and type = 'INTEGER'
        and "notnull" = 1 and pk = 0)
      or (cid = 11 and name = 'source_bootstrap_operation_id' and type = 'TEXT'
        and "notnull" = 0 and pk = 0)
      or (cid = 12 and name = 'source_audit_event_id' and type = 'TEXT'
        and "notnull" = 0 and pk = 0)
      or (cid = 13 and name = 'schema_version' and type = 'INTEGER'
        and "notnull" = 1 and pk = 0)))
  and (select count(*)
    from pragma_foreign_key_list('app_mailbox_bootstrap_domain_intent')) = 1
  and exists (select 1
    from pragma_foreign_key_list('app_mailbox_bootstrap_domain_intent')
    where id = 0 and seq = 0 and "table" = 'app_mailbox_administration_receipt'
      and "from" = 'operation_id' and "to" = 'operation_id'
      and on_update = 'RESTRICT' and on_delete = 'RESTRICT'
      and match = 'NONE')
  and (select count(*)
    from pragma_foreign_key_list('app_mail_domain_claim_receipt')) = 6
  and not exists (select 1
    from pragma_foreign_key_list('app_mail_domain_claim_receipt')
    where on_update <> 'RESTRICT' or on_delete <> 'RESTRICT'
      or match <> 'NONE')
  and exists (select 1
    from pragma_foreign_key_list('app_mail_domain_claim_receipt')
    where "table" = 'app_mail_domain' and "from" = 'domain_id'
      and "to" = 'id')
  and exists (select 1
    from pragma_foreign_key_list('app_mail_domain_claim_receipt')
    where "table" = 'app_organization' and "from" = 'organization_id'
      and "to" = 'id')
  and exists (select 1
    from pragma_foreign_key_list('app_mail_domain_claim_receipt')
    where "table" = 'app_mailbox_address' and "from" = 'mailbox_id'
      and "to" = 'mailbox_id' and seq = 0)
  and exists (select 1
    from pragma_foreign_key_list('app_mail_domain_claim_receipt')
    where "table" = 'app_mailbox_address' and "from" = 'primary_address_id'
      and "to" = 'id' and seq = 1
      and id = (select id from pragma_foreign_key_list(
        'app_mail_domain_claim_receipt')
        where "table" = 'app_mailbox_address' and "from" = 'mailbox_id'))
  and (select sql from sqlite_master where type = 'index'
    and name = 'app_mail_domain_claim_receipt_address_idx')
      = 'CREATE UNIQUE INDEX app_mail_domain_claim_receipt_address_idx
  on app_mail_domain_claim_receipt (mailbox_id, primary_address_id)'
  and instr((select sql from sqlite_master where type = 'table'
      and name = 'app_mail_domain_claim_cutover'),
    'constraint app_mail_domain_claim_cutover_status_check') > 0
  and instr((select sql from sqlite_master where type = 'table'
      and name = 'app_mailbox_bootstrap_domain_intent'),
    'constraint app_mailbox_bootstrap_domain_intent_profile_check') > 0
  and instr((select sql from sqlite_master where type = 'table'
      and name = 'app_mail_domain_claim_receipt'),
    'constraint app_mail_domain_claim_receipt_identity_check') > 0
  and instr((select sql from sqlite_master where type = 'table'
      and name = 'app_mail_domain_claim_receipt'),
    'constraint app_mail_domain_claim_receipt_source_check') > 0
then 1 else 0 end;

-- First application recognizes state but deliberately does not canonicalize or
-- materialize a populated legacy route. Reapply validates and never heals.
insert into app_mail_domain_claim_preflight (valid)
select case
  when (select cutover_was_present from app_mail_domain_claim_application) = 0
    and not exists (select 1 from app_mail_domain_claim_cutover)
    and not exists (select 1 from app_mail_domain_claim_receipt)
    and not exists (select 1 from app_mailbox_bootstrap_domain_intent)
    and not exists (select 1 from app_mail_domain)
    and (
      (not exists (select 1 from app_mailbox)
        and not exists (select 1 from app_organization)
        and not exists (select 1 from app_mailbox_address)
        and not exists (select 1 from app_mailbox_administration_receipt
          where operation_kind = 'bootstrap-owner')
        and not exists (select 1
          from app_mailbox_bootstrap_receipt_v1_intent)
        and not exists (select 1 from app_mailbox_bootstrap_receipt_v2)
        and not exists (select 1 from app_administrative_audit_event
          where action = 'mailbox.owner-bootstrap')
        and not exists (select 1
          from app_mailbox_legacy_organization_assignment)
        and not exists (select 1
          from app_organization_owner_assignment_receipt))
      or (
        (select count(*) from app_mailbox) = 1
        and (select count(*) from app_organization) = 1
        and (select count(*) from app_mailbox_address
          where mailbox_id = 'primary' and id = 'primary'
            and is_primary = 1 and enabled = 1) = 1
        and (select count(*)
          from app_mailbox_legacy_organization_assignment) = 1
        and exists (select 1
          from app_mailbox_legacy_organization_assignment ancestry
          join app_mailbox mailbox on mailbox.id = ancestry.mailbox_id
          join app_organization organization
            on organization.id = ancestry.organization_id
          where ancestry.mailbox_id = 'primary'
            and ancestry.organization_id = 'legacy_default_v1'
            and ancestry.effective_at = mailbox.created_at
            and ancestry.effective_at = organization.created_at
            and ancestry.schema_version = 1)
        and (select count(*) from app_organization_owner_assignment_receipt) = 1
      )
    )
  then 1
  when (select cutover_was_present from app_mail_domain_claim_application) = 1
    and (select count(*) from app_mail_domain_claim_cutover) = 1
    and exists (select 1 from app_mail_domain_claim_cutover
      where id = 1 and schema_version = 1)
    and (
      (not exists (select 1 from app_mailbox)
        and not exists (select 1 from app_organization)
        and not exists (select 1 from app_mailbox_address)
        and not exists (select 1
          from app_mailbox_legacy_organization_assignment)
        and not exists (select 1
          from app_organization_owner_assignment_receipt)
        and not exists (select 1 from app_mailbox_administration_receipt
          where operation_kind = 'bootstrap-owner')
        and not exists (select 1
          from app_mailbox_bootstrap_receipt_v1_intent)
        and not exists (select 1 from app_mailbox_bootstrap_receipt_v2)
        and not exists (select 1
          from app_mailbox_bootstrap_domain_intent)
        and not exists (select 1 from app_administrative_audit_event
          where action = 'mailbox.owner-bootstrap')
        and not exists (select 1 from app_mail_domain)
        and not exists (select 1 from app_mail_domain_claim_receipt)
        and exists (select 1 from app_mail_domain_claim_cutover
          where initial_outcome = 'fresh-empty'
            and initial_status = 'awaiting-bootstrap'))
      or (
        (select count(*) from app_mailbox) = 1
        and (select count(*) from app_mail_domain) = 0
        and (select count(*) from app_mail_domain_claim_receipt) = 0
        and exists (select 1 from app_mail_domain_claim_cutover
          where initial_status = 'awaiting-reconciliation')
      )
      or (
        (select count(*) from app_mail_domain) = 1
        and (select count(*) from app_mail_domain_claim_receipt) = 1
        and exists (select 1 from app_mail_domain domain
          join app_mail_domain_claim_receipt receipt
            on receipt.domain_id = domain.id
          join app_mailbox_address address
            on address.mailbox_id = receipt.mailbox_id
           and address.id = receipt.primary_address_id
          where domain.id = 'legacy_default_v1_domain_v1'
            and domain.organization_id = 'legacy_default_v1'
            and domain.status = 'pending_verification'
            and domain.version = 1
            and domain.created_at = receipt.effective_at
            and domain.updated_at = receipt.effective_at
            and domain.canonical_domain = receipt.canonical_domain
            and receipt.raw_address_snapshot = address.address
            and receipt.normalized_address_snapshot = address.normalized_address
            and receipt.schema_version = 1)
      )
    )
  then 1
  else 0
end;

insert into app_mail_domain_claim_cutover
  (id, schema_version, initial_outcome, initial_status)
select 1, 1,
  case
    when not exists (select 1 from app_mailbox) then 'fresh-empty'
    when exists (select 1 from app_mailbox_administration_receipt
      where operation_kind = 'bootstrap-owner')
      then 'already-bootstrapped-awaiting-reconciliation'
    else 'legacy-awaiting-reconciliation'
  end,
  case when not exists (select 1 from app_mailbox)
    then 'awaiting-bootstrap' else 'awaiting-reconciliation' end
where (select cutover_was_present from app_mail_domain_claim_application) = 0;

drop table app_mail_domain_claim_preflight;

create trigger app_mail_domain_claim_cutover_no_insert
before insert on app_mail_domain_claim_cutover
begin
  select raise(abort, 'mail domain claim cutover is sealed');
end;

create trigger app_mail_domain_claim_cutover_no_update
before update on app_mail_domain_claim_cutover
begin
  select raise(abort, 'mail domain claim cutover is immutable');
end;

create trigger app_mail_domain_claim_cutover_no_delete
before delete on app_mail_domain_claim_cutover
begin
  select raise(abort, 'mail domain claim cutover is retained');
end;

create trigger app_mailbox_bootstrap_domain_intent_binding
before insert on app_mailbox_bootstrap_domain_intent
when new.canonicalization_profile_id is not 'mail-domain/ascii-alabel-input/uts46-nontransitional-std3/unicode-17/v1'
  or new.canonicalization_version is not 1
  or new.schema_version is not 1
  or not exists (select 1 from app_mailbox_administration_receipt receipt
    join app_mailbox_bootstrap_receipt_v2 bootstrap
      on bootstrap.operation_id = receipt.operation_id
    join app_mailbox_address address
      on address.mailbox_id = receipt.mailbox_id
     and address.id = 'primary' and address.is_primary = 1
     and address.enabled = 1 and address.version = 1
    where receipt.operation_id = new.operation_id
      and receipt.operation_kind = 'bootstrap-owner'
      and receipt.mailbox_id = 'primary'
      and receipt.result_created_at = address.created_at
      and receipt.result_created_at = address.updated_at
      and bootstrap.initial_address = address.normalized_address
      and substr(address.normalized_address,
        instr(address.normalized_address, '@') + 1) = new.canonical_domain
      and bootstrap.schema_version = 2)
begin
  select raise(abort, 'invalid canonical bootstrap domain intent');
end;

create trigger app_mailbox_bootstrap_domain_intent_no_replace
before insert on app_mailbox_bootstrap_domain_intent
when exists (select 1 from app_mailbox_bootstrap_domain_intent
  where operation_id = new.operation_id)
begin
  select raise(abort, 'canonical bootstrap domain intents are immutable');
end;

create trigger app_mailbox_bootstrap_domain_intent_no_update
before update on app_mailbox_bootstrap_domain_intent
begin
  select raise(abort, 'canonical bootstrap domain intents are immutable');
end;

create trigger app_mailbox_bootstrap_domain_intent_no_delete
before delete on app_mailbox_bootstrap_domain_intent
begin
  select raise(abort, 'canonical bootstrap domain intents are retained');
end;

create trigger app_mail_domain_claim_receipt_binding
before insert on app_mail_domain_claim_receipt
when new.domain_id is not 'legacy_default_v1_domain_v1'
  or new.organization_id is not 'legacy_default_v1'
  or new.mailbox_id is not 'primary'
  or new.primary_address_id is not 'primary'
  or new.schema_version is not 1
  or not exists (select 1 from app_mail_domain domain
    where domain.id = new.domain_id
      and domain.organization_id = new.organization_id
      and domain.canonical_domain = new.canonical_domain
      and domain.canonicalization_profile_id = new.canonicalization_profile_id
      and domain.canonicalization_version = new.canonicalization_version
      and domain.status = 'pending_verification'
      and domain.created_at = new.effective_at
      and domain.updated_at = new.effective_at
      and domain.version = 1)
  or not exists (select 1 from app_mailbox_address address
    where address.mailbox_id = new.mailbox_id
      and address.id = new.primary_address_id
      and address.is_primary = 1 and address.enabled = 1
      and address.version = 1
      and address.created_at = new.effective_at
      and address.updated_at = new.effective_at
      and address.address = new.raw_address_snapshot
      and address.normalized_address = new.normalized_address_snapshot)
  or not exists (select 1 from app_mailbox_legacy_organization_assignment
    where mailbox_id = new.mailbox_id
      and organization_id = new.organization_id
      and effective_at = new.effective_at and schema_version = 1)
  or (new.source = 'fresh-bootstrap' and not (
    exists (select 1 from app_mailbox_administration_receipt receipt
      join app_administrative_audit_event audit
        on audit.operation_id = receipt.operation_id
      where receipt.operation_id = new.source_bootstrap_operation_id
        and audit.event_id = new.source_audit_event_id
        and receipt.operation_kind = 'bootstrap-owner'
        and receipt.result_created_at = new.effective_at
        and audit.action = 'mailbox.owner-bootstrap'
        and audit.outcome = 'succeeded'
        and audit.occurred_at = new.effective_at)
    and (
      exists (select 1 from app_mailbox_bootstrap_domain_intent intent
        where intent.operation_id = new.source_bootstrap_operation_id
          and intent.canonical_domain = new.canonical_domain)
      or (not exists (select 1 from app_mailbox_bootstrap_domain_intent
            where operation_id = new.source_bootstrap_operation_id)
        and new.raw_address_snapshot = new.normalized_address_snapshot
        and new.canonical_domain not like 'xn--%'
        and new.canonical_domain not like '%.xn--%')
    )
  ))
begin
  select raise(abort, 'invalid immutable mail domain claim receipt');
end;

create trigger app_mail_domain_claim_receipt_no_replace
before insert on app_mail_domain_claim_receipt
when exists (select 1 from app_mail_domain_claim_receipt)
begin
  select raise(abort, 'mail domain claim receipts are immutable');
end;

create trigger app_mail_domain_claim_receipt_no_update
before update on app_mail_domain_claim_receipt
begin
  select raise(abort, 'mail domain claim receipts are immutable');
end;

create trigger app_mail_domain_claim_receipt_no_delete
before delete on app_mail_domain_claim_receipt
begin
  select raise(abort, 'mail domain claim receipts are retained');
end;

create trigger app_mail_domain_reserved_claim_lifecycle_frozen
before update on app_mail_domain
when old.id = 'legacy_default_v1_domain_v1'
begin
  select raise(abort, 'reserved legacy mail domain lifecycle is frozen until ORG-016');
end;

-- ORG-012 must atomically replace this staging/trigger protocol while retaining
-- the cutover, canonical intent, and claim receipt.
create trigger app_mail_domain_claim_from_bootstrap_audit
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
  and exists (select 1 from app_mailbox_administration_receipt
    where operation_id = new.operation_id
      and operation_kind = 'bootstrap-owner')
begin
  select case when exists (select 1 from app_mail_domain)
    or exists (select 1 from app_mail_domain_claim_receipt)
  then raise(abort, 'preexisting mail domain claim requires escalation') end;

  select case when not exists (
    select 1
    from app_mailbox_administration_receipt receipt
    join app_mailbox_address address
      on address.mailbox_id = receipt.mailbox_id
     and address.id = 'primary' and address.is_primary = 1
     and address.enabled = 1 and address.version = 1
    join app_mailbox_legacy_organization_assignment ancestry
      on ancestry.mailbox_id = receipt.mailbox_id
     and ancestry.organization_id = 'legacy_default_v1'
     and ancestry.effective_at = address.created_at
     and ancestry.schema_version = 1
    where receipt.operation_id = new.operation_id
      and receipt.operation_kind = 'bootstrap-owner'
      and receipt.mailbox_id = 'primary'
      and receipt.expected_version is null
      and receipt.result_mailbox_id = 'primary'
      and receipt.result_created_at = new.occurred_at
      and receipt.result_updated_at = new.occurred_at
      and receipt.committed_at = new.occurred_at
      and receipt.result_version = 1 and receipt.schema_version = 1
      and address.created_at = new.occurred_at
      and address.updated_at = new.occurred_at
      and (
        exists (select 1 from app_mailbox_bootstrap_domain_intent intent
          where intent.operation_id = new.operation_id
            and intent.canonical_domain = substr(address.normalized_address,
              instr(address.normalized_address, '@') + 1)
            and intent.canonicalization_profile_id = 'mail-domain/ascii-alabel-input/uts46-nontransitional-std3/unicode-17/v1'
            and intent.canonicalization_version = 1
            and intent.schema_version = 1)
        or (
          not exists (select 1 from app_mailbox_bootstrap_domain_intent
            where operation_id = new.operation_id)
          and address.address = address.normalized_address
          and substr(address.normalized_address,
            instr(address.normalized_address, '@') + 1)
              = lower(substr(address.normalized_address,
                instr(address.normalized_address, '@') + 1))
          and length(cast(substr(address.normalized_address,
            instr(address.normalized_address, '@') + 1) as blob))
              = length(substr(address.normalized_address,
                instr(address.normalized_address, '@') + 1))
          and substr(address.normalized_address,
            instr(address.normalized_address, '@') + 1)
              not glob '*[^a-z0-9.-]*'
          and substr(address.normalized_address,
            instr(address.normalized_address, '@') + 1) not like 'xn--%'
          and substr(address.normalized_address,
            instr(address.normalized_address, '@') + 1) not like '%.xn--%'
        )
      )
  ) then raise(abort, 'bootstrap domain is not safely canonical') end;

  insert into app_mail_domain (
    id, organization_id, canonical_domain, canonicalization_profile_id,
    canonicalization_version, status, created_at, updated_at, version
  )
  select 'legacy_default_v1_domain_v1', 'legacy_default_v1',
    coalesce(intent.canonical_domain,
      substr(address.normalized_address,
        instr(address.normalized_address, '@') + 1)),
    'mail-domain/ascii-alabel-input/uts46-nontransitional-std3/unicode-17/v1',
    1, 'pending_verification', address.created_at, address.created_at, 1
  from app_mailbox_address address
  left join app_mailbox_bootstrap_domain_intent intent
    on intent.operation_id = new.operation_id
  where address.mailbox_id = 'primary' and address.id = 'primary';

  insert into app_mail_domain_claim_receipt (
    domain_id, organization_id, mailbox_id, primary_address_id,
    raw_address_snapshot, normalized_address_snapshot, canonical_domain,
    canonicalization_profile_id, canonicalization_version, source,
    effective_at, source_bootstrap_operation_id, source_audit_event_id,
    schema_version
  )
  select domain.id, domain.organization_id, address.mailbox_id, address.id,
    address.address, address.normalized_address, domain.canonical_domain,
    domain.canonicalization_profile_id, domain.canonicalization_version,
    'fresh-bootstrap', address.created_at, new.operation_id, new.event_id, 1
  from app_mail_domain domain
  join app_mailbox_address address
    on address.mailbox_id = 'primary' and address.id = 'primary'
  where domain.id = 'legacy_default_v1_domain_v1';

  select case when not exists (select 1
    from app_mail_domain domain
    join app_mail_domain_claim_receipt receipt
      on receipt.domain_id = domain.id
    where domain.id = 'legacy_default_v1_domain_v1'
      and domain.status = 'pending_verification' and domain.version = 1
      and receipt.source = 'fresh-bootstrap'
      and receipt.source_bootstrap_operation_id = new.operation_id
      and receipt.source_audit_event_id = new.event_id)
  then raise(abort, 'fresh mail domain claim materialization failed') end;
end;

insert into app_mail_domain_claim_trigger_manifest
  (id, schema_version, trigger_sql_json)
select 1, 1, json_group_array(sql)
from (
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
      'app_mail_domain_reserved_claim_lifecycle_frozen')
  order by name
)
having (select manifest_was_present
  from app_mail_domain_claim_application) = 0;

create temp table app_mail_domain_claim_postflight (
  valid integer not null check (valid = 1)
);

insert into app_mail_domain_claim_postflight (valid)
select case when
  (select count(*) from app_mail_domain_claim_trigger_manifest) = 1
  and (select trigger_sql_json from app_mail_domain_claim_trigger_manifest
    where id = 1 and schema_version = 1)
    = (select json_group_array(sql) from (
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
          'app_mail_domain_reserved_claim_lifecycle_frozen')
      order by name))
then 1 else 0 end;

drop table app_mail_domain_claim_postflight;
drop table app_mail_domain_claim_application;
