create table if not exists app_mailbox_address (
  mailbox_id text not null
    references app_mailbox (id) on delete cascade,
  id text not null
    check (length(id) between 1 and 128),
  address text not null
    check (length(address) between 3 and 320 and address = trim(address)),
  normalized_address text not null
    check (
      length(normalized_address) between 3 and 320
      and normalized_address = trim(normalized_address)
    ),
  display_name text,
  is_primary integer not null default 0
    check (is_primary in (0, 1)),
  enabled integer not null default 1
    check (enabled in (0, 1)),
  created_at integer not null
    check (created_at >= 0),
  updated_at integer not null
    check (updated_at >= created_at),
  version integer not null default 1
    check (version >= 1),
  primary key (mailbox_id, id),
  constraint app_mailbox_address_primary_enabled
    check (is_primary = 0 or enabled = 1)
);

create unique index if not exists app_mailbox_address_route_idx
  on app_mailbox_address (normalized_address);

create unique index if not exists app_mailbox_address_primary_idx
  on app_mailbox_address (mailbox_id)
  where is_primary = 1;

insert into app_mailbox_address
  (mailbox_id, id, address, normalized_address, is_primary, enabled,
   created_at, updated_at)
select mailbox.id,
       'primary',
       identity.value,
       substr(identity.value, 1, instr(identity.value, '@'))
         || lower(substr(identity.value, instr(identity.value, '@') + 1)),
       1,
       1,
       mailbox.created_at,
       mailbox.updated_at
  from app_mailbox as mailbox
  join auth_user_identity as identity
    on identity.id = (
      select candidate.id
        from auth_user_identity as candidate
       where candidate.user_id = mailbox.created_by_user_id
         and candidate.scope_type = 'global'
         and candidate.scope_id in ('', 'global')
         and candidate.kind = 'email'
         and candidate.verified_at is not null
         and candidate.revoked_at is null
         and candidate.replaced_by_id is null
       order by candidate.is_primary_login desc,
                candidate.verified_at asc,
                candidate.id asc
       limit 1
    )
 where not exists (
   select 1
     from app_mailbox_address as address
    where address.mailbox_id = mailbox.id
 );
