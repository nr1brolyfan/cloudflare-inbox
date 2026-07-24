/* oxlint-disable vitest/max-expects, vitest/no-conditional-expect -- The schema contract exercises the complete lifecycle matrix and storage boundaries together. */
import { DatabaseSync } from "node:sqlite";

import { getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import { appOrganizationMember } from "#/modules/organization/adapters/d1/OrganizationSchema";
import { OrganizationMemberSchema } from "#/modules/organization/domain/OrganizationMember";

import {
  applyControlPlaneMigration,
  applyControlPlaneMigrations,
  applyControlPlaneMigrationsThrough,
} from "../../support/d1";

const integrityState = (database: DatabaseSync) => ({
  foreignKeys: database.prepare("pragma foreign_key_check").all(),
  integrity: database
    .prepare("pragma integrity_check")
    .all()
    .map((row) => ({ ...row })),
});

const memberRow = (database: DatabaseSync, id: string) => {
  const row = database
    .prepare("select * from app_organization_member where id = ?")
    .get(id);
  return row === undefined ? undefined : { ...row };
};

const seedPrincipal = (
  database: DatabaseSync,
  suffix = "a",
  userId = `user-${suffix}`
) => {
  database
    .prepare(
      "insert into auth_user (id, created_at, updated_at) values (?, 1000, 1000)"
    )
    .run(userId);
  database
    .prepare(
      `insert into app_organization (id, created_at, updated_at)
       values (?, 1000, 1000)`
    )
    .run(`organization-${suffix}`);
  return { organizationId: `organization-${suffix}`, userId };
};

const insertMember = (
  database: DatabaseSync,
  member: {
    readonly createdAt?: number | bigint | Buffer;
    readonly id: string | Buffer;
    readonly organizationId: string | Buffer;
    readonly revokedAt?: number | bigint | Buffer | null;
    readonly status?: string | Buffer;
    readonly suspendedAt?: number | bigint | Buffer | null;
    readonly updatedAt?: number | bigint | Buffer;
    readonly userId: string | Buffer;
    readonly version?: number | bigint | Buffer;
  }
) =>
  database
    .prepare(
      `insert into app_organization_member
        (id, organization_id, user_id, status, created_at, updated_at,
         suspended_at, revoked_at, version)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      member.id,
      member.organizationId,
      member.userId,
      member.status ?? "active",
      member.createdAt ?? 1000,
      member.updatedAt ?? 1000,
      member.suspendedAt ?? null,
      member.revokedAt ?? null,
      member.version ?? 1
    );

const transitionMember = (
  database: DatabaseSync,
  member: {
    readonly id: string;
    readonly revokedAt: number | bigint | Buffer | null;
    readonly status: string | Buffer;
    readonly suspendedAt: number | bigint | Buffer | null;
    readonly updatedAt: number | bigint | Buffer;
    readonly version: number | bigint | Buffer;
  }
) =>
  database
    .prepare(
      `update app_organization_member
          set status = ?, updated_at = ?, suspended_at = ?, revoked_at = ?,
              version = ?
        where id = ?`
    )
    .run(
      member.status,
      member.updatedAt,
      member.suspendedAt,
      member.revokedAt,
      member.version,
      member.id
    );

const makeDatabase = async () => {
  const database = new DatabaseSync(":memory:");
  await applyControlPlaneMigrations(database);
  return database;
};

describe("organization member D1 schema", () => {
  it("upgrades real 1018 state additively and leaves membership empty", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrationsThrough(
        database,
        "1018_app_organization.sql"
      );
      seedPrincipal(database);
      database.exec(`
        insert into app_mailbox
          (id, display_name, status, created_by_user_id, created_at, updated_at,
           version)
        values ('primary', 'Primary', 'active', 'user-a', 1000, 1000, 1);
        insert into app_mailbox_member
          (mailbox_id, user_id, created_at, updated_at)
        values ('primary', 'user-a', 1000, 1000);
        insert into auth_permission_grant
          (subject_type, subject_id, permission_id, scope_type,
           scope_id_present, scope_id)
        values ('user', 'user-a', 'mailbox.read', 'mailbox', 1, 'primary');
        insert into auth_role_grant
          (subject_type, subject_id, role_id, scope_type, scope_id_present,
           scope_id)
        values ('user', 'user-a', 'owner', 'mailbox', 1, 'primary');
      `);

      const stateBefore = {
        grants: database
          .prepare(
            `select * from auth_permission_grant
             union all
             select * from auth_role_grant`
          )
          .all(),
        mailboxDiscovery: database
          .prepare(
            `select mailbox_id, user_id from app_mailbox_member
             where user_id = 'user-a' and revoked_at is null`
          )
          .all(),
        singleton: database
          .prepare(
            `select type, name, tbl_name, sql from sqlite_master
             where name = 'app_mailbox_singleton_idx'`
          )
          .get(),
        tables: {
          auth: database.prepare("select * from auth_user").all(),
          mailbox: database.prepare("select * from app_mailbox").all(),
          mailboxMember: database
            .prepare("select * from app_mailbox_member")
            .all(),
          organization: database
            .prepare("select * from app_organization")
            .all(),
        },
      };

      await applyControlPlaneMigration(
        database,
        "1019_app_organization_member.sql"
      );

      expect({
        grants: database
          .prepare(
            `select * from auth_permission_grant
             union all
             select * from auth_role_grant`
          )
          .all(),
        mailboxDiscovery: database
          .prepare(
            `select mailbox_id, user_id from app_mailbox_member
             where user_id = 'user-a' and revoked_at is null`
          )
          .all(),
        memberships: database
          .prepare("select * from app_organization_member")
          .all(),
        singleton: database
          .prepare(
            `select type, name, tbl_name, sql from sqlite_master
             where name = 'app_mailbox_singleton_idx'`
          )
          .get(),
        tables: {
          auth: database.prepare("select * from auth_user").all(),
          mailbox: database.prepare("select * from app_mailbox").all(),
          mailboxMember: database
            .prepare("select * from app_mailbox_member")
            .all(),
          organization: database
            .prepare("select * from app_organization")
            .all(),
        },
      }).toStrictEqual({ ...stateBefore, memberships: [] });
      expect(integrityState(database)).toStrictEqual({
        foreignKeys: [],
        integrity: [{ integrity_check: "ok" }],
      });
    } finally {
      database.close();
    }
  });

  it("enforces foreign keys and the exact initial row contract", async () => {
    const database = await makeDatabase();
    try {
      const principal = seedPrincipal(
        database,
        "external",
        "external:user@example.test"
      );
      insertMember(database, {
        id: "member-a",
        organizationId: principal.organizationId,
        userId: principal.userId,
      });
      expect(memberRow(database, "member-a")).toStrictEqual({
        created_at: 1000,
        id: "member-a",
        organization_id: "organization-external",
        revoked_at: null,
        status: "active",
        suspended_at: null,
        updated_at: 1000,
        user_id: "external:user@example.test",
        version: 1,
      });

      for (const invalid of [
        {
          id: "missing-org",
          organizationId: "missing",
          userId: principal.userId,
        },
        {
          id: "missing-user",
          organizationId: principal.organizationId,
          userId: "missing",
        },
      ]) {
        expect(() => insertMember(database, invalid)).toThrow(/foreign key/iu);
      }
      expect(() =>
        insertMember(database, {
          id: "starts-suspended",
          status: "suspended",
          suspendedAt: 1000,
          ...seedPrincipal(database, "starts-suspended"),
        })
      ).toThrow(/start active/iu);
      expect(() =>
        insertMember(database, {
          id: "starts-updated",
          updatedAt: 1001,
          ...seedPrincipal(database, "starts-updated"),
        })
      ).toThrow(/start active/iu);
      expect(() =>
        database.exec(
          "delete from auth_user where id = 'external:user@example.test'"
        )
      ).toThrow(/foreign key/iu);
      expect(() =>
        database.exec(
          "update auth_user set id = 'renamed-user' where id = 'external:user@example.test'"
        )
      ).toThrow(/foreign key/iu);
    } finally {
      database.close();
    }
  });

  it("enforces the complete transition matrix", async () => {
    const database = await makeDatabase();
    try {
      const statuses = ["active", "suspended", "revoked"] as const;
      const allowed = new Set([
        "active->suspended",
        "active->revoked",
        "suspended->active",
        "suspended->revoked",
      ]);

      for (const [sourceIndex, source] of statuses.entries()) {
        for (const [targetIndex, target] of statuses.entries()) {
          const suffix = `${sourceIndex}-${targetIndex}`;
          const principal = seedPrincipal(database, suffix);
          const id = `member-${suffix}`;
          insertMember(database, { id, ...principal });
          if (source === "suspended") {
            transitionMember(database, {
              id,
              revokedAt: null,
              status: "suspended",
              suspendedAt: 1100,
              updatedAt: 1100,
              version: 2,
            });
          } else if (source === "revoked") {
            transitionMember(database, {
              id,
              revokedAt: 1100,
              status: "revoked",
              suspendedAt: null,
              updatedAt: 1100,
              version: 2,
            });
          }

          const before = memberRow(database, id);
          const version = source === "active" ? 2 : 3;
          const transition = () =>
            transitionMember(database, {
              id,
              revokedAt: target === "revoked" ? 1200 : null,
              status: target,
              suspendedAt:
                target === "suspended"
                  ? 1200
                  : target === "revoked" && source === "suspended"
                    ? 1100
                    : null,
              updatedAt: 1200,
              version,
            });
          const edge = `${source}->${target}`;
          if (allowed.has(edge)) {
            expect(transition).not.toThrow();
            expect(memberRow(database, id)).toMatchObject({
              revoked_at: target === "revoked" ? 1200 : null,
              status: target,
              suspended_at:
                target === "suspended"
                  ? 1200
                  : target === "revoked" && source === "suspended"
                    ? 1100
                    : null,
              updated_at: 1200,
              version,
            });
          } else {
            expect(transition).toThrow(/lifecycle/iu);
            expect(memberRow(database, id)).toStrictEqual(before);
          }
        }
      }
    } finally {
      database.close();
    }
  });

  it("requires exact transition metadata and monotonic versioned updates", async () => {
    const database = await makeDatabase();
    try {
      const principal = seedPrincipal(database);
      insertMember(database, { id: "member-a", ...principal });

      const invalidActiveTransitions = [
        {
          revokedAt: null,
          status: "suspended",
          suspendedAt: 1099,
          updatedAt: 1100,
          version: 2,
        },
        {
          revokedAt: null,
          status: "suspended",
          suspendedAt: 1100,
          updatedAt: 1100,
          version: 3,
        },
        {
          revokedAt: null,
          status: "suspended",
          suspendedAt: 999,
          updatedAt: 999,
          version: 2,
        },
        {
          revokedAt: 1100,
          status: "revoked",
          suspendedAt: 1000,
          updatedAt: 1100,
          version: 2,
        },
      ] as const;
      for (const transition of invalidActiveTransitions) {
        expect(() =>
          transitionMember(database, { id: "member-a", ...transition })
        ).toThrow(/constraint|lifecycle/iu);
      }

      transitionMember(database, {
        id: "member-a",
        revokedAt: null,
        status: "suspended",
        suspendedAt: 1100,
        updatedAt: 1100,
        version: 2,
      });
      expect(() =>
        transitionMember(database, {
          id: "member-a",
          revokedAt: 1200,
          status: "revoked",
          suspendedAt: null,
          updatedAt: 1200,
          version: 3,
        })
      ).toThrow(/lifecycle/iu);
      expect(() =>
        transitionMember(database, {
          id: "member-a",
          revokedAt: null,
          status: "active",
          suspendedAt: 1100,
          updatedAt: 1200,
          version: 3,
        })
      ).toThrow(/constraint|lifecycle/iu);
    } finally {
      database.close();
    }
  });

  it("allows a new ID epoch only after revocation", async () => {
    const database = await makeDatabase();
    try {
      const principal = seedPrincipal(database);
      insertMember(database, { id: "member-epoch-1", ...principal });
      expect(() =>
        insertMember(database, { id: "member-epoch-2", ...principal })
      ).toThrow(/transitioned exactly/iu);
      transitionMember(database, {
        id: "member-epoch-1",
        revokedAt: null,
        status: "suspended",
        suspendedAt: 1100,
        updatedAt: 1100,
        version: 2,
      });
      expect(() =>
        insertMember(database, { id: "member-epoch-2", ...principal })
      ).toThrow(/transitioned exactly/iu);
      transitionMember(database, {
        id: "member-epoch-1",
        revokedAt: 1200,
        status: "revoked",
        suspendedAt: 1100,
        updatedAt: 1200,
        version: 3,
      });
      expect(() =>
        insertMember(database, {
          createdAt: 1199,
          id: "member-epoch-2",
          updatedAt: 1199,
          ...principal,
        })
      ).toThrow(/predates prior revocation/iu);
      insertMember(database, {
        createdAt: 1300,
        id: "member-epoch-2",
        updatedAt: 1300,
        ...principal,
      });

      expect(
        database
          .prepare(
            `select id, status from app_organization_member
             order by id`
          )
          .all()
          .map((row) => ({ ...row }))
      ).toStrictEqual([
        { id: "member-epoch-1", status: "revoked" },
        { id: "member-epoch-2", status: "active" },
      ]);
    } finally {
      database.close();
    }
  });

  it("retains immutable membership epochs across writes", async () => {
    const database = await makeDatabase();
    try {
      const principal = seedPrincipal(database);
      insertMember(database, { id: "member-a", ...principal });
      const original = memberRow(database, "member-a");
      database.exec("pragma recursive_triggers = off");

      const attempts = [
        "delete from app_organization_member where id = 'member-a'",
        `update app_organization_member set id = 'member-b'
          where id = 'member-a'`,
        `update app_organization_member set organization_id = 'organization-x'
          where id = 'member-a'`,
        `update app_organization_member set user_id = 'user-x'
          where id = 'member-a'`,
        `update app_organization_member set created_at = 999
          where id = 'member-a'`,
        `insert or replace into app_organization_member
          (id, organization_id, user_id, created_at, updated_at)
         values ('member-a', 'organization-a', 'user-a', 2000, 2000)`,
        `replace into app_organization_member
          (id, organization_id, user_id, created_at, updated_at)
         values ('member-a', 'organization-a', 'user-a', 2000, 2000)`,
        `insert into app_organization_member
          (id, organization_id, user_id, created_at, updated_at)
         values ('member-a', 'organization-a', 'user-a', 1000, 1000)
         on conflict (id) do update set
            status = 'suspended', updated_at = 1100, suspended_at = 1100,
            version = 2`,
        `insert or replace into app_organization_member
          (id, organization_id, user_id, created_at, updated_at)
         values ('member-b', 'organization-a', 'user-a', 2000, 2000)`,
        `replace into app_organization_member
          (id, organization_id, user_id, created_at, updated_at)
         values ('member-b', 'organization-a', 'user-a', 2000, 2000)`,
        `insert into app_organization_member
          (id, organization_id, user_id, created_at, updated_at)
         values ('member-b', 'organization-a', 'user-a', 2000, 2000)
         on conflict (organization_id, user_id)
           where status in ('active', 'suspended')
         do update set
           status = 'suspended', updated_at = 1100, suspended_at = 1100,
           version = 2`,
      ];
      for (const statement of attempts) {
        expect(() => database.exec(statement)).toThrow(
          /immutable|retained|transitioned exactly/iu
        );
        expect(memberRow(database, "member-a")).toStrictEqual(original);
        expect(memberRow(database, "member-b")).toBeUndefined();
      }
    } finally {
      database.close();
    }
  });

  it("enforces text storage and safe integer boundaries", async () => {
    const database = await makeDatabase();
    try {
      const principal = seedPrincipal(database);
      insertMember(database, {
        createdAt: Number.MAX_SAFE_INTEGER,
        id: "x".repeat(128),
        organizationId: principal.organizationId,
        updatedAt: Number.MAX_SAFE_INTEGER,
        userId: principal.userId,
      });
      expect(memberRow(database, "x".repeat(128))).toMatchObject({
        created_at: Number.MAX_SAFE_INTEGER,
        updated_at: Number.MAX_SAFE_INTEGER,
      });
      transitionMember(database, {
        id: "x".repeat(128),
        revokedAt: null,
        status: "suspended",
        suspendedAt: Number.MAX_SAFE_INTEGER,
        updatedAt: Number.MAX_SAFE_INTEGER,
        version: 2,
      });
      transitionMember(database, {
        id: "x".repeat(128),
        revokedAt: Number.MAX_SAFE_INTEGER,
        status: "revoked",
        suspendedAt: Number.MAX_SAFE_INTEGER,
        updatedAt: Number.MAX_SAFE_INTEGER,
        version: 3,
      });

      const invalidPrincipal = seedPrincipal(database, "invalid");
      const invalidMembers = [
        { id: Buffer.from("member-blob") },
        { id: "member.status" },
        { id: "membør" },
        { id: "x".repeat(129) },
        { id: "member-status-blob", status: Buffer.from("active") },
        { createdAt: Buffer.from("1000"), id: "member-created-blob" },
        { id: "member-updated-blob", updatedAt: Buffer.from("1000") },
        {
          id: "member-created-float",
          createdAt: 1.5,
          updatedAt: 1.5,
        },
        {
          id: "member-created-over",
          createdAt: 9_007_199_254_740_992n,
          updatedAt: 9_007_199_254_740_992n,
        },
        { id: "member-version-blob", version: Buffer.from("1") },
        {
          id: "member-version-over",
          version: 9_007_199_254_740_992n,
        },
      ];
      for (const invalid of invalidMembers) {
        expect(() =>
          insertMember(database, {
            ...invalid,
            organizationId: invalidPrincipal.organizationId,
            userId: invalidPrincipal.userId,
          })
        ).toThrow(/constraint|start active/iu);
      }

      expect(() =>
        insertMember(database, {
          id: "member-org-blob",
          organizationId: Buffer.from(invalidPrincipal.organizationId),
          userId: invalidPrincipal.userId,
        })
      ).toThrow(/constraint|foreign key/iu);
      expect(() =>
        insertMember(database, {
          id: "member-user-blob",
          organizationId: invalidPrincipal.organizationId,
          userId: Buffer.from(invalidPrincipal.userId),
        })
      ).toThrow(/constraint|foreign key/iu);
      database.exec(
        "insert into auth_user (id, created_at, updated_at) values ('', 1000, 1000)"
      );
      expect(() =>
        insertMember(database, {
          id: "member-empty-user",
          organizationId: invalidPrincipal.organizationId,
          userId: "",
        })
      ).toThrow(/constraint/iu);

      const lifecycleBlobPrincipal = seedPrincipal(database, "lifecycle-blob");
      insertMember(database, {
        id: "member-lifecycle-blob",
        ...lifecycleBlobPrincipal,
      });
      expect(() =>
        transitionMember(database, {
          id: "member-lifecycle-blob",
          revokedAt: null,
          status: "suspended",
          suspendedAt: Buffer.from("1100"),
          updatedAt: 1100,
          version: 2,
        })
      ).toThrow(/constraint|lifecycle/iu);
      expect(() =>
        transitionMember(database, {
          id: "member-lifecycle-blob",
          revokedAt: Buffer.from("1100"),
          status: "revoked",
          suspendedAt: null,
          updatedAt: 1100,
          version: 2,
        })
      ).toThrow(/constraint|lifecycle/iu);

      database.exec("drop trigger app_organization_member_insert_contract");
      const versionPrincipal = seedPrincipal(database, "version-max");
      insertMember(database, {
        id: "version-max",
        organizationId: versionPrincipal.organizationId,
        userId: versionPrincipal.userId,
        version: Number.MAX_SAFE_INTEGER,
      });
      expect(memberRow(database, "version-max")?.version).toBe(
        Number.MAX_SAFE_INTEGER
      );
      expect(() =>
        transitionMember(database, {
          id: "version-max",
          revokedAt: null,
          status: "suspended",
          suspendedAt: 1100,
          updatedAt: 1100,
          version: Number.MAX_SAFE_INTEGER + 1,
        })
      ).toThrow(/constraint|lifecycle/iu);
    } finally {
      database.close();
    }
  });

  it("keeps migration, Drizzle metadata, and domain decoding in parity", async () => {
    const database = await makeDatabase();
    try {
      const config = getTableConfig(appOrganizationMember);
      expect(config.name).toBe("app_organization_member");
      expect(config.columns.map((column) => column.name)).toStrictEqual([
        "id",
        "organization_id",
        "user_id",
        "status",
        "created_at",
        "updated_at",
        "suspended_at",
        "revoked_at",
        "version",
      ]);
      expect(
        config.foreignKeys.map((foreignKey) => ({
          columns: foreignKey.reference().columns.map((column) => column.name),
          foreignColumns: foreignKey
            .reference()
            .foreignColumns.map((column) => column.name),
          foreignTable: getTableName(foreignKey.reference().foreignTable),
          onDelete: foreignKey.onDelete,
          onUpdate: foreignKey.onUpdate,
        }))
      ).toStrictEqual([
        {
          columns: ["organization_id"],
          foreignColumns: ["id"],
          foreignTable: "app_organization",
          onDelete: "restrict",
          onUpdate: "restrict",
        },
        {
          columns: ["user_id"],
          foreignColumns: ["id"],
          foreignTable: "auth_user",
          onDelete: "restrict",
          onUpdate: "restrict",
        },
      ]);
      expect(config.indexes.map((index) => index.config.name)).toStrictEqual([
        "app_organization_member_current_pair_idx",
        "app_organization_member_user_status_org_idx",
        "app_organization_member_org_status_idx",
      ]);

      const indexes = database
        .prepare("pragma index_list(app_organization_member)")
        .all()
        .map((row) => {
          const index = row as {
            name: string;
            partial: number;
            unique: number;
          };
          return {
            name: index.name,
            partial: index.partial,
            unique: index.unique,
          };
        });
      expect(indexes).toStrictEqual(
        expect.arrayContaining([
          {
            name: "app_organization_member_current_pair_idx",
            partial: 1,
            unique: 1,
          },
          {
            name: "app_organization_member_user_status_org_idx",
            partial: 0,
            unique: 0,
          },
          {
            name: "app_organization_member_org_status_idx",
            partial: 0,
            unique: 0,
          },
        ])
      );

      const principal = seedPrincipal(database);
      insertMember(database, { id: "member-a", ...principal });
      const persisted = database
        .prepare(
          `select id, organization_id as organizationId, user_id as userId,
                  status, created_at as createdAt, updated_at as updatedAt,
                  suspended_at as suspendedAt, revoked_at as revokedAt,
                  version
             from app_organization_member where id = 'member-a'`
        )
        .get() as typeof appOrganizationMember.$inferSelect;
      expect(
        Schema.decodeUnknownSync(OrganizationMemberSchema)(persisted)
      ).toMatchObject({ id: "member-a", status: "active" });
      expect(integrityState(database)).toStrictEqual({
        foreignKeys: [],
        integrity: [{ integrity_check: "ok" }],
      });
    } finally {
      database.close();
    }
  });
});
