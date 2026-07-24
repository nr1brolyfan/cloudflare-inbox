create table if not exists app_mail_domain (
  id text not null,
  organization_id text not null,
  canonical_domain text not null,
  canonicalization_profile_id text not null,
  canonicalization_version integer not null default 1,
  status text not null default 'pending_verification',
  created_at integer not null,
  updated_at integer not null,
  version integer not null default 1,
  constraint app_mail_domain_pkey primary key (id),
  constraint app_mail_domain_organization_fk
    foreign key (organization_id) references app_organization (id)
      on update restrict on delete restrict,
  constraint app_mail_domain_id_check
    check (
      typeof(id) = 'text'
      and length(id) between 1 and 128
      and length(cast(id as blob)) = length(id)
      and id not glob '*[^A-Za-z0-9_-]*'
    ),
  constraint app_mail_domain_organization_id_check
    check (typeof(organization_id) = 'text' and length(organization_id) > 0),
  constraint app_mail_domain_canonical_domain_check
    check (
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
      and substr(canonical_domain, instr(canonical_domain, '.') + 1) <> ''
    ),
  constraint app_mail_domain_profile_check
    check (
      typeof(canonicalization_profile_id) = 'text'
      and canonicalization_profile_id = 'mail-domain/ascii-alabel-input/uts46-nontransitional-std3/unicode-17/v1'
    ),
  constraint app_mail_domain_canonicalization_version_check
    check (
      typeof(canonicalization_version) = 'integer'
      and canonicalization_version = 1
    ),
  constraint app_mail_domain_status_check
    check (
      typeof(status) = 'text'
      and status in (
        'pending_verification', 'verified', 'active', 'suspended', 'retired'
      )
    ),
  constraint app_mail_domain_created_at_check
    check (
      typeof(created_at) = 'integer'
      and created_at between 0 and 9007199254740991
    ),
  constraint app_mail_domain_updated_at_check
    check (
      typeof(updated_at) = 'integer'
      and updated_at between created_at and 9007199254740991
    ),
  constraint app_mail_domain_version_check
    check (
      typeof(version) = 'integer'
      and version between 1 and 9007199254740991
    )
);

create unique index if not exists app_mail_domain_current_canonical_idx
  on app_mail_domain (canonical_domain)
  where status <> 'retired';

create index if not exists app_mail_domain_organization_status_idx
  on app_mail_domain (organization_id, status, id);

create index if not exists app_mail_domain_canonical_history_idx
  on app_mail_domain (canonical_domain, status, updated_at, id);

create trigger if not exists app_mail_domain_insert_contract
before insert on app_mail_domain
when new.status is not 'pending_verification'
  or new.canonicalization_profile_id is not 'mail-domain/ascii-alabel-input/uts46-nontransitional-std3/unicode-17/v1'
  or new.canonicalization_version is not 1
  or new.version is not 1
  or new.created_at is not new.updated_at
begin
  select raise(abort, 'mail domain must start pending at canonicalization version 1');
end;

create trigger if not exists app_mail_domain_label_grammar_insert
before insert on app_mail_domain
begin
  select case when exists (
    with recursive labels(label, rest) as (
      values ('', new.canonical_domain || '.')
      union all
      select substr(rest, 1, instr(rest, '.') - 1),
             substr(rest, instr(rest, '.') + 1)
      from labels
      where rest <> ''
    )
    select 1
    from labels
    where (label <> '' and length(label) not between 1 and 63)
      or (substr(label, 3, 2) = '--' and substr(label, 1, 4) <> 'xn--')
      or (rest = '' and label <> '' and label not glob '*[^0-9]*')
  ) then raise(abort, 'mail domain labels violate canonical DNS grammar') end;
end;

create trigger if not exists app_mail_domain_core_immutable
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
  select raise(abort, 'mail domain core fields are immutable');
end;

create trigger if not exists app_mail_domain_no_delete
before delete on app_mail_domain
begin
  select raise(abort, 'mail domains are retained');
end;

create trigger if not exists app_mail_domain_no_replace
before insert on app_mail_domain
when exists (select 1 from app_mail_domain where id = new.id)
begin
  select raise(abort, 'mail domain identifiers are immutable and never reused');
end;

create trigger if not exists app_mail_domain_insert_epoch_guard
before insert on app_mail_domain
begin
  select case when exists (
    select 1
    from app_mail_domain
    where canonical_domain = new.canonical_domain
      and status <> 'retired'
  ) then raise(abort, 'canonical mail domain already has a current claim') end;
  select case when new.created_at < (
    select max(updated_at)
    from app_mail_domain
    where canonical_domain = new.canonical_domain
      and status = 'retired'
  ) then raise(abort, 'mail domain epoch predates prior retirement') end;
end;

create trigger if not exists app_mail_domain_update_lifecycle
before update on app_mail_domain
when old.status is not new.status
  or old.updated_at is not new.updated_at
  or old.version is not new.version
begin
  select case when old.status is new.status
    or new.version <> old.version + 1
    or new.updated_at < old.updated_at
    or not (
      (old.status = 'pending_verification' and new.status in ('verified', 'retired'))
      or (old.status = 'verified' and new.status in ('active', 'pending_verification', 'retired'))
      or (old.status = 'active' and new.status in ('suspended', 'pending_verification', 'retired'))
      or (old.status = 'suspended' and new.status in ('active', 'pending_verification', 'retired'))
    )
    then raise(abort, 'invalid mail domain lifecycle update') end;
end;
