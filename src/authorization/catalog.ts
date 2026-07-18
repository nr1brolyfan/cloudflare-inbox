import * as AuthPermission from "@effect-auth/core/Permission";

export const MAILBOX_SCOPE_TYPE = "mailbox";
export const FOLDER_SCOPE_TYPE = "folder";

export const MailPermission = {
  attachmentRead: AuthPermission.PermissionId("attachment.read"),
  attachmentUpload: AuthPermission.PermissionId("attachment.upload"),
  draftCreate: AuthPermission.PermissionId("draft.create"),
  draftSend: AuthPermission.PermissionId("draft.send"),
  folderModify: AuthPermission.PermissionId("folder.modify"),
  folderRead: AuthPermission.PermissionId("folder.read"),
  mailboxExport: AuthPermission.PermissionId("mailbox.export"),
  mailboxManageMembers: AuthPermission.PermissionId("mailbox.manage_members"),
  mailboxManageSettings: AuthPermission.PermissionId("mailbox.manage_settings"),
  mailboxModify: AuthPermission.PermissionId("mailbox.modify"),
  mailboxRead: AuthPermission.PermissionId("mailbox.read"),
  mailboxSend: AuthPermission.PermissionId("mailbox.send"),
  messageModify: AuthPermission.PermissionId("message.modify"),
  messageRead: AuthPermission.PermissionId("message.read"),
  ruleManage: AuthPermission.PermissionId("rule.manage"),
} as const;

export const MailRole = {
  editor: AuthPermission.RoleId("editor"),
  manager: AuthPermission.RoleId("manager"),
  owner: AuthPermission.RoleId("owner"),
  viewer: AuthPermission.RoleId("viewer"),
} as const;

export const mailPermissionDefinitions = [
  {
    id: MailPermission.mailboxRead,
    description: "Read a mailbox",
    scopeType: MAILBOX_SCOPE_TYPE,
  },
  {
    id: MailPermission.mailboxModify,
    description: "Modify mailbox content",
    scopeType: MAILBOX_SCOPE_TYPE,
  },
  {
    id: MailPermission.mailboxSend,
    description: "Send mail from a mailbox",
    scopeType: MAILBOX_SCOPE_TYPE,
  },
  {
    id: MailPermission.mailboxManageSettings,
    description: "Manage mailbox settings",
    scopeType: MAILBOX_SCOPE_TYPE,
  },
  {
    id: MailPermission.mailboxManageMembers,
    description: "Manage mailbox members",
    scopeType: MAILBOX_SCOPE_TYPE,
  },
  {
    id: MailPermission.folderRead,
    description: "Read a folder",
    scopeType: FOLDER_SCOPE_TYPE,
  },
  {
    id: MailPermission.folderModify,
    description: "Modify a folder",
    scopeType: FOLDER_SCOPE_TYPE,
  },
  {
    id: MailPermission.messageRead,
    description: "Read mailbox messages",
    scopeType: MAILBOX_SCOPE_TYPE,
  },
  {
    id: MailPermission.messageModify,
    description: "Modify mailbox messages",
    scopeType: MAILBOX_SCOPE_TYPE,
  },
  {
    id: MailPermission.draftCreate,
    description: "Create and edit drafts",
    scopeType: MAILBOX_SCOPE_TYPE,
  },
  {
    id: MailPermission.draftSend,
    description: "Send mailbox drafts",
    scopeType: MAILBOX_SCOPE_TYPE,
  },
  {
    id: MailPermission.ruleManage,
    description: "Manage mailbox rules",
    scopeType: MAILBOX_SCOPE_TYPE,
  },
  {
    id: MailPermission.attachmentRead,
    description: "Read mailbox attachments",
    scopeType: MAILBOX_SCOPE_TYPE,
  },
  {
    id: MailPermission.attachmentUpload,
    description: "Upload mailbox attachments",
    scopeType: MAILBOX_SCOPE_TYPE,
  },
  {
    id: MailPermission.mailboxExport,
    description: "Export mailbox data",
    scopeType: MAILBOX_SCOPE_TYPE,
  },
] as const satisfies readonly AuthPermission.PermissionDefinition[];

export const mailRoleDefinitions = [
  { id: MailRole.owner, description: "Full mailbox control" },
  {
    id: MailRole.manager,
    description: "Manage mailbox content, rules, and sending",
  },
  {
    id: MailRole.editor,
    description: "Read and organize content and create drafts",
  },
  {
    id: MailRole.viewer,
    description: "Read allowed mailbox or folder content",
  },
] as const satisfies readonly AuthPermission.RoleDefinition[];

const permissionScopeTypes = new Map(
  mailPermissionDefinitions.map(({ id, scopeType }) => [id, scopeType] as const)
);

const assignPermissions = (
  role: (typeof MailRole)[keyof typeof MailRole],
  permissions: readonly (typeof MailPermission)[keyof typeof MailPermission][]
): readonly AuthPermission.RolePermission[] =>
  permissions.map((permission) => ({
    permission,
    role,
    scopeType: permissionScopeTypes.get(permission),
  }));

export const mailRolePermissions = [
  ...assignPermissions(
    MailRole.owner,
    mailPermissionDefinitions.map(({ id }) => id)
  ),
  ...assignPermissions(MailRole.manager, [
    MailPermission.mailboxRead,
    MailPermission.mailboxModify,
    MailPermission.mailboxSend,
    MailPermission.folderRead,
    MailPermission.folderModify,
    MailPermission.messageRead,
    MailPermission.messageModify,
    MailPermission.draftCreate,
    MailPermission.draftSend,
    MailPermission.ruleManage,
    MailPermission.attachmentRead,
    MailPermission.attachmentUpload,
  ]),
  ...assignPermissions(MailRole.editor, [
    MailPermission.mailboxRead,
    MailPermission.mailboxModify,
    MailPermission.folderRead,
    MailPermission.folderModify,
    MailPermission.messageRead,
    MailPermission.messageModify,
    MailPermission.draftCreate,
    MailPermission.attachmentRead,
    MailPermission.attachmentUpload,
  ]),
  ...assignPermissions(MailRole.viewer, [
    MailPermission.mailboxRead,
    MailPermission.folderRead,
    MailPermission.messageRead,
    MailPermission.attachmentRead,
  ]),
] as const satisfies readonly AuthPermission.RolePermission[];

export const mailboxScope = (
  mailboxId: string
): AuthPermission.PermissionScope =>
  AuthPermission.PermissionScope.make(MAILBOX_SCOPE_TYPE, mailboxId);

export const folderScope = (folderId: string): AuthPermission.PermissionScope =>
  AuthPermission.PermissionScope.make(FOLDER_SCOPE_TYPE, folderId);
