/* oxlint-disable vitest/max-expects -- Migration protection and role matrices require exhaustive assertions. */
import { DatabaseSync } from "node:sqlite";

import { D1EffectQbSqliteAuthStorageLive } from "@effect-auth/core/EffectQbSqliteStorage";
import {
  PermissionAdministration,
  Permissions,
  PermissionSubject,
} from "@effect-auth/core/Permission";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { describe, expect, it } from "vitest";

import { MailPermissionsEffectAuthLayer } from "#/modules/authorization/adapters/effect-auth/MailPermissionsEffectAuth";
import {
  AuthorizationPermission,
  LegacyMailboxRole,
  MailboxRole,
  authorizationPermissionDefinitions,
  authorizationRoleDefinitions,
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

import {
  applyControlPlaneMigration,
  applyControlPlaneMigrations,
  applyControlPlaneMigrationsThrough,
  makeTestD1Database,
} from "../../../../support/d1";

const migration = "1020_app_authorization_catalog_v2.sql";
const through1019 = "1019_app_organization_member.sql";

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

const expectedPermissionScopes = {
  "organization.read": "organization",
  "organization.manage_settings": "organization",
  "organization.manage_members": "organization",
  "organization.manage_domains": "organization",
  "organization.manage_addresses": "organization",
  "organization.manage_mailboxes": "organization",
  "organization.read_audit": "organization",
  "organization.transfer_ownership": "organization",
  "mailbox.read": "mailbox",
  "mailbox.modify": "mailbox",
  "mailbox.send": "mailbox",
  "mailbox.send_from_shared_identity": "mailbox",
  "mailbox.manage_settings": "mailbox",
  "mailbox.manage_members": "mailbox",
  "mailbox.export": "mailbox",
  "message.read": "mailbox",
  "message.modify": "mailbox",
  "draft.create": "mailbox",
  "draft.send": "mailbox",
  "rule.manage": "mailbox",
  "attachment.read": "mailbox",
  "attachment.upload": "mailbox",
  "folder.read": "folder",
  "folder.modify": "folder",
  "send_identity.use": "send_identity",
} as const;

interface PermissionDefinitionRow {
  readonly createdAt: number;
  readonly deletedAt: number | null;
  readonly description: string | null;
  readonly disabledAt: number | null;
  readonly id: string;
  readonly scopeType: string;
  readonly scopeTypePresent: number;
  readonly updatedAt: number;
}

interface RoleDefinitionRow {
  readonly createdAt: number;
  readonly deletedAt: number | null;
  readonly description: string | null;
  readonly disabledAt: number | null;
  readonly id: string;
  readonly updatedAt: number;
}

interface RolePermissionRow {
  readonly permission: string;
  readonly role: string;
  readonly scopeType: string;
  readonly scopeTypePresent: number;
}

const permissionDefinitions = (database: DatabaseSync) =>
  database
    .prepare(
      `select id, description, scope_type_present as scopeTypePresent,
              scope_type as scopeType, created_at as createdAt,
              updated_at as updatedAt, disabled_at as disabledAt,
              deleted_at as deletedAt
         from auth_permission_definition
        order by id`
    )
    .all()
    .map((row) => ({
      ...row,
    })) as unknown as readonly PermissionDefinitionRow[];

const roleDefinitions = (database: DatabaseSync) =>
  database
    .prepare(
      `select id, description, created_at as createdAt,
              updated_at as updatedAt, disabled_at as disabledAt,
              deleted_at as deletedAt
         from auth_role_definition
        order by id`
    )
    .all()
    .map((row) => ({ ...row })) as unknown as readonly RoleDefinitionRow[];

const rolePermissions = (database: DatabaseSync) =>
  database
    .prepare(
      `select role_id as role, permission_id as permission,
              scope_type_present as scopeTypePresent, scope_type as scopeType
         from auth_role_permission
        order by role_id, permission_id, scope_type`
    )
    .all()
    .map((row) => ({ ...row })) as unknown as readonly RolePermissionRow[];

const canonicalPermissionRows = () =>
  authorizationPermissionDefinitions
    .map(({ description, id, scopeType }) => ({
      createdAt: 0,
      deletedAt: null,
      description,
      disabledAt: null,
      id,
      scopeType,
      scopeTypePresent: 1,
      updatedAt: 0,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));

const canonicalRoleRows = () =>
  authorizationRoleDefinitions
    .map(({ description, id }) => ({
      createdAt: 0,
      deletedAt: null,
      description,
      disabledAt: null,
      id,
      updatedAt: 0,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));

const canonicalMappingRows = () =>
  Object.entries(expectedRolePermissions)
    .flatMap(([role, permissions]) =>
      permissions.map((permission) => ({
        permission,
        role,
        scopeType: expectedPermissionScopes[permission],
        scopeTypePresent: 1,
      }))
    )
    .sort((left, right) => {
      const leftKey = `${left.role}:${left.permission}:${left.scopeType}`;
      const rightKey = `${right.role}:${right.permission}:${right.scopeType}`;
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    });

const canonicalRoleIds = new Set(
  authorizationRoleDefinitions.map(({ id }) => id as string)
);

const canonicalCatalog = (database: DatabaseSync) => ({
  mappings: rolePermissions(database).filter(({ role }) =>
    canonicalRoleIds.has(role)
  ),
  permissions: permissionDefinitions(database).filter(({ id }) =>
    authorizationPermissionDefinitions.some(
      (definition) => definition.id === id
    )
  ),
  roles: roleDefinitions(database).filter(({ id }) => canonicalRoleIds.has(id)),
});

const expectCanonicalCatalog = (database: DatabaseSync) => {
  const catalog = canonicalCatalog(database);
  expect(catalog.permissions).toStrictEqual(canonicalPermissionRows());
  expect(catalog.roles).toStrictEqual(canonicalRoleRows());
  expect(catalog.mappings).toStrictEqual(canonicalMappingRows());
};

const grantCounts = (database: DatabaseSync) => ({
  permissions: (
    database
      .prepare("select count(*) as count from auth_permission_grant")
      .get() as {
      count: number;
    }
  ).count,
  roles: (
    database.prepare("select count(*) as count from auth_role_grant").get() as {
      count: number;
    }
  ).count,
});

describe("D1 authorization catalog", () => {
  it("upgrades 1019 in place without changing tenant, legacy, singleton, or grant state", async () => {
    const database = new DatabaseSync(":memory:");

    try {
      await applyControlPlaneMigrationsThrough(database, through1019);
      database
        .prepare(
          `insert into auth_user
            (id, created_at, updated_at)
           values (?, ?, ?)`
        )
        .run("user-a", 1, 1);
      database
        .prepare(
          `insert into app_organization
            (id, status, created_at, updated_at, version)
           values (?, ?, ?, ?, ?)`
        )
        .run("org-a", "active", 2, 2, 1);
      database
        .prepare(
          `insert into app_organization_member
            (id, organization_id, user_id, status, created_at, updated_at, version)
           values (?, ?, ?, ?, ?, ?, ?)`
        )
        .run("member-a", "org-a", "user-a", "active", 3, 3, 1);
      database
        .prepare(
          `insert into app_mailbox
            (id, display_name, created_by_user_id, created_at, updated_at)
           values (?, ?, ?, ?, ?)`
        )
        .run("mailbox-a", "Inbox", "user-a", 4, 4);
      database
        .prepare(
          `insert into auth_permission_grant
            (subject_type, subject_id, permission_id, scope_type,
             scope_id_present, scope_id, metadata)
           values (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          "user",
          "user-a",
          "mailbox.read",
          "mailbox",
          1,
          "mailbox-a",
          '{"source":"before-1020"}'
        );
      database
        .prepare(
          `insert into auth_role_grant
            (subject_type, subject_id, role_id, scope_type,
             scope_id_present, scope_id, metadata)
           values (?, ?, ?, ?, ?, ?, ?)`
        )
        .run("user", "user-a", "owner", "mailbox", 1, "mailbox-a", null);

      const before = {
        grants: grantCounts(database),
        legacyMappings: rolePermissions(database),
        legacyRoles: roleDefinitions(database),
        mailbox: database.prepare("select * from app_mailbox").all(),
        member: database.prepare("select * from app_organization_member").all(),
        organization: database.prepare("select * from app_organization").all(),
        user: database.prepare("select * from auth_user").all(),
      };

      await applyControlPlaneMigration(database, migration);

      expectCanonicalCatalog(database);
      expect(grantCounts(database)).toStrictEqual(before.grants);
      expect(
        rolePermissions(database).filter(({ role }) =>
          legacyMailboxRoleDefinitions.some(({ id }) => id === role)
        )
      ).toStrictEqual(before.legacyMappings);
      expect(
        roleDefinitions(database).filter(({ id }) =>
          legacyMailboxRoleDefinitions.some((role) => role.id === id)
        )
      ).toStrictEqual(before.legacyRoles);
      expect(database.prepare("select * from app_mailbox").all()).toStrictEqual(
        before.mailbox
      );
      expect(
        database.prepare("select * from app_organization_member").all()
      ).toStrictEqual(before.member);
      expect(
        database.prepare("select * from app_organization").all()
      ).toStrictEqual(before.organization);
      expect(database.prepare("select * from auth_user").all()).toStrictEqual(
        before.user
      );
      expect(() =>
        database
          .prepare(
            `insert into app_mailbox
              (id, display_name, created_by_user_id, created_at, updated_at)
             values (?, ?, ?, ?, ?)`
          )
          .run("mailbox-b", "Second", "user-a", 5, 5)
      ).toThrow(/app_mailbox_singleton_idx/u);
      expect(
        database
          .prepare(
            `select role_id as roleId, metadata
               from auth_role_grant
              where subject_id = ?`
          )
          .get("user-a")
      ).toMatchObject({ metadata: null, roleId: LegacyMailboxRole.owner });
    } finally {
      database.close();
    }
  });

  it("keeps fresh migrations in exact contract parity and creates zero grants", async () => {
    const database = new DatabaseSync(":memory:");

    try {
      await applyControlPlaneMigrations(database);
      expectCanonicalCatalog(database);
      expect(grantCounts(database)).toStrictEqual({ permissions: 0, roles: 0 });
      expect(permissionDefinitions(database)).toHaveLength(25);
      expect(roleDefinitions(database)).toHaveLength(11);
      expect(rolePermissions(database)).toHaveLength(98);
      expect(legacyMailboxRolePermissions).toHaveLength(40);
    } finally {
      database.close();
    }
  });

  it("accepts preexisting exact rows and is exactly idempotent", async () => {
    const database = new DatabaseSync(":memory:");

    try {
      await applyControlPlaneMigrationsThrough(database, through1019);
      database
        .prepare(
          `insert into auth_permission_definition
            (id, description, scope_type_present, scope_type, created_at, updated_at)
           values (?, ?, ?, ?, ?, ?)`
        )
        .run(
          "organization.read",
          "Read an organization",
          1,
          "organization",
          0,
          0
        );
      database
        .prepare(
          `insert into auth_role_definition
            (id, description, created_at, updated_at)
           values (?, ?, ?, ?)`
        )
        .run("organization.member", "Read organization membership", 0, 0);
      database
        .prepare(
          `insert into auth_role_permission
            (role_id, permission_id, scope_type_present, scope_type)
           values (?, ?, ?, ?)`
        )
        .run("organization.member", "organization.read", 1, "organization");

      await applyControlPlaneMigration(database, migration);
      const first = {
        mappings: rolePermissions(database),
        permissions: permissionDefinitions(database),
        roles: roleDefinitions(database),
        triggers: database
          .prepare(
            `select name, sql from sqlite_master
              where type = 'trigger' and name like 'app_canonical_%'
              order by name`
          )
          .all(),
      };

      await applyControlPlaneMigration(database, migration);

      expect({
        mappings: rolePermissions(database),
        permissions: permissionDefinitions(database),
        roles: roleDefinitions(database),
        triggers: database
          .prepare(
            `select name, sql from sqlite_master
              where type = 'trigger' and name like 'app_canonical_%'
              order by name`
          )
          .all(),
      }).toStrictEqual(first);
      expectCanonicalCatalog(database);
    } finally {
      database.close();
    }
  });

  it("replaces a colliding insert-blocking canonical trigger and remains rerunnable", async () => {
    const database = new DatabaseSync(":memory:");

    try {
      await applyControlPlaneMigrationsThrough(database, through1019);
      database.exec(`create trigger app_canonical_permission_definition_no_insert_replace
        before insert on auth_permission_definition
        begin
          select raise(abort, 'preexisting canonical insert blocker');
        end`);

      await applyControlPlaneMigration(database, migration);
      expectCanonicalCatalog(database);

      expect(
        database
          .prepare(
            `select sql from sqlite_master
              where type = 'trigger'
                and name = 'app_canonical_permission_definition_no_insert_replace'`
          )
          .get()
      ).toMatchObject({
        sql: expect.stringContaining(
          "canonical permission definitions are immutable"
        ),
      });
      expect(() =>
        database
          .prepare(
            `insert or replace into auth_permission_definition
              (id, description, scope_type_present, scope_type, created_at, updated_at)
             values (?, ?, ?, ?, ?, ?)`
          )
          .run("organization.read", "Changed", 1, "organization", 0, 0)
      ).toThrow(/canonical permission definitions are immutable/u);

      await applyControlPlaneMigration(database, migration);
      expectCanonicalCatalog(database);
    } finally {
      database.close();
    }
  });

  it("rolls back the entire migration when a late mapping insert fails", async () => {
    const database = new DatabaseSync(":memory:");

    try {
      await applyControlPlaneMigrationsThrough(database, through1019);
      database.exec(`create trigger app_canonical_permission_definition_no_insert_replace
        before insert on auth_permission_definition
        begin
          select raise(abort, 'preexisting canonical insert blocker');
        end`);
      database.exec(`create trigger test_abort_canonical_mapping_insert
        before insert on auth_role_permission
        when new.role_id = 'mailbox.viewer'
        begin
          select raise(abort, 'late canonical mapping failure');
        end`);
      const before = {
        mappings: rolePermissions(database),
        permissions: permissionDefinitions(database),
        roles: roleDefinitions(database),
        triggers: database
          .prepare(
            `select name, sql from sqlite_master
              where type = 'trigger'
              order by name`
          )
          .all(),
      };

      await expect(
        applyControlPlaneMigration(database, migration)
      ).rejects.toThrow(/late canonical mapping failure/u);

      expect({
        mappings: rolePermissions(database),
        permissions: permissionDefinitions(database),
        roles: roleDefinitions(database),
        triggers: database
          .prepare(
            `select name, sql from sqlite_master
              where type = 'trigger'
              order by name`
          )
          .all(),
      }).toStrictEqual(before);
      expect(() =>
        database
          .prepare(
            `insert into auth_permission_definition
              (id, description, scope_type_present, scope_type, created_at, updated_at)
             values ('custom.rollback-check', 'Rollback check', 1, 'mailbox', 0, 0)`
          )
          .run()
      ).toThrow(/preexisting canonical insert blocker/u);
      expect(grantCounts(database)).toStrictEqual({ permissions: 0, roles: 0 });
      expect(database.prepare("pragma foreign_keys").get()).toMatchObject({
        foreign_keys: 1,
      });
    } finally {
      database.close();
    }
  });

  it.each([
    {
      name: "permission description",
      seed: (database: DatabaseSync) =>
        database
          .prepare(
            `insert into auth_permission_definition
              (id, description, scope_type_present, scope_type, created_at, updated_at)
             values ('organization.read', 'conflict', 1, 'organization', 0, 0)`
          )
          .run(),
    },
    {
      name: "permission scope",
      seed: (database: DatabaseSync) =>
        database
          .prepare(
            `insert into auth_permission_definition
              (id, description, scope_type_present, scope_type, created_at, updated_at)
             values ('organization.read', 'Read an organization', 1, 'mailbox', 0, 0)`
          )
          .run(),
    },
    {
      name: "permission lifecycle",
      seed: (database: DatabaseSync) =>
        database
          .prepare(
            `insert into auth_permission_definition
              (id, description, scope_type_present, scope_type, created_at,
               updated_at, disabled_at)
             values ('organization.read', 'Read an organization', 1,
                     'organization', 0, 1, 1)`
          )
          .run(),
    },
    {
      name: "role lifecycle",
      seed: (database: DatabaseSync) =>
        database
          .prepare(
            `insert into auth_role_definition
              (id, description, created_at, updated_at, deleted_at)
             values ('organization.member', 'Read organization membership', 0, 1, 1)`
          )
          .run(),
    },
    {
      name: "extra canonical mapping",
      seed: (database: DatabaseSync) =>
        database
          .prepare(
            `insert into auth_role_permission
              (role_id, permission_id, scope_type_present, scope_type)
             values ('organization.member', 'mailbox.read', 1, 'mailbox')`
          )
          .run(),
    },
    {
      name: "malformed canonical mapping",
      seed: (database: DatabaseSync) =>
        database
          .prepare(
            `insert into auth_role_permission
              (role_id, permission_id, scope_type_present, scope_type)
             values ('organization.member', 'organization.read', 1, 'mailbox')`
          )
          .run(),
    },
  ])("aborts $name conflict before partial seed", async ({ seed }) => {
    const database = new DatabaseSync(":memory:");

    try {
      await applyControlPlaneMigrationsThrough(database, through1019);
      seed(database);
      const before = {
        mappings: rolePermissions(database),
        permissions: permissionDefinitions(database),
        roles: roleDefinitions(database),
      };

      await expect(
        applyControlPlaneMigration(database, migration)
      ).rejects.toThrow(/CHECK constraint failed: valid = 1/u);
      expect({
        mappings: rolePermissions(database),
        permissions: permissionDefinitions(database),
        roles: roleDefinitions(database),
      }).toStrictEqual(before);
    } finally {
      database.close();
    }
  });

  it("protects canonical definitions and mappings while leaving legacy catalog usable", async () => {
    const database = new DatabaseSync(":memory:");

    try {
      await applyControlPlaneMigrations(database);
      const permissionMutation =
        /canonical permission definitions are immutable/u;
      const roleMutation = /canonical role definitions are immutable/u;
      const mappingMutation = /canonical role permission/u;

      expect(() =>
        database
          .prepare(
            "update auth_permission_definition set description = ? where id = ?"
          )
          .run("Changed", "organization.read")
      ).toThrow(permissionMutation);
      expect(() =>
        database
          .prepare("delete from auth_permission_definition where id = ?")
          .run("organization.read")
      ).toThrow(permissionMutation);
      expect(() =>
        database
          .prepare(
            `insert or replace into auth_permission_definition
              (id, description, scope_type_present, scope_type, created_at, updated_at)
             values (?, ?, ?, ?, ?, ?)`
          )
          .run("organization.read", "Changed", 1, "organization", 0, 0)
      ).toThrow(permissionMutation);
      expect(() =>
        database
          .prepare(
            `insert into auth_permission_definition
              (id, description, scope_type_present, scope_type, created_at, updated_at)
             values (?, ?, ?, ?, ?, ?)
             on conflict(id) do update set description = excluded.description`
          )
          .run("organization.read", "Changed", 1, "organization", 0, 0)
      ).toThrow(permissionMutation);
      expect(() =>
        database
          .prepare(
            "update auth_role_definition set disabled_at = 1 where id = ?"
          )
          .run("organization.owner")
      ).toThrow(roleMutation);
      expect(() =>
        database
          .prepare("delete from auth_role_definition where id = ?")
          .run("organization.owner")
      ).toThrow(roleMutation);
      expect(() =>
        database
          .prepare(
            `insert or replace into auth_role_definition
              (id, description, created_at, updated_at)
             values (?, ?, ?, ?)`
          )
          .run("organization.owner", "Changed", 0, 0)
      ).toThrow(roleMutation);
      expect(() =>
        database
          .prepare(
            `insert into auth_role_definition
              (id, description, created_at, updated_at)
             values (?, ?, ?, ?)
             on conflict(id) do update set description = excluded.description`
          )
          .run("organization.owner", "Changed", 0, 0)
      ).toThrow(roleMutation);
      expect(() =>
        database
          .prepare(
            `update auth_role_permission set scope_type = 'mailbox'
              where role_id = 'organization.member'
                and permission_id = 'organization.read'`
          )
          .run()
      ).toThrow(mappingMutation);
      expect(() =>
        database
          .prepare(
            `delete from auth_role_permission
              where role_id = 'organization.member'
                and permission_id = 'organization.read'`
          )
          .run()
      ).toThrow(mappingMutation);
      expect(() =>
        database
          .prepare(
            `insert or replace into auth_role_permission
              (role_id, permission_id, scope_type_present, scope_type)
             values ('organization.member', 'organization.read', 1, 'organization')`
          )
          .run()
      ).toThrow(mappingMutation);
      expect(() =>
        database
          .prepare(
            `insert into auth_role_permission
              (role_id, permission_id, scope_type_present, scope_type)
             values ('organization.member', 'organization.read', 1, 'organization')
             on conflict do update set scope_type = excluded.scope_type`
          )
          .run()
      ).toThrow(mappingMutation);
      for (const values of [
        ["organization.member", "mailbox.read", 1, "mailbox"],
        ["organization.member", "organization.read", 1, "mailbox"],
        ["mailbox.owner", "send_identity.use", 1, "send_identity"],
        ["mailbox.owner", "unknown.permission", 1, "mailbox"],
      ] as const) {
        expect(() =>
          database
            .prepare(
              `insert into auth_role_permission
                (role_id, permission_id, scope_type_present, scope_type)
               values (?, ?, ?, ?)`
            )
            .run(...values)
        ).toThrow(mappingMutation);
      }

      database
        .prepare("update auth_role_definition set description = ? where id = ?")
        .run("Legacy owner remains editable", LegacyMailboxRole.owner);
      database
        .prepare(
          `insert into auth_permission_definition
            (id, description, scope_type_present, scope_type, created_at, updated_at)
           values ('custom.test', 'Custom test permission', 1, 'mailbox', 1, 1)`
        )
        .run();
      database
        .prepare(
          `insert into auth_role_permission
            (role_id, permission_id, scope_type_present, scope_type)
           values (?, ?, ?, ?)`
        )
        .run(LegacyMailboxRole.owner, "custom.test", 1, "mailbox");
      expect(
        database
          .prepare("select description from auth_role_definition where id = ?")
          .get(LegacyMailboxRole.owner)
      ).toMatchObject({ description: "Legacy owner remains editable" });
      expect(
        database
          .prepare(
            `select count(*) as count from auth_role_permission
              where role_id = ? and permission_id = ?`
          )
          .get(LegacyMailboxRole.owner, "custom.test")
      ).toMatchObject({ count: 1 });
      expectCanonicalCatalog(database);
    } finally {
      database.close();
    }
  });

  it("enforces the literal ADR matrix for product organization and mailbox grants", async () => {
    const database = new DatabaseSync(":memory:");

    try {
      await applyControlPlaneMigrations(database);
      const program = Effect.gen(function* () {
        const administration = yield* PermissionAdministration;
        const permissions = yield* Permissions;
        const organizationA = makeOrganizationScopeId("org-a");
        const organizationB = makeOrganizationScopeId("org-b");
        const mailboxA = makeMailboxScopeId("mailbox-a");
        const mailboxB = makeMailboxScopeId("mailbox-b");
        const folderA = makeFolderId("folder-a");
        const folderB = makeFolderId("folder-b");
        const identityA = makeSendIdentityId("identity-a");
        const identityB = makeSendIdentityId("identity-b");
        const subjects = new Map(
          authorizationRoleDefinitions.map(({ id }) => [
            id,
            PermissionSubject.make("user", id),
          ])
        );

        for (const { id: role } of authorizationRoleDefinitions) {
          const subject = subjects.get(role);
          if (subject === undefined) {
            throw new Error(`Missing subject for ${role}`);
          }
          yield* administration.grantRole({
            role,
            scope: role.startsWith("organization.")
              ? organizationScope(organizationA)
              : mailboxScope(mailboxA),
            subject,
          });
        }

        for (const { id: role } of authorizationRoleDefinitions) {
          const subject = subjects.get(role);
          if (subject === undefined) {
            throw new Error(`Missing subject for ${role}`);
          }
          for (const {
            id: permission,
            scopeType,
          } of authorizationPermissionDefinitions) {
            const expectedScope =
              expectedPermissionScopes[
                permission as keyof typeof expectedPermissionScopes
              ];
            expect(scopeType).toBe(expectedScope);
            const expectedPermissionsForRole = expectedRolePermissions[
              role as keyof typeof expectedRolePermissions
            ] as readonly string[];
            const expected =
              expectedScope !== "folder" &&
              expectedScope !== "send_identity" &&
              expectedPermissionsForRole.includes(permission);
            const scope =
              expectedScope === "organization"
                ? organizationScope(organizationA)
                : expectedScope === "folder"
                  ? folderScope(mailboxA, folderA)
                  : expectedScope === "send_identity"
                    ? sendIdentityScope(mailboxA, identityA)
                    : mailboxScope(mailboxA);
            const otherScope =
              expectedScope === "organization"
                ? organizationScope(organizationB)
                : expectedScope === "folder"
                  ? folderScope(mailboxA, folderB)
                  : expectedScope === "send_identity"
                    ? sendIdentityScope(mailboxA, identityB)
                    : mailboxScope(mailboxB);
            expect(
              yield* permissions.hasPermission({ permission, scope, subject })
            ).toBe(expected);
            expect(
              yield* permissions.hasPermission({
                permission,
                scope: otherScope,
                subject,
              })
            ).toBeFalsy();
          }
        }
      }).pipe(
        Effect.provide(
          MailPermissionsEffectAuthLayer.pipe(
            Layer.provide(
              D1EffectQbSqliteAuthStorageLive(makeTestD1Database(database))
            )
          )
        )
      );

      await Effect.runPromise(program);
      expect(grantCounts(database)).toStrictEqual({ permissions: 0, roles: 7 });
    } finally {
      database.close();
    }
  });

  it("keeps role-to-folder mappings as an internal exact-folder primitive", async () => {
    const database = new DatabaseSync(":memory:");

    try {
      await applyControlPlaneMigrations(database);
      const program = Effect.gen(function* () {
        const administration = yield* PermissionAdministration;
        const permissions = yield* Permissions;
        const mailboxA = makeMailboxScopeId("mailbox-a");
        const mailboxB = makeMailboxScopeId("mailbox-b");
        const folderA = makeFolderId("folder-a");
        const folderB = makeFolderId("folder-b");

        for (const role of [
          MailboxRole.owner,
          MailboxRole.manager,
          MailboxRole.editor,
          MailboxRole.viewer,
        ] as const) {
          const subject = PermissionSubject.make("user", role);
          yield* administration.grantRole({
            role,
            scope: folderScope(mailboxA, folderA),
            subject,
          });

          for (const permission of [
            AuthorizationPermission.folderRead,
            AuthorizationPermission.folderModify,
          ] as const) {
            const expectedPermissionsForRole = expectedRolePermissions[
              role as keyof typeof expectedRolePermissions
            ] as readonly string[];
            expect(
              yield* permissions.hasPermission({
                permission,
                scope: folderScope(mailboxA, folderA),
                subject,
              })
            ).toBe(expectedPermissionsForRole.includes(permission));
            expect(
              yield* permissions.hasPermission({
                permission,
                scope: folderScope(mailboxA, folderB),
                subject,
              })
            ).toBeFalsy();
            expect(
              yield* permissions.hasPermission({
                permission,
                scope: folderScope(mailboxB, folderA),
                subject,
              })
            ).toBeFalsy();
          }
        }
      }).pipe(
        Effect.provide(
          MailPermissionsEffectAuthLayer.pipe(
            Layer.provide(
              D1EffectQbSqliteAuthStorageLive(makeTestD1Database(database))
            )
          )
        )
      );

      await Effect.runPromise(program);
      expect(grantCounts(database)).toStrictEqual({ permissions: 0, roles: 4 });
    } finally {
      database.close();
    }
  });

  it("keeps send identity use direct-only and exact-tuple scoped", async () => {
    const database = new DatabaseSync(":memory:");

    try {
      await applyControlPlaneMigrations(database);
      const program = Effect.gen(function* () {
        const administration = yield* PermissionAdministration;
        const permissions = yield* Permissions;
        const mailboxA = makeMailboxScopeId("mailbox-a");
        const mailboxB = makeMailboxScopeId("mailbox-b");
        const identityA = makeSendIdentityId("identity-a");
        const identityB = makeSendIdentityId("identity-b");
        const subject = PermissionSubject.make("user", "send-identity-user");

        yield* administration.grantRole({
          role: MailboxRole.owner,
          scope: mailboxScope(mailboxA),
          subject,
        });
        expect(
          yield* permissions.hasPermission({
            permission: AuthorizationPermission.sendIdentityUse,
            scope: sendIdentityScope(mailboxA, identityA),
            subject,
          })
        ).toBeFalsy();

        yield* administration.grantPermission({
          permission: AuthorizationPermission.sendIdentityUse,
          scope: sendIdentityScope(mailboxA, identityA),
          subject,
        });
        expect(
          yield* permissions.hasPermission({
            permission: AuthorizationPermission.sendIdentityUse,
            scope: sendIdentityScope(mailboxA, identityA),
            subject,
          })
        ).toBeTruthy();
        expect(
          yield* permissions.hasPermission({
            permission: AuthorizationPermission.sendIdentityUse,
            scope: sendIdentityScope(mailboxA, identityB),
            subject,
          })
        ).toBeFalsy();
        expect(
          yield* permissions.hasPermission({
            permission: AuthorizationPermission.sendIdentityUse,
            scope: sendIdentityScope(mailboxB, identityA),
            subject,
          })
        ).toBeFalsy();
      }).pipe(
        Effect.provide(
          MailPermissionsEffectAuthLayer.pipe(
            Layer.provide(
              D1EffectQbSqliteAuthStorageLive(makeTestD1Database(database))
            )
          )
        )
      );

      await Effect.runPromise(program);
      expect(grantCounts(database)).toStrictEqual({ permissions: 1, roles: 1 });
    } finally {
      database.close();
    }
  });
});
