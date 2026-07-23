import { describe, expect, it } from "vitest";

import {
  FOLDER_SCOPE_TYPE,
  MailPermission,
  MailRole,
  MAILBOX_SCOPE_TYPE,
  folderScope,
  mailboxScope,
  mailPermissionDefinitions,
  mailRoleDefinitions,
  mailRolePermissions,
} from "#/modules/authorization/domain/MailPermissionCatalog";

const rolePermissionKey = (role: string, permission: string) =>
  `${role}:${permission}`;

const rolePermissionKeys = new Set(
  mailRolePermissions.map(({ permission, role }) =>
    rolePermissionKey(role, permission)
  )
);

describe("mail authorization catalog", () => {
  it("defines unique permissions, roles, and resource scopes", () => {
    expect({
      permissionCount: mailPermissionDefinitions.length,
      roleCount: mailRoleDefinitions.length,
      uniquePermissionCount: new Set(
        mailPermissionDefinitions.map(({ id }) => id)
      ).size,
      uniqueRoleCount: new Set(mailRoleDefinitions.map(({ id }) => id)).size,
    }).toStrictEqual({
      permissionCount: 15,
      roleCount: 4,
      uniquePermissionCount: 15,
      uniqueRoleCount: 4,
    });
    expect(mailboxScope("mailbox-a")).toStrictEqual({
      id: "mailbox-a",
      type: MAILBOX_SCOPE_TYPE,
    });
    expect(folderScope("mailbox-a", "folder-a")).toStrictEqual({
      id: '["mailbox-a","folder-a"]',
      type: FOLDER_SCOPE_TYPE,
    });
    expect(folderScope("mailbox-b", "folder-a")).not.toStrictEqual(
      folderScope("mailbox-a", "folder-a")
    );
  });

  it("keeps role mappings aligned with permission scope types", () => {
    const scopeByPermission = new Map(
      mailPermissionDefinitions.map(({ id, scopeType }) => [id, scopeType])
    );

    for (const mapping of mailRolePermissions) {
      expect(mapping.scopeType).toBe(scopeByPermission.get(mapping.permission));
    }
  });

  it("reserves member administration and exports for owners", () => {
    for (const role of [MailRole.manager, MailRole.editor, MailRole.viewer]) {
      expect(
        rolePermissionKeys.has(
          rolePermissionKey(role, MailPermission.mailboxManageMembers)
        )
      ).toBeFalsy();
      expect(
        rolePermissionKeys.has(
          rolePermissionKey(role, MailPermission.mailboxExport)
        )
      ).toBeFalsy();
    }

    expect(
      rolePermissionKeys.has(
        rolePermissionKey(MailRole.owner, MailPermission.mailboxManageMembers)
      )
    ).toBeTruthy();
    expect(
      rolePermissionKeys.has(
        rolePermissionKey(MailRole.owner, MailPermission.mailboxExport)
      )
    ).toBeTruthy();
  });

  it("makes editor sending an explicit opt-in", () => {
    expect(
      rolePermissionKeys.has(
        rolePermissionKey(MailRole.editor, MailPermission.mailboxSend)
      )
    ).toBeFalsy();
    expect(
      rolePermissionKeys.has(
        rolePermissionKey(MailRole.editor, MailPermission.draftSend)
      )
    ).toBeFalsy();
  });
});
