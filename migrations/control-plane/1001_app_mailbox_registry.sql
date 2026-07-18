create table if not exists app_mailbox (
  id text primary key
    check (length(id) between 1 and 128),
  display_name text not null
    check (length(display_name) between 1 and 200),
  status text not null default 'active'
    check (status in ('active', 'suspended', 'deleting', 'deleted')),
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
      (status = 'deleted' and deleted_at is not null)
      or (status <> 'deleted' and deleted_at is null)
    )
);

create index if not exists app_mailbox_active_idx
  on app_mailbox (status, id)
  where deleted_at is null;

create index if not exists app_mailbox_creator_idx
  on app_mailbox (created_by_user_id, created_at);

create table if not exists app_mailbox_member (
  mailbox_id text not null
    references app_mailbox (id) on delete cascade,
  user_id text not null
    check (length(user_id) between 1 and 128),
  created_at integer not null
    check (created_at >= 0),
  updated_at integer not null
    check (updated_at >= created_at),
  revoked_at integer
    check (revoked_at is null or revoked_at >= created_at),
  primary key (mailbox_id, user_id)
);

create index if not exists app_mailbox_member_user_active_idx
  on app_mailbox_member (user_id, mailbox_id)
  where revoked_at is null;

create table if not exists app_user_preference (
  user_id text primary key
    check (length(user_id) between 1 and 128),
  default_mailbox_id text
    references app_mailbox (id) on delete set null,
  settings_json text not null default '{}'
    check (
      length(settings_json) <= 65536
      and json_valid(settings_json)
      and json_type(settings_json) = 'object'
    ),
  created_at integer not null
    check (created_at >= 0),
  updated_at integer not null
    check (updated_at >= created_at),
  version integer not null default 1
    check (version >= 1)
);
