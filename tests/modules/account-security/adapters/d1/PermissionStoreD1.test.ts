import { DatabaseSync } from "node:sqlite";
// oxlint-disable vitest/max-expects -- Contract cases intentionally verify related method semantics together.

import {
  PermissionId,
  RoleId,
  UnixMillis,
} from "@effect-auth/core/Identifiers";
import {
  PermissionStore,
  PermissionStoreError,
} from "@effect-auth/core/Permission";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { describe, expect, it } from "vitest";

import { PermissionStoreD1Layer } from "#/modules/account-security/adapters/d1/PermissionStoreD1";
import {
  ControlPlaneD1Binding,
  ControlPlaneDatabaseLayer,
} from "#/platform/control-plane-d1/ControlPlaneDatabase";

import {
  applyControlPlaneMigrations,
  makeTestD1Database,
} from "../../../../support/d1";

const permission = (id: string) => PermissionId(id);
const role = (id: string) => RoleId(id);
const subject = { id: "subject-a", type: "user" } as const;
const mailboxA = { id: "mailbox-a", type: "mailbox" } as const;
const mailboxB = { id: "mailbox-b", type: "mailbox" } as const;

const storeLayer = (database: DatabaseSync) => {
  const binding = Layer.succeed(
    ControlPlaneD1Binding,
    ControlPlaneD1Binding.of({
      database: makeTestD1Database(database) as unknown as D1Database,
    })
  );
  return PermissionStoreD1Layer.pipe(
    Layer.provide(ControlPlaneDatabaseLayer.pipe(Layer.provide(binding)))
  );
};

const run = <A, E>(
  database: DatabaseSync,
  effect: Effect.Effect<A, E, PermissionStore>
) => Effect.runPromise(effect.pipe(Effect.provide(storeLayer(database))));

describe("native D1 permission store", () => {
  it("implements definition conflicts, optimistic mutations, status filters, and pagination", async () => {
    const database = new DatabaseSync(":memory:");
    await applyControlPlaneMigrations(database);

    try {
      const result = await run(
        database,
        Effect.gen(function* () {
          const store = yield* PermissionStore;
          const first = {
            id: permission("zz.test.read"),
            description: "Read mail",
            scopeType: "mailbox",
            createdAt: UnixMillis(100),
            updatedAt: UnixMillis(100),
          };
          const second = {
            id: permission("zz.test.send"),
            createdAt: UnixMillis(100),
            updatedAt: UnixMillis(100),
          };
          const third = {
            id: permission("zz.test.write"),
            createdAt: UnixMillis(100),
            updatedAt: UnixMillis(100),
          };

          const created = yield* store.createPermissionDefinition(first);
          const conflict = yield* store.createPermissionDefinition(first);
          yield* store.createPermissionDefinition(second);
          yield* store.createPermissionDefinition(third);
          const page = yield* store.listPermissionDefinitions({
            after: permission("zz.test.read"),
            limit: 1,
          });
          const stale = yield* store.updatePermissionDefinition({
            id: first.id,
            expectedUpdatedAt: UnixMillis(99),
            updatedAt: UnixMillis(200),
            description: "stale",
          });
          const updated = yield* store.updatePermissionDefinition({
            id: first.id,
            expectedUpdatedAt: first.updatedAt,
            updatedAt: UnixMillis(200),
            description: null,
            scopeType: null,
          });
          const disabled = yield* store.setPermissionDefinitionDisabled({
            id: first.id,
            expectedUpdatedAt: UnixMillis(200),
            updatedAt: UnixMillis(300),
            disabledAt: UnixMillis(250),
          });
          const active = yield* store.listPermissionDefinitions();
          const includingDisabled = yield* store.listPermissionDefinitions({
            includeDisabled: true,
          });
          const deleted = yield* store.deletePermissionDefinition({
            id: first.id,
            expectedUpdatedAt: UnixMillis(300),
            updatedAt: UnixMillis(400),
            deletedAt: UnixMillis(350),
          });
          const afterDelete = yield* store.setPermissionDefinitionDisabled({
            id: first.id,
            expectedUpdatedAt: UnixMillis(400),
            updatedAt: UnixMillis(500),
          });
          const found = yield* store.findPermissionDefinition(first.id);

          return {
            active,
            afterDelete,
            conflict,
            created,
            deleted,
            disabled,
            found,
            includingDisabled,
            page,
            stale,
            updated,
          };
        })
      );

      expect(result.created).toBeTruthy();
      expect(result.conflict).toBeFalsy();
      expect(Option.isNone(result.stale)).toBeTruthy();
      expect(Option.getOrThrow(result.updated)).toMatchObject({
        id: permission("zz.test.read"),
        updatedAt: 200,
      });
      expect(Option.getOrThrow(result.updated)).not.toHaveProperty(
        "description"
      );
      expect(Option.getOrThrow(result.updated)).not.toHaveProperty("scopeType");
      expect(Option.getOrThrow(result.disabled)).toMatchObject({
        disabledAt: 250,
      });
      expect(
        result.active
          .map(({ id }) => id)
          .filter((id) => id.startsWith("zz.test."))
      ).toStrictEqual([
        permission("zz.test.send"),
        permission("zz.test.write"),
      ]);
      expect(
        result.includingDisabled.filter(({ id }) => id.startsWith("zz.test."))
      ).toHaveLength(3);
      expect(result.page.map(({ id }) => id)).toStrictEqual([
        permission("zz.test.send"),
      ]);
      expect(Option.getOrThrow(result.deleted)).toMatchObject({
        deletedAt: 350,
        updatedAt: 400,
      });
      expect(Option.isNone(result.afterDelete)).toBeTruthy();
      expect(Option.getOrThrow(result.found)).toMatchObject({ deletedAt: 350 });
    } finally {
      database.close();
    }
  });

  it("implements the equivalent role definition lifecycle with deterministic listing", async () => {
    const database = new DatabaseSync(":memory:");
    await applyControlPlaneMigrations(database);

    try {
      const result = await run(
        database,
        Effect.gen(function* () {
          const store = yield* PermissionStore;
          const admin = {
            id: role("zz-test-admin"),
            description: "Administrator",
            createdAt: UnixMillis(10),
            updatedAt: UnixMillis(10),
          };
          yield* store.createRoleDefinition({
            ...admin,
            id: role("zz-test-viewer"),
          });
          const created = yield* store.createRoleDefinition(admin);
          const conflict = yield* store.createRoleDefinition(admin);
          const updated = yield* store.updateRoleDefinition({
            id: admin.id,
            expectedUpdatedAt: UnixMillis(10),
            updatedAt: UnixMillis(20),
            description: null,
          });
          const disabled = yield* store.setRoleDefinitionDisabled({
            id: admin.id,
            expectedUpdatedAt: UnixMillis(20),
            updatedAt: UnixMillis(30),
            disabledAt: UnixMillis(25),
          });
          const active = yield* store.listRoleDefinitions();
          const all = yield* store.listRoleDefinitions({
            includeDisabled: true,
          });
          const deleted = yield* store.deleteRoleDefinition({
            id: admin.id,
            expectedUpdatedAt: UnixMillis(30),
            updatedAt: UnixMillis(40),
            deletedAt: UnixMillis(35),
          });
          const stale = yield* store.updateRoleDefinition({
            id: admin.id,
            expectedUpdatedAt: UnixMillis(30),
            updatedAt: UnixMillis(50),
          });
          const found = yield* store.findRoleDefinition(admin.id);
          return {
            active,
            all,
            conflict,
            created,
            deleted,
            disabled,
            found,
            stale,
            updated,
          };
        })
      );

      expect(result.created).toBeTruthy();
      expect(result.conflict).toBeFalsy();
      expect(Option.getOrThrow(result.updated)).not.toHaveProperty(
        "description"
      );
      expect(Option.getOrThrow(result.disabled)).toMatchObject({
        disabledAt: 25,
      });
      expect(
        result.active
          .map(({ id }) => id)
          .filter((id) => id.startsWith("zz-test-"))
      ).toStrictEqual([role("zz-test-viewer")]);
      expect(
        result.all.map(({ id }) => id).filter((id) => id.startsWith("zz-test-"))
      ).toStrictEqual([role("zz-test-admin"), role("zz-test-viewer")]);
      expect(Option.getOrThrow(result.deleted)).toMatchObject({
        deletedAt: 35,
      });
      expect(Option.isNone(result.stale)).toBeTruthy();
      expect(Option.getOrThrow(result.found)).toMatchObject({ deletedAt: 35 });
    } finally {
      database.close();
    }
  });

  it("upserts, reactivates, filters, orders, and revokes permission and role grants", async () => {
    const database = new DatabaseSync(":memory:");
    await applyControlPlaneMigrations(database);

    try {
      const result = await run(
        database,
        Effect.gen(function* () {
          const store = yield* PermissionStore;
          const read = permission("mail.read");
          const viewer = role("viewer");
          yield* store.grantPermission({
            subject,
            permission: read,
            scope: { type: "global" },
            expiresAt: UnixMillis(200),
            metadata: { source: "first" },
          });
          yield* store.revokePermission({
            subject,
            permission: read,
            scope: { type: "global" },
            revokedAt: UnixMillis(120),
          });
          yield* store.grantPermission({
            subject,
            permission: read,
            expiresAt: UnixMillis(300),
            metadata: { source: "reactivated" },
          });
          yield* store.grantPermission({
            subject,
            permission: permission("mail.send"),
            scope: mailboxA,
            expiresAt: UnixMillis(150),
          });
          yield* store.grantRole({
            subject,
            role: viewer,
            scope: mailboxA,
            expiresAt: UnixMillis(300),
            metadata: { source: "role" },
          });
          yield* store.revokeRole({
            subject,
            role: viewer,
            scope: mailboxA,
            revokedAt: UnixMillis(140),
          });
          yield* store.grantRole({
            subject,
            role: viewer,
            scope: mailboxA,
            expiresAt: UnixMillis(400),
          });

          const activePermissions = yield* store.listPermissionGrants({
            activity: "active",
            at: UnixMillis(200),
          });
          const inactivePermissions = yield* store.listPermissionGrants({
            activity: "inactive",
            at: UnixMillis(200),
          });
          const global = yield* store.listPermissionGrants({
            activity: "all",
            scope: { type: "global" },
          });
          const roles = yield* store.listRoleGrants({
            activity: "active",
            at: UnixMillis(200),
            subject,
          });
          return { activePermissions, global, inactivePermissions, roles };
        })
      );

      expect(result.activePermissions).toMatchObject([
        {
          metadata: { source: "reactivated" },
          permission: permission("mail.read"),
          subject,
        },
      ]);
      expect(result.activePermissions[0]).not.toHaveProperty("scope");
      expect(result.inactivePermissions).toMatchObject([
        { permission: permission("mail.send"), scope: mailboxA },
      ]);
      expect(result.global).toHaveLength(1);
      expect(result.roles).toMatchObject([
        { expiresAt: 400, role: role("viewer"), scope: mailboxA },
      ]);
      expect(
        database
          .prepare(
            "select scope_type, scope_id_present, scope_id from auth_permission_grant where permission_id = ?"
          )
          .get("mail.read")
      ).toMatchObject({
        scope_id: "",
        scope_id_present: 0,
        scope_type: "global",
      });
    } finally {
      database.close();
    }
  });

  it("checks direct and role-derived permissions with global inheritance and scope types", async () => {
    const database = new DatabaseSync(":memory:");
    await applyControlPlaneMigrations(database);

    try {
      const result = await run(
        database,
        Effect.gen(function* () {
          const store = yield* PermissionStore;
          const read = permission("test.mail.read");
          const send = permission("test.mail.send");
          const manage = permission("test.mail.manage");
          const viewer = role("test-viewer");
          yield* store.grantPermission({ subject, permission: read });
          yield* store.grantRole({ subject, role: viewer, scope: mailboxA });
          yield* store.assignRolePermission({ role: viewer, permission: send });
          yield* store.assignRolePermission({
            role: viewer,
            permission: manage,
            scopeType: "organization",
          });
          yield* store.assignRolePermission({
            role: viewer,
            permission: manage,
            scopeType: "mailbox",
          });
          yield* store.assignRolePermission({ role: viewer, permission: send });

          const rolePermissions = yield* store.listRolePermissions({
            role: viewer,
          });
          const unconstrained = yield* store.listRolePermissions({
            role: viewer,
            scopeType: null,
          });
          const directInherited = yield* store.hasPermission({
            subject,
            permission: read,
            scope: mailboxB,
          });
          const roleExact = yield* store.hasPermission({
            subject,
            permission: send,
            scope: mailboxA,
          });
          const wrongScope = yield* store.hasPermission({
            subject,
            permission: send,
            scope: mailboxB,
          });
          const typed = yield* store.hasPermission({
            subject,
            permission: manage,
            scope: mailboxA,
          });
          const hasRole = yield* store.hasRole({
            subject,
            role: viewer,
            scope: mailboxA,
          });
          const lacksRole = yield* store.hasRole({
            subject,
            role: viewer,
            scope: mailboxB,
          });
          yield* store.removeRolePermission({ role: viewer, permission: send });
          const removed = yield* store.listRolePermissions({
            role: viewer,
            permission: send,
          });
          return {
            directInherited,
            hasRole,
            lacksRole,
            removed,
            roleExact,
            rolePermissions,
            typed,
            unconstrained,
            wrongScope,
          };
        })
      );

      expect(result.directInherited).toBeTruthy();
      expect(result.roleExact).toBeTruthy();
      expect(result.wrongScope).toBeFalsy();
      expect(result.typed).toBeTruthy();
      expect(result.hasRole).toBeTruthy();
      expect(result.lacksRole).toBeFalsy();
      expect(result.rolePermissions).toHaveLength(3);
      expect(result.unconstrained).toStrictEqual([
        { permission: permission("test.mail.send"), role: role("test-viewer") },
      ]);
      expect(result.removed).toStrictEqual([]);
    } finally {
      database.close();
    }
  });

  it("checks role-derived permission with constant query parameters", async () => {
    const database = new DatabaseSync(":memory:");
    await applyControlPlaneMigrations(database);

    try {
      const allowed = await run(
        database,
        Effect.gen(function* () {
          const store = yield* PermissionStore;
          for (let index = 0; index < 110; index += 1) {
            const assignedRole = role(`parameter-limit-${index}`);
            yield* store.grantRole({ subject, role: assignedRole });
            if (index === 109) {
              yield* store.assignRolePermission({
                role: assignedRole,
                permission: permission("test.parameter-limit"),
              });
            }
          }
          return yield* store.hasPermission({
            subject,
            permission: permission("test.parameter-limit"),
          });
        })
      );

      expect(allowed).toBeTruthy();
    } finally {
      database.close();
    }
  });

  it("maps database and persisted codec failures to operation-specific typed errors", async () => {
    const database = new DatabaseSync(":memory:");
    await applyControlPlaneMigrations(database);
    database.exec(`insert into auth_permission_grant
      (subject_type, subject_id, permission_id, scope_type, scope_id_present, scope_id, metadata)
      values ('user', 'subject-a', 'mail.read', 'global', 0, '', 'null')`);

    try {
      const codecError = await run(
        database,
        PermissionStore.pipe(
          Effect.flatMap((store) =>
            store.listPermissionGrants({ activity: "all" })
          ),
          Effect.flip
        )
      );
      expect(codecError).toBeInstanceOf(PermissionStoreError);
      expect(codecError).toMatchObject({ operation: "list_permission_grants" });

      database.exec("drop table auth_role_grant");
      const databaseError = await run(
        database,
        PermissionStore.pipe(
          Effect.flatMap((store) =>
            store.hasRole({ subject, role: role("viewer"), scope: mailboxA })
          ),
          Effect.flip
        )
      );
      expect(databaseError).toBeInstanceOf(PermissionStoreError);
      expect(databaseError).toMatchObject({ operation: "has_role" });
    } finally {
      database.close();
    }
  });
});
