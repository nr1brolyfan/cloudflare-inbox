create table if not exists app_authorization_guard (
  nonce text primary key
    check (length(nonce) between 1 and 128)
);

create unique index if not exists app_mailbox_singleton_idx
  on app_mailbox ((1));
