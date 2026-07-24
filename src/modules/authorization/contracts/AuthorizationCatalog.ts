import * as AuthPermission from "@effect-auth/core/Permission";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

export const ORGANIZATION_SCOPE_TYPE = "organization";
export const MAILBOX_SCOPE_TYPE = "mailbox";
export const FOLDER_SCOPE_TYPE = "folder";
export const SEND_IDENTITY_SCOPE_TYPE = "send_identity";

export const authorizationScopeTypes = [
  ORGANIZATION_SCOPE_TYPE,
  MAILBOX_SCOPE_TYPE,
  FOLDER_SCOPE_TYPE,
  SEND_IDENTITY_SCOPE_TYPE,
] as const;

const ResourceScopeComponent = Schema.Trimmed.pipe(
  Schema.check(Schema.isLengthBetween(1, 128))
);

export const OrganizationScopeId = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[A-Za-z0-9_-]{1,128}$/u)),
  Schema.brand("cloudflare-inbox/authorization/OrganizationScopeId")
);
export type OrganizationScopeId = Schema.Schema.Type<
  typeof OrganizationScopeId
>;
export const MailboxScopeId = ResourceScopeComponent.pipe(
  Schema.brand("cloudflare-inbox/authorization/MailboxScopeId")
);
export type MailboxScopeId = Schema.Schema.Type<typeof MailboxScopeId>;
export const FolderId = ResourceScopeComponent.pipe(
  Schema.brand("cloudflare-inbox/authorization/FolderId")
);
export type FolderId = Schema.Schema.Type<typeof FolderId>;
export const SendIdentityId = ResourceScopeComponent.pipe(
  Schema.brand("cloudflare-inbox/authorization/SendIdentityId")
);
export type SendIdentityId = Schema.Schema.Type<typeof SendIdentityId>;

export const FolderScopeComponents = Schema.Tuple([
  MailboxScopeId,
  FolderId,
]).pipe(Schema.brand("cloudflare-inbox/authorization/FolderScopeComponents"));
export type FolderScopeComponents = Schema.Schema.Type<
  typeof FolderScopeComponents
>;
export const SendIdentityScopeComponents = Schema.Tuple([
  MailboxScopeId,
  SendIdentityId,
]).pipe(
  Schema.brand("cloudflare-inbox/authorization/SendIdentityScopeComponents")
);
export type SendIdentityScopeComponents = Schema.Schema.Type<
  typeof SendIdentityScopeComponents
>;

export const decodeOrganizationScopeId =
  Schema.decodeUnknownOption(OrganizationScopeId);
export const decodeMailboxScopeId = Schema.decodeUnknownOption(MailboxScopeId);
export const decodeFolderId = Schema.decodeUnknownOption(FolderId);
export const decodeSendIdentityId = Schema.decodeUnknownOption(SendIdentityId);

export const makeOrganizationScopeId =
  Schema.decodeUnknownSync(OrganizationScopeId);
export const makeMailboxScopeId = Schema.decodeUnknownSync(MailboxScopeId);
export const makeFolderId = Schema.decodeUnknownSync(FolderId);
export const makeSendIdentityId = Schema.decodeUnknownSync(SendIdentityId);

export const decodeFolderScopeId = (
  input: unknown
): Option.Option<FolderScopeComponents> => {
  if (typeof input !== "string") {
    return Option.none();
  }

  try {
    const decoded = Schema.decodeUnknownOption(FolderScopeComponents)(
      JSON.parse(input)
    );
    return Option.isSome(decoded) && JSON.stringify(decoded.value) === input
      ? decoded
      : Option.none();
  } catch {
    return Option.none();
  }
};

export const decodeSendIdentityScopeId = (
  input: unknown
): Option.Option<SendIdentityScopeComponents> => {
  if (typeof input !== "string") {
    return Option.none();
  }

  try {
    const decoded = Schema.decodeUnknownOption(SendIdentityScopeComponents)(
      JSON.parse(input)
    );
    return Option.isSome(decoded) && JSON.stringify(decoded.value) === input
      ? decoded
      : Option.none();
  } catch {
    return Option.none();
  }
};

export const FolderScopeId = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter((id) =>
      Option.isSome(decodeFolderScopeId(id))
        ? undefined
        : "FolderScopeId must be a canonical [mailboxId, folderId] JSON tuple"
    )
  ),
  Schema.brand("cloudflare-inbox/authorization/FolderScopeId")
);
export type FolderScopeId = Schema.Schema.Type<typeof FolderScopeId>;
export const SendIdentityScopeId = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter((id) =>
      Option.isSome(decodeSendIdentityScopeId(id))
        ? undefined
        : "SendIdentityScopeId must be a canonical [mailboxId, sendIdentityId] JSON tuple"
    )
  ),
  Schema.brand("cloudflare-inbox/authorization/SendIdentityScopeId")
);
export type SendIdentityScopeId = Schema.Schema.Type<
  typeof SendIdentityScopeId
>;

export const encodeOrganizationScopeId = (
  organizationId: OrganizationScopeId
): string => organizationId;
export const encodeMailboxScopeId = (mailboxId: MailboxScopeId): string =>
  mailboxId;
export const encodeFolderScopeId = (
  mailboxId: MailboxScopeId,
  folderId: FolderId
): FolderScopeId =>
  Schema.decodeUnknownSync(FolderScopeId)(
    JSON.stringify([mailboxId, folderId])
  );
export const encodeSendIdentityScopeId = (
  mailboxId: MailboxScopeId,
  sendIdentityId: SendIdentityId
): SendIdentityScopeId =>
  Schema.decodeUnknownSync(SendIdentityScopeId)(
    JSON.stringify([mailboxId, sendIdentityId])
  );

export const organizationScope = (
  organizationId: OrganizationScopeId
): AuthPermission.PermissionScope =>
  AuthPermission.PermissionScope.make(
    ORGANIZATION_SCOPE_TYPE,
    encodeOrganizationScopeId(organizationId)
  );
export const mailboxScope = (
  mailboxId: MailboxScopeId
): AuthPermission.PermissionScope =>
  AuthPermission.PermissionScope.make(
    MAILBOX_SCOPE_TYPE,
    encodeMailboxScopeId(mailboxId)
  );
export const folderScope = (
  mailboxId: MailboxScopeId,
  folderId: FolderId
): AuthPermission.PermissionScope =>
  AuthPermission.PermissionScope.make(
    FOLDER_SCOPE_TYPE,
    encodeFolderScopeId(mailboxId, folderId)
  );
export const sendIdentityScope = (
  mailboxId: MailboxScopeId,
  sendIdentityId: SendIdentityId
): AuthPermission.PermissionScope =>
  AuthPermission.PermissionScope.make(
    SEND_IDENTITY_SCOPE_TYPE,
    encodeSendIdentityScopeId(mailboxId, sendIdentityId)
  );

export const AuthorizationPermission = {
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
  mailboxSendFromSharedIdentity: AuthPermission.PermissionId(
    "mailbox.send_from_shared_identity"
  ),
  messageModify: AuthPermission.PermissionId("message.modify"),
  messageRead: AuthPermission.PermissionId("message.read"),
  organizationManageAddresses: AuthPermission.PermissionId(
    "organization.manage_addresses"
  ),
  organizationManageDomains: AuthPermission.PermissionId(
    "organization.manage_domains"
  ),
  organizationManageMailboxes: AuthPermission.PermissionId(
    "organization.manage_mailboxes"
  ),
  organizationManageMembers: AuthPermission.PermissionId(
    "organization.manage_members"
  ),
  organizationManageSettings: AuthPermission.PermissionId(
    "organization.manage_settings"
  ),
  organizationRead: AuthPermission.PermissionId("organization.read"),
  organizationReadAudit: AuthPermission.PermissionId("organization.read_audit"),
  organizationTransferOwnership: AuthPermission.PermissionId(
    "organization.transfer_ownership"
  ),
  ruleManage: AuthPermission.PermissionId("rule.manage"),
  sendIdentityUse: AuthPermission.PermissionId("send_identity.use"),
} as const;

export const OrganizationRole = {
  admin: AuthPermission.RoleId("organization.admin"),
  member: AuthPermission.RoleId("organization.member"),
  owner: AuthPermission.RoleId("organization.owner"),
} as const;

export const MailboxRole = {
  editor: AuthPermission.RoleId("mailbox.editor"),
  manager: AuthPermission.RoleId("mailbox.manager"),
  owner: AuthPermission.RoleId("mailbox.owner"),
  viewer: AuthPermission.RoleId("mailbox.viewer"),
} as const;

export const LegacyMailboxRole = {
  editor: AuthPermission.RoleId("editor"),
  manager: AuthPermission.RoleId("manager"),
  owner: AuthPermission.RoleId("owner"),
  viewer: AuthPermission.RoleId("viewer"),
} as const;

export const authorizationPermissionDefinitions = [
  {
    id: AuthorizationPermission.organizationRead,
    description: "Read an organization",
    scopeType: ORGANIZATION_SCOPE_TYPE,
  },
  {
    id: AuthorizationPermission.organizationManageSettings,
    description: "Manage organization settings",
    scopeType: ORGANIZATION_SCOPE_TYPE,
  },
  {
    id: AuthorizationPermission.organizationManageMembers,
    description: "Manage organization members",
    scopeType: ORGANIZATION_SCOPE_TYPE,
  },
  {
    id: AuthorizationPermission.organizationManageDomains,
    description: "Manage organization domains",
    scopeType: ORGANIZATION_SCOPE_TYPE,
  },
  {
    id: AuthorizationPermission.organizationManageAddresses,
    description: "Manage organization addresses",
    scopeType: ORGANIZATION_SCOPE_TYPE,
  },
  {
    id: AuthorizationPermission.organizationManageMailboxes,
    description: "Manage organization mailboxes",
    scopeType: ORGANIZATION_SCOPE_TYPE,
  },
  {
    id: AuthorizationPermission.organizationReadAudit,
    description: "Read the organization audit log",
    scopeType: ORGANIZATION_SCOPE_TYPE,
  },
  {
    id: AuthorizationPermission.organizationTransferOwnership,
    description: "Transfer organization ownership",
    scopeType: ORGANIZATION_SCOPE_TYPE,
  },
  {
    id: AuthorizationPermission.mailboxRead,
    description: "Read a mailbox",
    scopeType: MAILBOX_SCOPE_TYPE,
  },
  {
    id: AuthorizationPermission.mailboxModify,
    description: "Modify mailbox content",
    scopeType: MAILBOX_SCOPE_TYPE,
  },
  {
    id: AuthorizationPermission.mailboxSend,
    description: "Send mail from a mailbox",
    scopeType: MAILBOX_SCOPE_TYPE,
  },
  {
    id: AuthorizationPermission.mailboxSendFromSharedIdentity,
    description: "Send from a shared mailbox identity",
    scopeType: MAILBOX_SCOPE_TYPE,
  },
  {
    id: AuthorizationPermission.mailboxManageSettings,
    description: "Manage mailbox settings",
    scopeType: MAILBOX_SCOPE_TYPE,
  },
  {
    id: AuthorizationPermission.mailboxManageMembers,
    description: "Manage mailbox members",
    scopeType: MAILBOX_SCOPE_TYPE,
  },
  {
    id: AuthorizationPermission.mailboxExport,
    description: "Export mailbox data",
    scopeType: MAILBOX_SCOPE_TYPE,
  },
  {
    id: AuthorizationPermission.messageRead,
    description: "Read mailbox messages",
    scopeType: MAILBOX_SCOPE_TYPE,
  },
  {
    id: AuthorizationPermission.messageModify,
    description: "Modify mailbox messages",
    scopeType: MAILBOX_SCOPE_TYPE,
  },
  {
    id: AuthorizationPermission.draftCreate,
    description: "Create and edit drafts",
    scopeType: MAILBOX_SCOPE_TYPE,
  },
  {
    id: AuthorizationPermission.draftSend,
    description: "Send mailbox drafts",
    scopeType: MAILBOX_SCOPE_TYPE,
  },
  {
    id: AuthorizationPermission.ruleManage,
    description: "Manage mailbox rules",
    scopeType: MAILBOX_SCOPE_TYPE,
  },
  {
    id: AuthorizationPermission.attachmentRead,
    description: "Read mailbox attachments",
    scopeType: MAILBOX_SCOPE_TYPE,
  },
  {
    id: AuthorizationPermission.attachmentUpload,
    description: "Upload mailbox attachments",
    scopeType: MAILBOX_SCOPE_TYPE,
  },
  {
    id: AuthorizationPermission.folderRead,
    description: "Read a folder",
    scopeType: FOLDER_SCOPE_TYPE,
  },
  {
    id: AuthorizationPermission.folderModify,
    description: "Modify a folder",
    scopeType: FOLDER_SCOPE_TYPE,
  },
  {
    id: AuthorizationPermission.sendIdentityUse,
    description: "Use a restricted send identity",
    scopeType: SEND_IDENTITY_SCOPE_TYPE,
  },
] as const satisfies readonly AuthPermission.PermissionDefinition[];

export const authorizationRoleDefinitions = [
  { id: OrganizationRole.owner, description: "Full organization control" },
  {
    id: OrganizationRole.admin,
    description: "Manage organization settings and resources",
  },
  { id: OrganizationRole.member, description: "Read organization membership" },
  { id: MailboxRole.owner, description: "Full mailbox control" },
  {
    id: MailboxRole.manager,
    description: "Manage mailbox content, rules, and sending",
  },
  {
    id: MailboxRole.editor,
    description: "Read and organize content and create drafts",
  },
  {
    id: MailboxRole.viewer,
    description: "Read allowed mailbox or folder content",
  },
] as const satisfies readonly AuthPermission.RoleDefinition[];

export const legacyMailboxRoleDefinitions = [
  { id: LegacyMailboxRole.owner, description: "Full mailbox control" },
  {
    id: LegacyMailboxRole.manager,
    description: "Manage mailbox content, rules, and sending",
  },
  {
    id: LegacyMailboxRole.editor,
    description: "Read and organize content and create drafts",
  },
  {
    id: LegacyMailboxRole.viewer,
    description: "Read allowed mailbox or folder content",
  },
] as const satisfies readonly AuthPermission.RoleDefinition[];

const permissionScopeTypes = new Map(
  authorizationPermissionDefinitions.map(({ id, scopeType }) => [id, scopeType])
);

const assignPermissions = (
  role: AuthPermission.RoleId,
  permissions: readonly AuthPermission.PermissionId[]
): readonly AuthPermission.RolePermission[] =>
  permissions.map((permission) => ({
    permission,
    role,
    scopeType: permissionScopeTypes.get(permission),
  }));

const organizationAdministrationPermissions = [
  AuthorizationPermission.organizationRead,
  AuthorizationPermission.organizationManageSettings,
  AuthorizationPermission.organizationManageMembers,
  AuthorizationPermission.organizationManageDomains,
  AuthorizationPermission.organizationManageAddresses,
  AuthorizationPermission.organizationManageMailboxes,
  AuthorizationPermission.organizationReadAudit,
] as const;
const mailboxManagerPermissions = [
  AuthorizationPermission.mailboxRead,
  AuthorizationPermission.mailboxModify,
  AuthorizationPermission.mailboxSend,
  AuthorizationPermission.mailboxSendFromSharedIdentity,
  AuthorizationPermission.folderRead,
  AuthorizationPermission.folderModify,
  AuthorizationPermission.messageRead,
  AuthorizationPermission.messageModify,
  AuthorizationPermission.draftCreate,
  AuthorizationPermission.draftSend,
  AuthorizationPermission.ruleManage,
  AuthorizationPermission.attachmentRead,
  AuthorizationPermission.attachmentUpload,
] as const;
const mailboxEditorPermissions = [
  AuthorizationPermission.mailboxRead,
  AuthorizationPermission.mailboxModify,
  AuthorizationPermission.folderRead,
  AuthorizationPermission.folderModify,
  AuthorizationPermission.messageRead,
  AuthorizationPermission.messageModify,
  AuthorizationPermission.draftCreate,
  AuthorizationPermission.attachmentRead,
  AuthorizationPermission.attachmentUpload,
] as const;
const mailboxViewerPermissions = [
  AuthorizationPermission.mailboxRead,
  AuthorizationPermission.folderRead,
  AuthorizationPermission.messageRead,
  AuthorizationPermission.attachmentRead,
] as const;
const canonicalMailboxPermissions = authorizationPermissionDefinitions
  .filter(({ id }) => id !== AuthorizationPermission.sendIdentityUse)
  .filter(({ scopeType }) => scopeType !== ORGANIZATION_SCOPE_TYPE)
  .map(({ id }) => id);

export const authorizationRolePermissions = [
  ...assignPermissions(OrganizationRole.owner, [
    ...organizationAdministrationPermissions,
    AuthorizationPermission.organizationTransferOwnership,
  ]),
  ...assignPermissions(
    OrganizationRole.admin,
    organizationAdministrationPermissions
  ),
  ...assignPermissions(OrganizationRole.member, [
    AuthorizationPermission.organizationRead,
  ]),
  ...assignPermissions(MailboxRole.owner, canonicalMailboxPermissions),
  ...assignPermissions(MailboxRole.manager, mailboxManagerPermissions),
  ...assignPermissions(MailboxRole.editor, mailboxEditorPermissions),
  ...assignPermissions(MailboxRole.viewer, mailboxViewerPermissions),
] as const satisfies readonly AuthPermission.RolePermission[];

export const legacyMailboxRolePermissions = [
  ...assignPermissions(
    LegacyMailboxRole.owner,
    canonicalMailboxPermissions.filter(
      (permission) =>
        permission !== AuthorizationPermission.mailboxSendFromSharedIdentity
    )
  ),
  ...assignPermissions(
    LegacyMailboxRole.manager,
    mailboxManagerPermissions.filter(
      (permission) =>
        permission !== AuthorizationPermission.mailboxSendFromSharedIdentity
    )
  ),
  ...assignPermissions(LegacyMailboxRole.editor, mailboxEditorPermissions),
  ...assignPermissions(LegacyMailboxRole.viewer, mailboxViewerPermissions),
] as const satisfies readonly AuthPermission.RolePermission[];
