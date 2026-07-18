create table if not exists app_dev_email_message (
  id text primary key not null,
  kind text not null,
  recipient text not null,
  message_json text not null,
  created_at integer not null,
  expires_at integer not null
);

create index if not exists app_dev_email_message_created_at_idx
  on app_dev_email_message (created_at desc);

create index if not exists app_dev_email_message_recipient_created_at_idx
  on app_dev_email_message (recipient, created_at desc);

drop table if exists app_auth_email_outbox;
