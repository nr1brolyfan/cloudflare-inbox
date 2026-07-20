create table if not exists app_ai_tool_audit (
  id text primary key
    check (
      length(id) = 85
      and substr(id, 1, 21) = 'ai-tool-audit-sha256:'
      and substr(id, 22) not glob '*[^0-9a-f]*'
    ),
  principal_type text not null
    check (length(principal_type) between 1 and 64),
  principal_id text not null
    check (length(principal_id) between 1 and 256),
  mailbox_id text not null
    check (length(mailbox_id) between 1 and 128),
  source text not null
    check (source = 'interactive-session'),
  run_id text not null
    check (length(run_id) between 1 and 128),
  call_id text not null
    check (length(call_id) between 1 and 128),
  tool_name text not null
    check (length(tool_name) between 1 and 64),
  tool_kind text not null
    check (tool_kind in ('mutation', 'read', 'unknown')),
  outcome text not null
    check (outcome in ('failed', 'rejected', 'succeeded')),
  reason text not null
    check (length(reason) between 1 and 64),
  recorded_at integer not null
    check (recorded_at >= 0),
  retain_until integer not null
    check (retain_until > recorded_at)
);

-- Indexed for a later retention job; this migration does not delete audit rows.
create index if not exists app_ai_tool_audit_retention_idx
  on app_ai_tool_audit (retain_until);

create index if not exists app_ai_tool_audit_mailbox_time_idx
  on app_ai_tool_audit (mailbox_id, recorded_at desc);
