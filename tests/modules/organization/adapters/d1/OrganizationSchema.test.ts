import { DatabaseSync } from "node:sqlite";

import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import type { appOrganization } from "#/modules/organization/adapters/d1/OrganizationSchema";
import { OrganizationSchema } from "#/modules/organization/domain/Organization";

import {
  applyControlPlaneMigration,
  applyControlPlaneMigrations,
  applyControlPlaneMigrationsThrough,
} from "../../../../support/d1";

const insertOrganization = (
  database: DatabaseSync,
  organization: {
    readonly createdAt: number;
    readonly id: string;
    readonly status: string;
    readonly updatedAt: number;
    readonly version: number;
  }
) =>
  database
    .prepare(
      `insert into app_organization
        (id, status, created_at, updated_at, version)
       values (?, ?, ?, ?, ?)`
    )
    .run(
      organization.id,
      organization.status,
      organization.createdAt,
      organization.updatedAt,
      organization.version
    );

const organizationRow = (database: DatabaseSync, id: string) => {
  const row = database
    .prepare("select * from app_organization where id = ?")
    .get(id);
  return row === undefined ? undefined : { ...row };
};

const seedLegacyMailboxState = (database: DatabaseSync) => {
  database.exec(`
    insert into app_mailbox
      (id, display_name, status, created_by_user_id, created_at, updated_at,
       version)
    values ('primary', 'Primary mailbox', 'active', 'user-a', 1000, 1000, 1);

    insert into app_mailbox_member
      (mailbox_id, user_id, created_at, updated_at)
    values ('primary', 'user-a', 1000, 1000);

    insert into app_mailbox_address
      (mailbox_id, id, address, normalized_address, display_name, is_primary,
       enabled, created_at, updated_at, version)
    values ('primary', 'primary', 'owner@example.test', 'owner@example.test',
            'Owner', 1, 1, 1000, 1000, 1);

    insert into app_user_preference
      (user_id, default_mailbox_id, settings_json, created_at, updated_at,
       version)
    values ('user-a', 'primary', '{"theme":"system"}', 1000, 1000, 1);
  `);
};

const legacyRows = (database: DatabaseSync) => ({
  addresses: database
    .prepare("select * from app_mailbox_address order by mailbox_id, id")
    .all(),
  mailboxes: database.prepare("select * from app_mailbox order by id").all(),
  members: database
    .prepare("select * from app_mailbox_member order by mailbox_id, user_id")
    .all(),
  preferences: database
    .prepare("select * from app_user_preference order by user_id")
    .all(),
});

const legacySchema = (database: DatabaseSync) =>
  database
    .prepare(
      `select type, name, tbl_name, sql
         from sqlite_master
        where tbl_name <> 'app_organization'
        order by type, name`
    )
    .all();

const makeOrganizationDatabase = async () => {
  const database = new DatabaseSync(":memory:");
  await applyControlPlaneMigrations(database);
  database
    .prepare(
      `insert into app_organization (id, created_at, updated_at)
       values ('organization-a', 1000, 1000)`
    )
    .run();
  return database;
};

const integrityState = (database: DatabaseSync) => ({
  foreignKeys: database.prepare("pragma foreign_key_check").all(),
  integrity: database
    .prepare("pragma integrity_check")
    .all()
    .map((row) => ({ ...row })),
});

describe("organization D1 schema", () => {
  it("upgrades 1017 state without changing legacy data or schema", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrationsThrough(
        database,
        "1017_app_recovery_safe_email_initiation.sql"
      );
      seedLegacyMailboxState(database);

      const rowsBefore = legacyRows(database);
      const schemaBefore = legacySchema(database);
      const singletonBefore = database
        .prepare(
          `select type, name, tbl_name, sql
             from sqlite_master
            where name = 'app_mailbox_singleton_idx'`
        )
        .get();

      await applyControlPlaneMigration(database, "1018_app_organization.sql");

      expect({
        organizations: database.prepare("select * from app_organization").all(),
        rows: legacyRows(database),
        schema: legacySchema(database),
        singleton: database
          .prepare(
            `select type, name, tbl_name, sql
               from sqlite_master
              where name = 'app_mailbox_singleton_idx'`
          )
          .get(),
      }).toStrictEqual({
        organizations: [],
        rows: rowsBefore,
        schema: schemaBefore,
        singleton: singletonBefore,
      });

      expect(() =>
        database
          .prepare(
            `insert into app_mailbox
              (id, display_name, status, created_by_user_id, created_at,
               updated_at, version)
             values ('secondary', 'Secondary', 'active', 'user-b', 2000,
                     2000, 1)`
          )
          .run()
      ).toThrow(/unique/iu);

      database.exec(`
        insert into app_organization (id, created_at, updated_at)
        values ('organization-a', 2000, 2000);
        insert into app_organization (id, created_at, updated_at)
        values ('organization-b', 2000, 2000);
      `);
      const organizationCount = database
        .prepare("select count(*) as count from app_organization")
        .get() as { count: number };
      expect(organizationCount.count).toBe(2);
      expect(integrityState(database)).toStrictEqual({
        foreignKeys: [],
        integrity: [{ integrity_check: "ok" }],
      });
    } finally {
      database.close();
    }
  });

  it("enforces initial and lifecycle contracts on a fresh schema", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);

      const columns = database
        .prepare("pragma table_xinfo(app_organization)")
        .all()
        .map((row) => {
          const column = row as { hidden: number; name: string };
          return { hidden: column.hidden, name: column.name };
        });
      expect(columns).toStrictEqual([
        { hidden: 0, name: "id" },
        { hidden: 0, name: "status" },
        { hidden: 0, name: "created_at" },
        { hidden: 0, name: "updated_at" },
        { hidden: 0, name: "version" },
      ]);

      database
        .prepare(
          `insert into app_organization (id, created_at, updated_at)
           values ('organization-a', 1000, 1000)`
        )
        .run();
      const inserted = database
        .prepare("select * from app_organization where id = ?")
        .get("organization-a");
      expect({ ...inserted }).toStrictEqual({
        created_at: 1000,
        id: "organization-a",
        status: "active",
        updated_at: 1000,
        version: 1,
      });

      const invalidOrganizations = [
        {
          createdAt: 1000,
          id: "organization-b",
          status: "deleted",
          updatedAt: 1000,
          version: 1,
        },
        {
          createdAt: 1000,
          id: "organization-b",
          status: "suspended",
          updatedAt: 1000,
          version: 1,
        },
        {
          createdAt: 1000,
          id: "organization-b",
          status: "active",
          updatedAt: 1000,
          version: 2,
        },
        {
          createdAt: 1000,
          id: "organization-b",
          status: "active",
          updatedAt: 1000,
          version: 1.5,
        },
        {
          createdAt: -1,
          id: "organization-b",
          status: "active",
          updatedAt: -1,
          version: 1,
        },
        {
          createdAt: 1.5,
          id: "organization-b",
          status: "active",
          updatedAt: 1.5,
          version: 1,
        },
        {
          createdAt: 1000,
          id: "organization-b",
          status: "active",
          updatedAt: 1001,
          version: 1,
        },
      ] as const;
      for (const organization of invalidOrganizations) {
        expect(() => insertOrganization(database, organization)).toThrow(
          /constraint|organization/u
        );
      }
      expect(() =>
        database
          .prepare(
            `insert into app_organization (id, created_at, updated_at)
             values (?, 1000, 1000)`
          )
          .run(Buffer.from("organization-a"))
      ).toThrow(/constraint/u);
    } finally {
      database.close();
    }
  });

  it("enforces the exact opaque ASCII identifier grammar", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);

      for (const id of ["A", "a", "Az09_-", "x".repeat(128)]) {
        insertOrganization(database, {
          createdAt: 1000,
          id,
          status: "active",
          updatedAt: 1000,
          version: 1,
        });
        expect(organizationRow(database, id)?.id).toBe(id);
      }

      for (const id of [
        "",
        "x".repeat(129),
        " organization-a ",
        "organization\ta",
        "organization\u00A0a",
        "organization\na",
        "organization\0a",
        "organization😀a",
        "organizatiøn-a",
        "organization.a",
      ]) {
        expect(() =>
          insertOrganization(database, {
            createdAt: 1000,
            id,
            status: "active",
            updatedAt: 1000,
            version: 1,
          })
        ).toThrow(/constraint/u);
      }
    } finally {
      database.close();
    }
  });

  it("bounds timestamps to safe integers", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      database.exec(`
        insert into app_organization (id, created_at, updated_at)
        values ('timestamp-max', 9007199254740991, 9007199254740991);
      `);
      expect(organizationRow(database, "timestamp-max")).toStrictEqual({
        created_at: 9_007_199_254_740_991,
        id: "timestamp-max",
        status: "active",
        updated_at: 9_007_199_254_740_991,
        version: 1,
      });

      expect(() =>
        database.exec(`
          insert into app_organization (id, created_at, updated_at)
          values ('created-over-max', 9007199254740992, 9007199254740992)
        `)
      ).toThrow(/constraint/u);
      expect(() =>
        database.exec(`
          update app_organization
             set updated_at = 9007199254740992, version = 2
           where id = 'timestamp-max'
        `)
      ).toThrow(/constraint/u);
      expect(organizationRow(database, "timestamp-max")).toStrictEqual({
        created_at: 9_007_199_254_740_991,
        id: "timestamp-max",
        status: "active",
        updated_at: 9_007_199_254_740_991,
        version: 1,
      });
    } finally {
      database.close();
    }
  });

  it("bounds lifecycle versions to safe integers", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      // Seed immediately below the boundary because production inserts must start at version 1.
      database.exec(`
        drop trigger app_organization_insert_contract;
        insert into app_organization
          (id, status, created_at, updated_at, version)
        values ('version-max', 'active', 1000, 1000, 9007199254740990);
        update app_organization
           set version = 9007199254740991
         where id = 'version-max';
      `);
      const versionMax = organizationRow(database, "version-max");
      expect(versionMax?.version).toBe(9_007_199_254_740_991);
      expect(() =>
        database.exec(`
          update app_organization
             set version = 9007199254740992
           where id = 'version-max'
        `)
      ).toThrow(/constraint|lifecycle/u);
      expect(organizationRow(database, "version-max")).toStrictEqual(
        versionMax
      );
    } finally {
      database.close();
    }
  });

  it("retains identifiers across delete and insert-based upserts", async () => {
    const database = await makeOrganizationDatabase();
    try {
      database.exec("pragma recursive_triggers = off");
      const original = organizationRow(database, "organization-a");
      const attempts = [
        `delete from app_organization where id = 'organization-a'`,
        `insert into app_organization (id, created_at, updated_at)
         values ('organization-a', 2000, 2000)`,
        `insert or replace into app_organization
           (id, status, created_at, updated_at, version)
         values ('organization-a', 'active', 2000, 2000, 1)`,
        `replace into app_organization
           (id, status, created_at, updated_at, version)
         values ('organization-a', 'active', 2000, 2000, 1)`,
        `insert into app_organization
           (id, status, created_at, updated_at, version)
         values ('organization-a', 'active', 1000, 1000, 1)
         on conflict (id) do update set
           status = 'suspended', updated_at = 1100, version = 2`,
      ];

      for (const statement of attempts) {
        expect(() => database.exec(statement)).toThrow(/immutable|retained/u);
        expect(organizationRow(database, "organization-a")).toStrictEqual(
          original
        );
      }
    } finally {
      database.close();
    }
  });

  it("rejects immutable fields and invalid version transitions", async () => {
    const database = await makeOrganizationDatabase();
    try {
      expect(() =>
        database.exec(
          `update app_organization
              set id = 'organization-renamed', version = 2
            where id = 'organization-a'`
        )
      ).toThrow(/immutable/u);
      expect(() =>
        database.exec(
          `update app_organization
              set created_at = 999, version = 2
            where id = 'organization-a'`
        )
      ).toThrow(/immutable/u);
      expect(() =>
        database.exec(
          `update app_organization
              set status = 'suspended', updated_at = 1100
            where id = 'organization-a'`
        )
      ).toThrow(/lifecycle/u);
      expect(() =>
        database.exec(
          `update app_organization
              set status = 'suspended', updated_at = 1100, version = 3
            where id = 'organization-a'`
        )
      ).toThrow(/lifecycle/u);
      expect(() =>
        database.exec(
          `update app_organization
              set status = 'suspended', updated_at = 999, version = 2
          where id = 'organization-a'`
        )
      ).toThrow(/lifecycle/u);
    } finally {
      database.close();
    }
  });

  it("persists closed-catalog lifecycle updates for domain decoding", async () => {
    const database = await makeOrganizationDatabase();
    try {
      database.exec(
        `update app_organization
            set status = 'suspended', updated_at = 1100, version = 2
          where id = 'organization-a'`
      );
      expect(() =>
        database.exec(
          `update app_organization
              set status = 'deleted', updated_at = 1200, version = 3
            where id = 'organization-a'`
        )
      ).toThrow(/constraint/u);
      database.exec(
        `update app_organization
            set status = 'active', updated_at = 1200, version = 3
          where id = 'organization-a'`
      );

      const persisted = database
        .prepare(
          `select id, status, created_at as createdAt, updated_at as updatedAt,
                  version
             from app_organization
            where id = 'organization-a'`
        )
        .get() as typeof appOrganization.$inferSelect;
      expect(
        Schema.decodeUnknownSync(OrganizationSchema)(persisted)
      ).toMatchObject({
        createdAt: 1000,
        id: "organization-a",
        status: "active",
        updatedAt: 1200,
        version: 3,
      });
      expect(integrityState(database)).toStrictEqual({
        foreignKeys: [],
        integrity: [{ integrity_check: "ok" }],
      });
    } finally {
      database.close();
    }
  });
});
