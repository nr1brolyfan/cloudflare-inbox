create table if not exists app_organization (
  id text not null,
  status text not null default 'active',
  created_at integer not null,
  updated_at integer not null,
  version integer not null default 1,
  constraint app_organization_pkey primary key (id),
  constraint app_organization_id_check
    check (
      typeof(id) = 'text'
      and length(id) between 1 and 128
      and length(cast(id as blob)) = length(id)
      and id not glob '*[^A-Za-z0-9_-]*'
    ),
  constraint app_organization_status_check
    check (status in ('active', 'suspended')),
  constraint app_organization_created_at_check
    check (
      typeof(created_at) = 'integer'
      and created_at between 0 and 9007199254740991
    ),
  constraint app_organization_updated_at_check
    check (
      typeof(updated_at) = 'integer'
      and updated_at between created_at and 9007199254740991
    ),
  constraint app_organization_version_check
    check (
      typeof(version) = 'integer'
      and version between 1 and 9007199254740991
    )
);

create index if not exists app_organization_status_idx
  on app_organization (status, id);

create trigger if not exists app_organization_insert_contract
before insert on app_organization
when new.status is not 'active'
  or new.version is not 1
  or new.created_at is not new.updated_at
begin
  select raise(abort, 'organization must start active at version 1');
end;

create trigger if not exists app_organization_identity_immutable
before update of id, created_at on app_organization
when old.id is not new.id or old.created_at is not new.created_at
begin
  select raise(abort, 'organization identity and creation time are immutable');
end;

create trigger if not exists app_organization_no_delete
before delete on app_organization
begin
  select raise(abort, 'organizations are retained');
end;

create trigger if not exists app_organization_no_replace
before insert on app_organization
when exists (
  select 1 from app_organization where id = new.id
)
begin
  select raise(abort, 'organization identifiers are immutable and never reused');
end;

create trigger if not exists app_organization_update_lifecycle
before update on app_organization
when old.status is not new.status
  or old.updated_at is not new.updated_at
  or old.version is not new.version
begin
  select case when new.version <> old.version + 1
    or new.updated_at < old.updated_at
    then raise(abort, 'invalid organization lifecycle update') end;
end;
