create table if not exists app_organization_member (
  id text not null,
  organization_id text not null,
  user_id text not null,
  status text not null default 'active',
  created_at integer not null,
  updated_at integer not null,
  suspended_at integer,
  revoked_at integer,
  version integer not null default 1,
  constraint app_organization_member_pkey primary key (id),
  constraint app_organization_member_organization_fk
    foreign key (organization_id) references app_organization (id)
      on update restrict on delete restrict,
  constraint app_organization_member_user_fk
    foreign key (user_id) references auth_user (id)
      on update restrict on delete restrict,
  constraint app_organization_member_id_check
    check (
      typeof(id) = 'text'
      and length(id) between 1 and 128
      and length(cast(id as blob)) = length(id)
      and id not glob '*[^A-Za-z0-9_-]*'
    ),
  constraint app_organization_member_organization_id_check
    check (typeof(organization_id) = 'text' and length(organization_id) > 0),
  constraint app_organization_member_user_id_check
    check (typeof(user_id) = 'text' and length(user_id) > 0),
  constraint app_organization_member_status_check
    check (
      typeof(status) = 'text'
      and status in ('active', 'suspended', 'revoked')
    ),
  constraint app_organization_member_created_at_check
    check (
      typeof(created_at) = 'integer'
      and created_at between 0 and 9007199254740991
    ),
  constraint app_organization_member_updated_at_check
    check (
      typeof(updated_at) = 'integer'
      and updated_at between created_at and 9007199254740991
    ),
  constraint app_organization_member_suspended_at_check
    check (
      suspended_at is null
      or (
        typeof(suspended_at) = 'integer'
        and suspended_at between created_at and 9007199254740991
      )
    ),
  constraint app_organization_member_revoked_at_check
    check (
      revoked_at is null
      or (
        typeof(revoked_at) = 'integer'
        and revoked_at between created_at and 9007199254740991
      )
    ),
  constraint app_organization_member_version_check
    check (
      typeof(version) = 'integer'
      and version between 1 and 9007199254740991
    ),
  constraint app_organization_member_lifecycle_check
    check (
      (
        status = 'active'
        and suspended_at is null
        and revoked_at is null
      )
      or (
        status = 'suspended'
        and suspended_at is updated_at
        and revoked_at is null
      )
      or (
        status = 'revoked'
        and revoked_at is updated_at
        and (
          suspended_at is null
          or suspended_at between created_at and revoked_at
        )
      )
    )
);

create unique index if not exists app_organization_member_current_pair_idx
  on app_organization_member (organization_id, user_id)
  where status in ('active', 'suspended');

create index if not exists app_organization_member_user_status_org_idx
  on app_organization_member (user_id, status, organization_id, id);

create index if not exists app_organization_member_org_status_idx
  on app_organization_member (organization_id, status, id);

create trigger if not exists app_organization_member_insert_contract
before insert on app_organization_member
when new.status is not 'active'
  or new.version is not 1
  or new.created_at is not new.updated_at
  or new.suspended_at is not null
  or new.revoked_at is not null
begin
  select raise(abort, 'organization membership must start active at version 1');
end;

create trigger if not exists app_organization_member_core_immutable
before update of id, organization_id, user_id, created_at
on app_organization_member
when old.id is not new.id
  or old.organization_id is not new.organization_id
  or old.user_id is not new.user_id
  or old.created_at is not new.created_at
begin
  select raise(abort, 'organization membership core fields are immutable');
end;

create trigger if not exists app_organization_member_no_delete
before delete on app_organization_member
begin
  select raise(abort, 'organization memberships are retained');
end;

create trigger if not exists app_organization_member_no_replace
before insert on app_organization_member
when exists (
  select 1 from app_organization_member where id = new.id
)
begin
  select raise(abort, 'organization membership identifiers are immutable and never reused');
end;

create trigger if not exists app_organization_member_insert_epoch_guard
before insert on app_organization_member
begin
  select case when exists (
    select 1
    from app_organization_member
    where organization_id = new.organization_id
      and user_id = new.user_id
      and status in ('active', 'suspended')
  ) then raise(abort, 'current organization membership must be transitioned exactly') end;
  select case when new.created_at < (
    select max(revoked_at)
    from app_organization_member
    where organization_id = new.organization_id
      and user_id = new.user_id
  ) then raise(abort, 'organization membership epoch predates prior revocation') end;
end;

create trigger if not exists app_organization_member_update_lifecycle
before update on app_organization_member
when old.status is not new.status
  or old.updated_at is not new.updated_at
  or old.suspended_at is not new.suspended_at
  or old.revoked_at is not new.revoked_at
  or old.version is not new.version
begin
  select case when old.status is new.status
    or new.version <> old.version + 1
    or new.updated_at < old.updated_at
    or not (
      (
        old.status = 'active'
        and new.status = 'suspended'
        and new.suspended_at is new.updated_at
        and new.revoked_at is null
      )
      or (
        old.status = 'suspended'
        and new.status = 'active'
        and new.suspended_at is null
        and new.revoked_at is null
      )
      or (
        old.status = 'active'
        and new.status = 'revoked'
        and new.suspended_at is null
        and new.revoked_at is new.updated_at
      )
      or (
        old.status = 'suspended'
        and new.status = 'revoked'
        and new.suspended_at is old.suspended_at
        and new.revoked_at is new.updated_at
      )
    )
    then raise(abort, 'invalid organization membership lifecycle update') end;
end;
