create temp table app_authorization_catalog_v2_preflight (
  valid integer not null check (valid = 1)
);

with expected(id, description, scope_type) as (values
  ('organization.read', 'Read an organization', 'organization'),
  ('organization.manage_settings', 'Manage organization settings', 'organization'),
  ('organization.manage_members', 'Manage organization members', 'organization'),
  ('organization.manage_domains', 'Manage organization domains', 'organization'),
  ('organization.manage_addresses', 'Manage organization addresses', 'organization'),
  ('organization.manage_mailboxes', 'Manage organization mailboxes', 'organization'),
  ('organization.read_audit', 'Read the organization audit log', 'organization'),
  ('organization.transfer_ownership', 'Transfer organization ownership', 'organization'),
  ('mailbox.read', 'Read a mailbox', 'mailbox'),
  ('mailbox.modify', 'Modify mailbox content', 'mailbox'),
  ('mailbox.send', 'Send mail from a mailbox', 'mailbox'),
  ('mailbox.send_from_shared_identity', 'Send from a shared mailbox identity', 'mailbox'),
  ('mailbox.manage_settings', 'Manage mailbox settings', 'mailbox'),
  ('mailbox.manage_members', 'Manage mailbox members', 'mailbox'),
  ('mailbox.export', 'Export mailbox data', 'mailbox'),
  ('message.read', 'Read mailbox messages', 'mailbox'),
  ('message.modify', 'Modify mailbox messages', 'mailbox'),
  ('draft.create', 'Create and edit drafts', 'mailbox'),
  ('draft.send', 'Send mailbox drafts', 'mailbox'),
  ('rule.manage', 'Manage mailbox rules', 'mailbox'),
  ('attachment.read', 'Read mailbox attachments', 'mailbox'),
  ('attachment.upload', 'Upload mailbox attachments', 'mailbox'),
  ('folder.read', 'Read a folder', 'folder'),
  ('folder.modify', 'Modify a folder', 'folder'),
  ('send_identity.use', 'Use a restricted send identity', 'send_identity')
), expected_role(id, description) as (values
  ('organization.owner', 'Full organization control'),
  ('organization.admin', 'Manage organization settings and resources'),
  ('organization.member', 'Read organization membership'),
  ('mailbox.owner', 'Full mailbox control'),
  ('mailbox.manager', 'Manage mailbox content, rules, and sending'),
  ('mailbox.editor', 'Read and organize content and create drafts'),
  ('mailbox.viewer', 'Read allowed mailbox or folder content')
), expected_mapping(role_id, permission_id, scope_type) as (values
  ('organization.owner', 'organization.read', 'organization'),
  ('organization.owner', 'organization.manage_settings', 'organization'),
  ('organization.owner', 'organization.manage_members', 'organization'),
  ('organization.owner', 'organization.manage_domains', 'organization'),
  ('organization.owner', 'organization.manage_addresses', 'organization'),
  ('organization.owner', 'organization.manage_mailboxes', 'organization'),
  ('organization.owner', 'organization.read_audit', 'organization'),
  ('organization.owner', 'organization.transfer_ownership', 'organization'),
  ('organization.admin', 'organization.read', 'organization'),
  ('organization.admin', 'organization.manage_settings', 'organization'),
  ('organization.admin', 'organization.manage_members', 'organization'),
  ('organization.admin', 'organization.manage_domains', 'organization'),
  ('organization.admin', 'organization.manage_addresses', 'organization'),
  ('organization.admin', 'organization.manage_mailboxes', 'organization'),
  ('organization.admin', 'organization.read_audit', 'organization'),
  ('organization.member', 'organization.read', 'organization'),
  ('mailbox.owner', 'mailbox.read', 'mailbox'),
  ('mailbox.owner', 'mailbox.modify', 'mailbox'),
  ('mailbox.owner', 'mailbox.send', 'mailbox'),
  ('mailbox.owner', 'mailbox.send_from_shared_identity', 'mailbox'),
  ('mailbox.owner', 'mailbox.manage_settings', 'mailbox'),
  ('mailbox.owner', 'mailbox.manage_members', 'mailbox'),
  ('mailbox.owner', 'mailbox.export', 'mailbox'),
  ('mailbox.owner', 'message.read', 'mailbox'),
  ('mailbox.owner', 'message.modify', 'mailbox'),
  ('mailbox.owner', 'draft.create', 'mailbox'),
  ('mailbox.owner', 'draft.send', 'mailbox'),
  ('mailbox.owner', 'rule.manage', 'mailbox'),
  ('mailbox.owner', 'attachment.read', 'mailbox'),
  ('mailbox.owner', 'attachment.upload', 'mailbox'),
  ('mailbox.owner', 'folder.read', 'folder'),
  ('mailbox.owner', 'folder.modify', 'folder'),
  ('mailbox.manager', 'mailbox.read', 'mailbox'),
  ('mailbox.manager', 'mailbox.modify', 'mailbox'),
  ('mailbox.manager', 'mailbox.send', 'mailbox'),
  ('mailbox.manager', 'mailbox.send_from_shared_identity', 'mailbox'),
  ('mailbox.manager', 'message.read', 'mailbox'),
  ('mailbox.manager', 'message.modify', 'mailbox'),
  ('mailbox.manager', 'draft.create', 'mailbox'),
  ('mailbox.manager', 'draft.send', 'mailbox'),
  ('mailbox.manager', 'rule.manage', 'mailbox'),
  ('mailbox.manager', 'attachment.read', 'mailbox'),
  ('mailbox.manager', 'attachment.upload', 'mailbox'),
  ('mailbox.manager', 'folder.read', 'folder'),
  ('mailbox.manager', 'folder.modify', 'folder'),
  ('mailbox.editor', 'mailbox.read', 'mailbox'),
  ('mailbox.editor', 'mailbox.modify', 'mailbox'),
  ('mailbox.editor', 'message.read', 'mailbox'),
  ('mailbox.editor', 'message.modify', 'mailbox'),
  ('mailbox.editor', 'draft.create', 'mailbox'),
  ('mailbox.editor', 'attachment.read', 'mailbox'),
  ('mailbox.editor', 'attachment.upload', 'mailbox'),
  ('mailbox.editor', 'folder.read', 'folder'),
  ('mailbox.editor', 'folder.modify', 'folder'),
  ('mailbox.viewer', 'mailbox.read', 'mailbox'),
  ('mailbox.viewer', 'message.read', 'mailbox'),
  ('mailbox.viewer', 'attachment.read', 'mailbox'),
  ('mailbox.viewer', 'folder.read', 'folder')
)
insert into app_authorization_catalog_v2_preflight (valid)
select case when
  exists (
    select 1
    from auth_permission_definition definition
    inner join expected on expected.id = definition.id
    where definition.description is not expected.description
      or definition.scope_type_present is not 1
      or definition.scope_type is not expected.scope_type
      or definition.created_at is not 0
      or definition.updated_at is not 0
      or definition.disabled_at is not null
      or definition.deleted_at is not null
  )
  or exists (
    select 1
    from auth_role_definition definition
    inner join expected_role on expected_role.id = definition.id
    where definition.description is not expected_role.description
      or definition.created_at is not 0
      or definition.updated_at is not 0
      or definition.disabled_at is not null
      or definition.deleted_at is not null
  )
  or exists (
    select 1
    from auth_role_permission mapping
    where mapping.role_id in (
      'organization.owner', 'organization.admin', 'organization.member',
      'mailbox.owner', 'mailbox.manager', 'mailbox.editor', 'mailbox.viewer'
    )
      and not exists (
        select 1
        from expected_mapping
        where expected_mapping.role_id = mapping.role_id
          and expected_mapping.permission_id = mapping.permission_id
          and mapping.scope_type_present = 1
          and expected_mapping.scope_type = mapping.scope_type
      )
  )
then 0 else 1 end;

drop table app_authorization_catalog_v2_preflight;

drop trigger if exists app_canonical_permission_definition_no_insert_replace;
drop trigger if exists app_canonical_permission_definition_no_update;
drop trigger if exists app_canonical_permission_definition_no_delete;
drop trigger if exists app_canonical_role_definition_no_insert_replace;
drop trigger if exists app_canonical_role_definition_no_update;
drop trigger if exists app_canonical_role_definition_no_delete;
drop trigger if exists app_canonical_role_permission_insert_contract;
drop trigger if exists app_canonical_role_permission_no_update;
drop trigger if exists app_canonical_role_permission_no_delete;

with catalog(id, description, scope_type) as (values
  ('organization.read', 'Read an organization', 'organization'),
  ('organization.manage_settings', 'Manage organization settings', 'organization'),
  ('organization.manage_members', 'Manage organization members', 'organization'),
  ('organization.manage_domains', 'Manage organization domains', 'organization'),
  ('organization.manage_addresses', 'Manage organization addresses', 'organization'),
  ('organization.manage_mailboxes', 'Manage organization mailboxes', 'organization'),
  ('organization.read_audit', 'Read the organization audit log', 'organization'),
  ('organization.transfer_ownership', 'Transfer organization ownership', 'organization'),
  ('mailbox.read', 'Read a mailbox', 'mailbox'),
  ('mailbox.modify', 'Modify mailbox content', 'mailbox'),
  ('mailbox.send', 'Send mail from a mailbox', 'mailbox'),
  ('mailbox.send_from_shared_identity', 'Send from a shared mailbox identity', 'mailbox'),
  ('mailbox.manage_settings', 'Manage mailbox settings', 'mailbox'),
  ('mailbox.manage_members', 'Manage mailbox members', 'mailbox'),
  ('mailbox.export', 'Export mailbox data', 'mailbox'),
  ('message.read', 'Read mailbox messages', 'mailbox'),
  ('message.modify', 'Modify mailbox messages', 'mailbox'),
  ('draft.create', 'Create and edit drafts', 'mailbox'),
  ('draft.send', 'Send mailbox drafts', 'mailbox'),
  ('rule.manage', 'Manage mailbox rules', 'mailbox'),
  ('attachment.read', 'Read mailbox attachments', 'mailbox'),
  ('attachment.upload', 'Upload mailbox attachments', 'mailbox'),
  ('folder.read', 'Read a folder', 'folder'),
  ('folder.modify', 'Modify a folder', 'folder'),
  ('send_identity.use', 'Use a restricted send identity', 'send_identity')
)
insert into auth_permission_definition (
  id, description, scope_type_present, scope_type, created_at, updated_at
)
select id, description, 1, scope_type, 0, 0
from catalog
where not exists (
  select 1 from auth_permission_definition where auth_permission_definition.id = catalog.id
);

with catalog(id, description) as (values
  ('organization.owner', 'Full organization control'),
  ('organization.admin', 'Manage organization settings and resources'),
  ('organization.member', 'Read organization membership'),
  ('mailbox.owner', 'Full mailbox control'),
  ('mailbox.manager', 'Manage mailbox content, rules, and sending'),
  ('mailbox.editor', 'Read and organize content and create drafts'),
  ('mailbox.viewer', 'Read allowed mailbox or folder content')
)
insert into auth_role_definition (id, description, created_at, updated_at)
select id, description, 0, 0
from catalog
where not exists (
  select 1 from auth_role_definition where auth_role_definition.id = catalog.id
);

with catalog(role_id, permission_id, scope_type) as (values
  ('organization.owner', 'organization.read', 'organization'),
  ('organization.owner', 'organization.manage_settings', 'organization'),
  ('organization.owner', 'organization.manage_members', 'organization'),
  ('organization.owner', 'organization.manage_domains', 'organization'),
  ('organization.owner', 'organization.manage_addresses', 'organization'),
  ('organization.owner', 'organization.manage_mailboxes', 'organization'),
  ('organization.owner', 'organization.read_audit', 'organization'),
  ('organization.owner', 'organization.transfer_ownership', 'organization'),
  ('organization.admin', 'organization.read', 'organization'),
  ('organization.admin', 'organization.manage_settings', 'organization'),
  ('organization.admin', 'organization.manage_members', 'organization'),
  ('organization.admin', 'organization.manage_domains', 'organization'),
  ('organization.admin', 'organization.manage_addresses', 'organization'),
  ('organization.admin', 'organization.manage_mailboxes', 'organization'),
  ('organization.admin', 'organization.read_audit', 'organization'),
  ('organization.member', 'organization.read', 'organization'),
  ('mailbox.owner', 'mailbox.read', 'mailbox'),
  ('mailbox.owner', 'mailbox.modify', 'mailbox'),
  ('mailbox.owner', 'mailbox.send', 'mailbox'),
  ('mailbox.owner', 'mailbox.send_from_shared_identity', 'mailbox'),
  ('mailbox.owner', 'mailbox.manage_settings', 'mailbox'),
  ('mailbox.owner', 'mailbox.manage_members', 'mailbox'),
  ('mailbox.owner', 'mailbox.export', 'mailbox'),
  ('mailbox.owner', 'message.read', 'mailbox'),
  ('mailbox.owner', 'message.modify', 'mailbox'),
  ('mailbox.owner', 'draft.create', 'mailbox'),
  ('mailbox.owner', 'draft.send', 'mailbox'),
  ('mailbox.owner', 'rule.manage', 'mailbox'),
  ('mailbox.owner', 'attachment.read', 'mailbox'),
  ('mailbox.owner', 'attachment.upload', 'mailbox'),
  ('mailbox.owner', 'folder.read', 'folder'),
  ('mailbox.owner', 'folder.modify', 'folder'),
  ('mailbox.manager', 'mailbox.read', 'mailbox'),
  ('mailbox.manager', 'mailbox.modify', 'mailbox'),
  ('mailbox.manager', 'mailbox.send', 'mailbox'),
  ('mailbox.manager', 'mailbox.send_from_shared_identity', 'mailbox'),
  ('mailbox.manager', 'message.read', 'mailbox'),
  ('mailbox.manager', 'message.modify', 'mailbox'),
  ('mailbox.manager', 'draft.create', 'mailbox'),
  ('mailbox.manager', 'draft.send', 'mailbox'),
  ('mailbox.manager', 'rule.manage', 'mailbox'),
  ('mailbox.manager', 'attachment.read', 'mailbox'),
  ('mailbox.manager', 'attachment.upload', 'mailbox'),
  ('mailbox.manager', 'folder.read', 'folder'),
  ('mailbox.manager', 'folder.modify', 'folder'),
  ('mailbox.editor', 'mailbox.read', 'mailbox'),
  ('mailbox.editor', 'mailbox.modify', 'mailbox'),
  ('mailbox.editor', 'message.read', 'mailbox'),
  ('mailbox.editor', 'message.modify', 'mailbox'),
  ('mailbox.editor', 'draft.create', 'mailbox'),
  ('mailbox.editor', 'attachment.read', 'mailbox'),
  ('mailbox.editor', 'attachment.upload', 'mailbox'),
  ('mailbox.editor', 'folder.read', 'folder'),
  ('mailbox.editor', 'folder.modify', 'folder'),
  ('mailbox.viewer', 'mailbox.read', 'mailbox'),
  ('mailbox.viewer', 'message.read', 'mailbox'),
  ('mailbox.viewer', 'attachment.read', 'mailbox'),
  ('mailbox.viewer', 'folder.read', 'folder')
)
insert into auth_role_permission (
  role_id, permission_id, scope_type_present, scope_type
)
select role_id, permission_id, 1, scope_type
from catalog
where not exists (
  select 1
  from auth_role_permission mapping
  where mapping.role_id = catalog.role_id
    and mapping.permission_id = catalog.permission_id
    and mapping.scope_type_present = 1
    and mapping.scope_type = catalog.scope_type
);

create trigger app_canonical_permission_definition_no_insert_replace
before insert on auth_permission_definition
when new.id in (
  'organization.read', 'organization.manage_settings', 'organization.manage_members',
  'organization.manage_domains', 'organization.manage_addresses',
  'organization.manage_mailboxes', 'organization.read_audit',
  'organization.transfer_ownership', 'mailbox.read', 'mailbox.modify',
  'mailbox.send', 'mailbox.send_from_shared_identity', 'mailbox.manage_settings',
  'mailbox.manage_members', 'mailbox.export', 'message.read', 'message.modify',
  'draft.create', 'draft.send', 'rule.manage', 'attachment.read',
  'attachment.upload', 'folder.read', 'folder.modify', 'send_identity.use'
)
and exists (select 1 from auth_permission_definition where id = new.id)
begin
  select raise(abort, 'canonical permission definitions are immutable');
end;

create trigger app_canonical_permission_definition_no_update
before update on auth_permission_definition
when old.id in (
  'organization.read', 'organization.manage_settings', 'organization.manage_members',
  'organization.manage_domains', 'organization.manage_addresses',
  'organization.manage_mailboxes', 'organization.read_audit',
  'organization.transfer_ownership', 'mailbox.read', 'mailbox.modify',
  'mailbox.send', 'mailbox.send_from_shared_identity', 'mailbox.manage_settings',
  'mailbox.manage_members', 'mailbox.export', 'message.read', 'message.modify',
  'draft.create', 'draft.send', 'rule.manage', 'attachment.read',
  'attachment.upload', 'folder.read', 'folder.modify', 'send_identity.use'
)
or new.id in (
  'organization.read', 'organization.manage_settings', 'organization.manage_members',
  'organization.manage_domains', 'organization.manage_addresses',
  'organization.manage_mailboxes', 'organization.read_audit',
  'organization.transfer_ownership', 'mailbox.read', 'mailbox.modify',
  'mailbox.send', 'mailbox.send_from_shared_identity', 'mailbox.manage_settings',
  'mailbox.manage_members', 'mailbox.export', 'message.read', 'message.modify',
  'draft.create', 'draft.send', 'rule.manage', 'attachment.read',
  'attachment.upload', 'folder.read', 'folder.modify', 'send_identity.use'
)
begin
  select raise(abort, 'canonical permission definitions are immutable');
end;

create trigger app_canonical_permission_definition_no_delete
before delete on auth_permission_definition
when old.id in (
  'organization.read', 'organization.manage_settings', 'organization.manage_members',
  'organization.manage_domains', 'organization.manage_addresses',
  'organization.manage_mailboxes', 'organization.read_audit',
  'organization.transfer_ownership', 'mailbox.read', 'mailbox.modify',
  'mailbox.send', 'mailbox.send_from_shared_identity', 'mailbox.manage_settings',
  'mailbox.manage_members', 'mailbox.export', 'message.read', 'message.modify',
  'draft.create', 'draft.send', 'rule.manage', 'attachment.read',
  'attachment.upload', 'folder.read', 'folder.modify', 'send_identity.use'
)
begin
  select raise(abort, 'canonical permission definitions are immutable');
end;

create trigger app_canonical_role_definition_no_insert_replace
before insert on auth_role_definition
when new.id in (
  'organization.owner', 'organization.admin', 'organization.member',
  'mailbox.owner', 'mailbox.manager', 'mailbox.editor', 'mailbox.viewer'
)
and exists (select 1 from auth_role_definition where id = new.id)
begin
  select raise(abort, 'canonical role definitions are immutable');
end;

create trigger app_canonical_role_definition_no_update
before update on auth_role_definition
when old.id in (
  'organization.owner', 'organization.admin', 'organization.member',
  'mailbox.owner', 'mailbox.manager', 'mailbox.editor', 'mailbox.viewer'
)
or new.id in (
  'organization.owner', 'organization.admin', 'organization.member',
  'mailbox.owner', 'mailbox.manager', 'mailbox.editor', 'mailbox.viewer'
)
begin
  select raise(abort, 'canonical role definitions are immutable');
end;

create trigger app_canonical_role_definition_no_delete
before delete on auth_role_definition
when old.id in (
  'organization.owner', 'organization.admin', 'organization.member',
  'mailbox.owner', 'mailbox.manager', 'mailbox.editor', 'mailbox.viewer'
)
begin
  select raise(abort, 'canonical role definitions are immutable');
end;

create trigger app_canonical_role_permission_insert_contract
before insert on auth_role_permission
when new.role_id in (
  'organization.owner', 'organization.admin', 'organization.member',
  'mailbox.owner', 'mailbox.manager', 'mailbox.editor', 'mailbox.viewer'
)
and (
  new.scope_type_present is not 1
  or not (
    (new.role_id = 'organization.owner'
      and new.scope_type = 'organization'
      and new.permission_id in (
        'organization.read', 'organization.manage_settings',
        'organization.manage_members', 'organization.manage_domains',
        'organization.manage_addresses', 'organization.manage_mailboxes',
        'organization.read_audit', 'organization.transfer_ownership'
      ))
    or (new.role_id = 'organization.admin'
      and new.scope_type = 'organization'
      and new.permission_id in (
        'organization.read', 'organization.manage_settings',
        'organization.manage_members', 'organization.manage_domains',
        'organization.manage_addresses', 'organization.manage_mailboxes',
        'organization.read_audit'
      ))
    or (new.role_id = 'organization.member'
      and new.scope_type = 'organization'
      and new.permission_id = 'organization.read')
    or (new.role_id = 'mailbox.owner' and (
      (new.scope_type = 'mailbox' and new.permission_id in (
        'mailbox.read', 'mailbox.modify', 'mailbox.send',
        'mailbox.send_from_shared_identity', 'mailbox.manage_settings',
        'mailbox.manage_members', 'mailbox.export', 'message.read',
        'message.modify', 'draft.create', 'draft.send', 'rule.manage',
        'attachment.read', 'attachment.upload'
      ))
      or (new.scope_type = 'folder'
        and new.permission_id in ('folder.read', 'folder.modify'))
    ))
    or (new.role_id = 'mailbox.manager' and (
      (new.scope_type = 'mailbox' and new.permission_id in (
        'mailbox.read', 'mailbox.modify', 'mailbox.send',
        'mailbox.send_from_shared_identity', 'message.read', 'message.modify',
        'draft.create', 'draft.send', 'rule.manage', 'attachment.read',
        'attachment.upload'
      ))
      or (new.scope_type = 'folder'
        and new.permission_id in ('folder.read', 'folder.modify'))
    ))
    or (new.role_id = 'mailbox.editor' and (
      (new.scope_type = 'mailbox' and new.permission_id in (
        'mailbox.read', 'mailbox.modify', 'message.read', 'message.modify',
        'draft.create', 'attachment.read', 'attachment.upload'
      ))
      or (new.scope_type = 'folder'
        and new.permission_id in ('folder.read', 'folder.modify'))
    ))
    or (new.role_id = 'mailbox.viewer' and (
      (new.scope_type = 'mailbox'
        and new.permission_id in ('mailbox.read', 'message.read', 'attachment.read'))
      or (new.scope_type = 'folder' and new.permission_id = 'folder.read')
    ))
  )
  or exists (
    select 1
    from auth_role_permission mapping
    where mapping.role_id = new.role_id
      and mapping.permission_id = new.permission_id
      and mapping.scope_type_present = new.scope_type_present
      and mapping.scope_type = new.scope_type
  )
)
begin
  select raise(abort, 'canonical role permission mapping violates the catalog');
end;

create trigger app_canonical_role_permission_no_update
before update on auth_role_permission
when old.role_id in (
  'organization.owner', 'organization.admin', 'organization.member',
  'mailbox.owner', 'mailbox.manager', 'mailbox.editor', 'mailbox.viewer'
)
or new.role_id in (
  'organization.owner', 'organization.admin', 'organization.member',
  'mailbox.owner', 'mailbox.manager', 'mailbox.editor', 'mailbox.viewer'
)
begin
  select raise(abort, 'canonical role permission mappings are immutable');
end;

create trigger app_canonical_role_permission_no_delete
before delete on auth_role_permission
when old.role_id in (
  'organization.owner', 'organization.admin', 'organization.member',
  'mailbox.owner', 'mailbox.manager', 'mailbox.editor', 'mailbox.viewer'
)
begin
  select raise(abort, 'canonical role permission mappings are immutable');
end;
