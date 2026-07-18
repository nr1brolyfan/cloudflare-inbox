import type {
  PermissionDefinition,
  PermissionScope,
  RoleDefinition,
  RolePermission,
} from "@effect-auth/core/Permission";
import {
  PermissionId,
  PermissionScope as EffectAuthPermissionScope,
  RoleId,
} from "@effect-auth/core/Permission";

export const MAILBOX_SCOPE_TYPE = "mailbox";
export const FOLDER_SCOPE_TYPE = "folder";

export const MailPermission = {
  attachmentRead: PermissionId("attachment.read"),
  attachmentUpload: PermissionId("attachment.upload"),
  draftCreate: PermissionId("draft.create"),
  draftSend: PermissionId("draft.send"),
  folderModify: PermissionId("folder.modify"),
  folderRead: PermissionId("folder.read"),
  mailboxExport: PermissionId("mailbox.export"),
  mailboxManageMembers: PermissionId("mailbox.manage_members"),
  mailboxManageSettings: PermissionId("mailbox.manage_settings"),
  mailboxModify: PermissionId("mailbox.modify"),
  mailboxRead: PermissionId("mailbox.read"),
  mailboxSend: PermissionId("mailbox.send"),
  messageModify: PermissionId("message.modify"),
  messageRead: PermissionId("message.read"),
  ruleManage: PermissionId("rule.manage"),
} as const;

export const MailRole = {
  editor: RoleId("editor"),
  manager: RoleId("manager"),
  owner: RoleId("owner"),
  viewer: RoleId("viewer"),
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
] as const satisfies readonly PermissionDefinition[];

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
] as const satisfies readonly RoleDefinition[];

const permissionScopeTypes = new Map(
  mailPermissionDefinitions.map(({ id, scopeType }) => [id, scopeType] as const)
);

const assignPermissions = (
  role: (typeof MailRole)[keyof typeof MailRole],
  permissions: readonly (typeof MailPermission)[keyof typeof MailPermission][]
): readonly RolePermission[] =>
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
] as const satisfies readonly RolePermission[];

export const mailboxScope = (mailboxId: string): PermissionScope =>
  EffectAuthPermissionScope.make(MAILBOX_SCOPE_TYPE, mailboxId);

export const folderScope = (folderId: string): PermissionScope =>
  EffectAuthPermissionScope.make(FOLDER_SCOPE_TYPE, folderId);
