create table if not exists app_auth_email_outbox (
  id text primary key,
  created_at integer not null,
  from_json text,
  to_json text not null,
  cc_json text,
  bcc_json text,
  reply_to_json text,
  subject text not null,
  text_body text,
  html_body text,
  headers_json text not null default '{}',
  constraint app_auth_email_outbox_has_body
    check (text_body is not null or html_body is not null)
);

create index if not exists app_auth_email_outbox_created_at_idx
  on app_auth_email_outbox (created_at);
