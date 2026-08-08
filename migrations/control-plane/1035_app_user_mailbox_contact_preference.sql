create table app_user_mailbox_contact_preference (
  organization_id text not null,
  mailbox_id text not null,
  user_id text not null,
  visibility text not null default 'safe',
  all_participants_enabled_at integer,
  created_at integer not null,
  updated_at integer not null,
  version integer not null default 1,
  constraint app_user_mailbox_contact_preference_pkey
    primary key (mailbox_id, user_id),
  constraint app_user_mailbox_contact_preference_mailbox_fk
    foreign key (organization_id, mailbox_id)
    references app_mailbox (organization_id, id)
    on update restrict on delete restrict,
  constraint app_user_mailbox_contact_preference_user_fk
    foreign key (user_id) references auth_user (id)
    on update restrict on delete restrict,
  constraint app_user_mailbox_contact_preference_visibility_check
    check (visibility in ('safe', 'all-participants')),
  constraint app_user_mailbox_contact_preference_enabled_check
    check (
      (visibility = 'safe' and all_participants_enabled_at is null)
      or (visibility = 'all-participants'
        and typeof(all_participants_enabled_at) = 'integer'
        and all_participants_enabled_at between 0 and 9007199254740991)
    ),
  constraint app_user_mailbox_contact_preference_created_check
    check (typeof(created_at) = 'integer' and created_at between 0 and 9007199254740991),
  constraint app_user_mailbox_contact_preference_updated_check
    check (typeof(updated_at) = 'integer' and updated_at between created_at and 9007199254740991),
  constraint app_user_mailbox_contact_preference_version_check
    check (typeof(version) = 'integer' and version >= 1)
);

create index app_user_mailbox_contact_preference_user_idx
  on app_user_mailbox_contact_preference (user_id, mailbox_id);
