-- Folder IDs are local to a mailbox. Legacy bare folder scopes cannot be
-- assigned to a mailbox unambiguously, so fail closed and require regranting.
delete from auth_permission_grant
where scope_type = 'folder';

delete from auth_role_grant
where scope_type = 'folder';
