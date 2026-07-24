/* oxlint-disable vitest/max-expects -- Exact catalog and adversarial scope vectors are asserted together. */
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { describe, expect, expectTypeOf, it } from "vitest";

import type {
  FolderId,
  FolderScopeComponents,
  MailboxScopeId,
  OrganizationScopeId,
  SendIdentityId,
  SendIdentityScopeComponents,
} from "#/modules/authorization/contracts/AuthorizationCatalog";
import {
  AuthorizationPermission,
  FOLDER_SCOPE_TYPE,
  FolderScopeId,
  LegacyMailboxRole,
  MAILBOX_SCOPE_TYPE,
  ORGANIZATION_SCOPE_TYPE,
  OrganizationRole,
  SEND_IDENTITY_SCOPE_TYPE,
  SendIdentityScopeId,
  authorizationPermissionDefinitions,
  authorizationRoleDefinitions,
  authorizationRolePermissions,
  authorizationScopeTypes,
  decodeFolderScopeId,
  decodeFolderId,
  decodeMailboxScopeId,
  decodeOrganizationScopeId,
  decodeSendIdentityId,
  decodeSendIdentityScopeId,
  encodeFolderScopeId,
  encodeMailboxScopeId,
  encodeOrganizationScopeId,
  encodeSendIdentityScopeId,
  folderScope,
  legacyMailboxRoleDefinitions,
  legacyMailboxRolePermissions,
  makeFolderId,
  makeMailboxScopeId,
  makeOrganizationScopeId,
  makeSendIdentityId,
  mailboxScope,
  organizationScope,
  sendIdentityScope,
} from "#/modules/authorization/contracts/AuthorizationCatalog";

const expectedRolePermissions = {
  "organization.owner": [
    "organization.read",
    "organization.manage_settings",
    "organization.manage_members",
    "organization.manage_domains",
    "organization.manage_addresses",
    "organization.manage_mailboxes",
    "organization.read_audit",
    "organization.transfer_ownership",
  ],
  "organization.admin": [
    "organization.read",
    "organization.manage_settings",
    "organization.manage_members",
    "organization.manage_domains",
    "organization.manage_addresses",
    "organization.manage_mailboxes",
    "organization.read_audit",
  ],
  "organization.member": ["organization.read"],
  "mailbox.owner": [
    "mailbox.read",
    "mailbox.modify",
    "mailbox.send",
    "mailbox.send_from_shared_identity",
    "mailbox.manage_settings",
    "mailbox.manage_members",
    "mailbox.export",
    "message.read",
    "message.modify",
    "draft.create",
    "draft.send",
    "rule.manage",
    "attachment.read",
    "attachment.upload",
    "folder.read",
    "folder.modify",
  ],
  "mailbox.manager": [
    "mailbox.read",
    "mailbox.modify",
    "mailbox.send",
    "mailbox.send_from_shared_identity",
    "message.read",
    "message.modify",
    "draft.create",
    "draft.send",
    "rule.manage",
    "attachment.read",
    "attachment.upload",
    "folder.read",
    "folder.modify",
  ],
  "mailbox.editor": [
    "mailbox.read",
    "mailbox.modify",
    "message.read",
    "message.modify",
    "draft.create",
    "attachment.read",
    "attachment.upload",
    "folder.read",
    "folder.modify",
  ],
  "mailbox.viewer": [
    "mailbox.read",
    "message.read",
    "attachment.read",
    "folder.read",
  ],
} as const;

describe("authorization catalog contract", () => {
  it("defines the exact canonical IDs and counts", () => {
    expect(authorizationScopeTypes).toStrictEqual([
      "organization",
      "mailbox",
      "folder",
      "send_identity",
    ]);
    expect(
      authorizationPermissionDefinitions.map(({ id }) => id)
    ).toStrictEqual([
      "organization.read",
      "organization.manage_settings",
      "organization.manage_members",
      "organization.manage_domains",
      "organization.manage_addresses",
      "organization.manage_mailboxes",
      "organization.read_audit",
      "organization.transfer_ownership",
      "mailbox.read",
      "mailbox.modify",
      "mailbox.send",
      "mailbox.send_from_shared_identity",
      "mailbox.manage_settings",
      "mailbox.manage_members",
      "mailbox.export",
      "message.read",
      "message.modify",
      "draft.create",
      "draft.send",
      "rule.manage",
      "attachment.read",
      "attachment.upload",
      "folder.read",
      "folder.modify",
      "send_identity.use",
    ]);
    expect(authorizationRoleDefinitions.map(({ id }) => id)).toStrictEqual([
      "organization.owner",
      "organization.admin",
      "organization.member",
      "mailbox.owner",
      "mailbox.manager",
      "mailbox.editor",
      "mailbox.viewer",
    ]);
    expect({
      mappings: authorizationRolePermissions.length,
      permissions: authorizationPermissionDefinitions.length,
      roles: authorizationRoleDefinitions.length,
      uniqueMappings: new Set(
        authorizationRolePermissions.map(
          ({ permission, role, scopeType }) =>
            `${role}:${permission}:${scopeType}`
        )
      ).size,
      uniquePermissions: new Set(
        authorizationPermissionDefinitions.map(({ id }) => id)
      ).size,
      uniqueRoles: new Set(authorizationRoleDefinitions.map(({ id }) => id))
        .size,
    }).toStrictEqual({
      mappings: 58,
      permissions: 25,
      roles: 7,
      uniqueMappings: 58,
      uniquePermissions: 25,
      uniqueRoles: 7,
    });
  });

  it("uses the exact role matrices without cross-family or direct-only mappings", () => {
    const scopeByPermission = new Map(
      authorizationPermissionDefinitions.map(({ id, scopeType }) => [
        id,
        scopeType,
      ])
    );

    for (const [role, permissions] of Object.entries(expectedRolePermissions)) {
      const actual = authorizationRolePermissions
        .filter((mapping) => mapping.role === role)
        .map(({ permission }) => permission);
      expect(actual).toHaveLength(permissions.length);
      expect(new Set(actual)).toStrictEqual(new Set(permissions));
    }
    for (const mapping of authorizationRolePermissions) {
      expect(mapping.scopeType).toBe(scopeByPermission.get(mapping.permission));
      expect(
        mapping.role.startsWith("organization.") ===
          mapping.permission.startsWith("organization.")
      ).toBeTruthy();
    }
    expect(
      authorizationRolePermissions.some(
        ({ permission }) =>
          permission === AuthorizationPermission.sendIdentityUse
      )
    ).toBeFalsy();
    expect(
      authorizationRolePermissions.some(
        ({ permission, role }) =>
          role === OrganizationRole.admin &&
          permission === AuthorizationPermission.organizationTransferOwnership
      )
    ).toBeFalsy();
  });

  it("keeps legacy mailbox roles explicit and unchanged", () => {
    expect(legacyMailboxRoleDefinitions.map(({ id }) => id)).toStrictEqual([
      LegacyMailboxRole.owner,
      LegacyMailboxRole.manager,
      LegacyMailboxRole.editor,
      LegacyMailboxRole.viewer,
    ]);
    expect(legacyMailboxRolePermissions).toHaveLength(40);
    expect(
      legacyMailboxRolePermissions.some(
        ({ permission }) =>
          permission ===
            AuthorizationPermission.mailboxSendFromSharedIdentity ||
          permission === AuthorizationPermission.sendIdentityUse
      )
    ).toBeFalsy();
  });

  it("encodes and decodes raw and tuple scope IDs canonically", () => {
    const organizationId = makeOrganizationScopeId("org-a");
    const mailboxId = makeMailboxScopeId("mailbox-a");
    const folderId = makeFolderId("folder-a");
    const sendIdentityId = makeSendIdentityId("identity-a");

    expect(encodeOrganizationScopeId(organizationId)).toBe("org-a");
    expect(encodeMailboxScopeId(mailboxId)).toBe("mailbox-a");
    expect(encodeFolderScopeId(mailboxId, folderId)).toBe(
      '["mailbox-a","folder-a"]'
    );
    expect(encodeSendIdentityScopeId(mailboxId, sendIdentityId)).toBe(
      '["mailbox-a","identity-a"]'
    );
    expect(Option.getOrUndefined(decodeOrganizationScopeId("org-a"))).toBe(
      "org-a"
    );
    expect(Option.getOrUndefined(decodeMailboxScopeId("mailbox-a"))).toBe(
      "mailbox-a"
    );
    expect(
      Option.getOrUndefined(decodeFolderScopeId('["mailbox-a","folder-a"]'))
    ).toStrictEqual(["mailbox-a", "folder-a"]);
    expect(
      Option.getOrUndefined(
        decodeSendIdentityScopeId('["mailbox-a","identity-a"]')
      )
    ).toStrictEqual(["mailbox-a", "identity-a"]);
    expect(organizationScope(organizationId)).toStrictEqual({
      id: "org-a",
      type: ORGANIZATION_SCOPE_TYPE,
    });
    expect(mailboxScope(mailboxId)).toStrictEqual({
      id: "mailbox-a",
      type: MAILBOX_SCOPE_TYPE,
    });
    expect(folderScope(mailboxId, folderId)).toStrictEqual({
      id: '["mailbox-a","folder-a"]',
      type: FOLDER_SCOPE_TYPE,
    });
    expect(sendIdentityScope(mailboxId, sendIdentityId)).toStrictEqual({
      id: '["mailbox-a","identity-a"]',
      type: SEND_IDENTITY_SCOPE_TYPE,
    });
    expect(
      Option.isSome(
        Schema.decodeUnknownOption(FolderScopeId)('["mailbox-a","folder-a"]')
      )
    ).toBeTruthy();
    expect(
      Option.isSome(
        Schema.decodeUnknownOption(SendIdentityScopeId)(
          '["mailbox-a","identity-a"]'
        )
      )
    ).toBeTruthy();
  });

  it("keeps component, tuple, and canonical scope brands distinct", () => {
    expectTypeOf<OrganizationScopeId>().not.toEqualTypeOf<MailboxScopeId>();
    expectTypeOf<MailboxScopeId>().not.toEqualTypeOf<FolderId>();
    expectTypeOf<FolderId>().not.toEqualTypeOf<SendIdentityId>();
    expectTypeOf<FolderScopeComponents>().not.toEqualTypeOf<SendIdentityScopeComponents>();
    expectTypeOf<FolderScopeId>().not.toEqualTypeOf<SendIdentityScopeId>();
    expectTypeOf(decodeFolderScopeId).returns.toEqualTypeOf<
      Option.Option<FolderScopeComponents>
    >();
    expectTypeOf(decodeSendIdentityScopeId).returns.toEqualTypeOf<
      Option.Option<SendIdentityScopeComponents>
    >();
    expectTypeOf(organizationScope)
      .parameter(0)
      .toEqualTypeOf<OrganizationScopeId>();
    expectTypeOf(mailboxScope).parameter(0).toEqualTypeOf<MailboxScopeId>();
    expectTypeOf(folderScope).parameter(1).toEqualTypeOf<FolderId>();
    expectTypeOf(sendIdentityScope)
      .parameter(1)
      .toEqualTypeOf<SendIdentityId>();
  });

  it("uses independent decoders at adversarial scope boundaries", () => {
    expect(decodeFolderScopeId).not.toBe(decodeSendIdentityScopeId);
    expect(
      Option.getOrUndefined(decodeFolderScopeId('["mailbox-a","folder-a"]'))
    ).toStrictEqual(["mailbox-a", "folder-a"]);
    expect(
      Option.getOrUndefined(
        decodeSendIdentityScopeId('["mailbox-a","identity-a"]')
      )
    ).toStrictEqual(["mailbox-a", "identity-a"]);
    expect(
      Option.isNone(decodeOrganizationScopeId('["mailbox-a","folder-a"]'))
    ).toBeTruthy();
    expect(
      Option.isSome(decodeMailboxScopeId('["mailbox-a","folder-a"]'))
    ).toBeTruthy();
    expect(Option.isNone(decodeFolderScopeId("mailbox-a"))).toBeTruthy();
    expect(
      Option.isNone(decodeOrganizationScopeId("organization.example"))
    ).toBeTruthy();
    expect(Option.isSome(decodeMailboxScopeId("mailbox.example"))).toBeTruthy();
    expect(Option.isSome(decodeFolderId("folder.example"))).toBeTruthy();
    expect(
      Option.isSome(decodeSendIdentityId("identity.example"))
    ).toBeTruthy();
  });

  it.each([
    undefined,
    null,
    1,
    {},
    [],
    "",
    " ",
    "not-json",
    "[]",
    '["mailbox-a"]',
    '["mailbox-a","folder-a","extra"]',
    '["", "folder-a"]',
    '["mailbox-a",""]',
    '[1,"folder-a"]',
    '["mailbox-a",1]',
    '["mailbox-a", "folder-a"]',
    ' ["mailbox-a","folder-a"]',
    '["mailbox-a","folder-a"] ',
    '["mailbox-a","folder-\\u0061"]',
    '["mailbox-a","folder-a"]junk',
  ])("rejects malformed or noncanonical tuple scope ID %#", (input) => {
    expect(Option.isNone(decodeFolderScopeId(input))).toBeTruthy();
    expect(Option.isNone(decodeSendIdentityScopeId(input))).toBeTruthy();
  });

  it.each([undefined, null, 1, {}, [], "", " ", " mailbox-a", "mailbox-a "])(
    "rejects invalid raw scope component %#",
    (input) => {
      expect(Option.isNone(decodeMailboxScopeId(input))).toBeTruthy();
      expect(Option.isNone(decodeFolderId(input))).toBeTruthy();
      expect(Option.isNone(decodeSendIdentityId(input))).toBeTruthy();
    }
  );

  it.each(["organization.example", "organization/one", "organizacja-ą"])(
    "rejects noncanonical organization scope ID %s",
    (input) => {
      expect(Option.isNone(decodeOrganizationScopeId(input))).toBeTruthy();
    }
  );

  it("rejects invalid components while encoding", () => {
    expect(() => makeMailboxScopeId("")).toThrow(/length|Expected/iu);
    expect(() => makeFolderId(" ")).toThrow(/length|Expected/iu);
    expect(() => makeMailboxScopeId(" mailbox-a")).toThrow(
      /trimmed|Expected/iu
    );
  });
});
