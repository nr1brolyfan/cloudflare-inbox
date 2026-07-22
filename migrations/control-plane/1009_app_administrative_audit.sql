create table if not exists app_administrative_audit_event (
  storage_id integer primary key autoincrement,
  event_id text not null unique
    check (
      length(event_id) = 83
      and substr(event_id, 1, 19) = 'admin-audit-sha256:'
      and substr(event_id, 20) not glob '*[^0-9a-f]*'
    ),
  schema_version integer not null check (schema_version >= 1),
  event_version integer not null check (event_version >= 1),
  operation_id text not null
    check (
      length(operation_id) = 36
      and operation_id = lower(trim(operation_id))
      and substr(operation_id, 9, 1) = '-'
      and substr(operation_id, 14, 1) = '-'
      and substr(operation_id, 15, 1) = '4'
      and substr(operation_id, 19, 1) = '-'
      and substr(operation_id, 20, 1) in ('8', '9', 'a', 'b')
      and substr(operation_id, 24, 1) = '-'
      and length(replace(operation_id, '-', '')) = 32
      and replace(operation_id, '-', '') not glob '*[^0-9a-f]*'
    ),
  action text not null
    check (
      length(action) between 3 and 128
      and action = lower(trim(action))
      and action not glob '*[^a-z0-9._-]*'
    ),
  outcome text not null check (outcome in ('succeeded', 'rejected', 'failed')),
  actor_type text not null check (actor_type in ('user', 'system', 'service')),
  actor_id text not null
    check (length(actor_id) between 1 and 256 and actor_id = trim(actor_id)),
  tenant_scope_type text not null check (tenant_scope_type in ('global', 'legacy-mailbox')),
  tenant_scope_id text not null
    check (length(tenant_scope_id) between 1 and 128 and tenant_scope_id = trim(tenant_scope_id)),
  resource_type text not null
    check (resource_type in ('mailbox', 'external-recovery-identity')),
  resource_id text not null
    check (length(resource_id) between 1 and 128 and resource_id = trim(resource_id)),
  request_id text,
  correlation_id text,
  reason_code text not null
    check (
      length(reason_code) between 1 and 64
      and reason_code = lower(trim(reason_code))
      and reason_code not glob '*[^a-z0-9._-]*'
    ),
  change_type text not null
    check (
      length(change_type) between 3 and 64
      and change_type = lower(trim(change_type))
      and change_type not glob '*[^a-z0-9._-]*'
    ),
  resource_version_before integer check (resource_version_before is null or resource_version_before >= 1),
  resource_version_after integer check (resource_version_after is null or resource_version_after >= 1),
  occurred_at integer not null check (occurred_at >= 0),
  check (
    (request_id is null and correlation_id is null)
    or (
      request_id is not null
      and correlation_id is not null
      and length(request_id) = 36
      and length(correlation_id) = 36
      and request_id = lower(trim(request_id))
      and correlation_id = lower(trim(correlation_id))
    )
  ),
  check (
    (action = 'mailbox.owner-bootstrap'
      and outcome = 'succeeded'
      and tenant_scope_type = 'legacy-mailbox'
      and tenant_scope_id = resource_id
      and resource_type = 'mailbox'
      and reason_code = 'owner-bootstrap'
      and change_type = 'mailbox-bootstrapped'
      and resource_version_before is null
      and resource_version_after = 1)
    or (action = 'mailbox.rename'
      and outcome = 'succeeded'
      and tenant_scope_type = 'legacy-mailbox'
      and tenant_scope_id = resource_id
      and resource_type = 'mailbox'
      and reason_code = 'mailbox-renamed'
      and change_type = 'mailbox-renamed'
      and resource_version_before >= 1
      and resource_version_after = resource_version_before + 1)
    or (action = 'external-recovery-identity.enroll'
      and outcome = 'succeeded'
      and tenant_scope_type = 'global'
      and tenant_scope_id = 'global'
      and resource_type = 'external-recovery-identity'
      and reason_code = 'recovery-enrolled'
      and change_type = 'external-recovery-identity-enrolled'
      and resource_version_before is null
      and resource_version_after = 1)
    or (action = 'external-recovery-identity.verify'
      and outcome = 'succeeded'
      and tenant_scope_type = 'global'
      and tenant_scope_id = 'global'
      and resource_type = 'external-recovery-identity'
      and reason_code = 'recovery-verified'
      and change_type = 'external-recovery-identity-verified'
      and resource_version_before >= 1
      and resource_version_after = resource_version_before + 1)
    or (action = 'external-recovery-identity.revoke'
      and outcome = 'succeeded'
      and tenant_scope_type = 'global'
      and tenant_scope_id = 'global'
      and resource_type = 'external-recovery-identity'
      and reason_code = 'recovery-revoked'
      and change_type = 'external-recovery-identity-revoked'
      and resource_version_before >= 1
      and resource_version_after = resource_version_before + 1)
  )
);

create index if not exists app_administrative_audit_operation_idx
  on app_administrative_audit_event (operation_id, storage_id);

create index if not exists app_administrative_audit_tenant_time_idx
  on app_administrative_audit_event (
    tenant_scope_type, tenant_scope_id, occurred_at desc, storage_id desc
  );

create index if not exists app_administrative_audit_actor_time_idx
  on app_administrative_audit_event (
    actor_type, actor_id, occurred_at desc, storage_id desc
  );

create index if not exists app_administrative_audit_resource_time_idx
  on app_administrative_audit_event (
    resource_type, resource_id, occurred_at desc, storage_id desc
  );

create index if not exists app_administrative_audit_action_outcome_time_idx
  on app_administrative_audit_event (
    action, outcome, occurred_at desc, storage_id desc
  );

create trigger if not exists app_administrative_audit_event_no_update
before update on app_administrative_audit_event
begin
  select raise(abort, 'administrative audit events are append-only');
end;

create trigger if not exists app_administrative_audit_event_no_replace
before insert on app_administrative_audit_event
when exists (
  select 1
    from app_administrative_audit_event
   where storage_id = new.storage_id or event_id = new.event_id
)
begin
  select raise(abort, 'administrative audit events are append-only');
end;

create trigger if not exists app_administrative_audit_event_no_delete
before delete on app_administrative_audit_event
begin
  select raise(abort, 'administrative audit events are retained');
end;
