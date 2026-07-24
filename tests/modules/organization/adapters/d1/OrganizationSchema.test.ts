/* oxlint-disable vitest/max-expects -- Migration trigger tests assert the complete immutable storage contract together. */
import { DatabaseSync } from "node:sqlite";

import { getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import { appMailDomain } from "#/modules/organization/adapters/d1/OrganizationSchema";
import type { appOrganization } from "#/modules/organization/adapters/d1/OrganizationSchema";
import {
  MAIL_DOMAIN_CANONICALIZATION_PROFILE_ID,
  MailDomainSchema,
} from "#/modules/organization/domain/MailDomain";
import { OrganizationSchema } from "#/modules/organization/domain/Organization";

import {
  applyControlPlaneMigration,
  applyControlPlaneMigrations,
  applyControlPlaneMigrationsThrough,
  insertFreshCutoverOrganization,
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

const insertMailDomain = (
  database: DatabaseSync,
  domain: {
    readonly canonicalDomain: string;
    readonly createdAt: number;
    readonly id: string | Buffer;
    readonly organizationId: string;
    readonly profileId?: string | Buffer;
    readonly status?: string;
    readonly updatedAt: number;
    readonly version?: number;
  }
) =>
  database
    .prepare(
      `insert into app_mail_domain
        (id, organization_id, canonical_domain, canonicalization_profile_id,
         canonicalization_version, status, created_at, updated_at, version)
       values (?, ?, ?, ?, 1, ?, ?, ?, ?)`
    )
    .run(
      domain.id,
      domain.organizationId,
      domain.canonicalDomain,
      domain.profileId ?? MAIL_DOMAIN_CANONICALIZATION_PROFILE_ID,
      domain.status ?? "pending_verification",
      domain.createdAt,
      domain.updatedAt,
      domain.version ?? 1
    );

const mailDomainRow = (database: DatabaseSync, id: string) => {
  const row = database
    .prepare("select * from app_mail_domain where id = ?")
    .get(id);
  return row === undefined ? undefined : { ...row };
};

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

const makeMailDomainDatabase = async () => {
  const database = await makeOrganizationDatabase();
  insertMailDomain(database, {
    canonicalDomain: "example.com",
    createdAt: 1000,
    id: "domain-a",
    organizationId: "organization-a",
    updatedAt: 1000,
  });
  return database;
};

const persistentState = (database: DatabaseSync) => {
  const tables = database
    .prepare(
      `select name
         from sqlite_master
        where type = 'table'
          and name not like 'sqlite_%'
          and name <> 'app_mail_domain'
        order by name`
    )
    .all() as { readonly name: string }[];
  return Object.fromEntries(
    tables.map(({ name }) => [
      name,
      database.prepare(`select * from "${name}"`).all(),
    ])
  );
};

const schemaWithoutMailDomain = (database: DatabaseSync) =>
  database
    .prepare(
      `select type, name, tbl_name, sql
         from sqlite_master
        where tbl_name <> 'app_mail_domain'
          and name not like 'app_mail_domain_%'
        order by type, name`
    )
    .all();

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

  it("upgrades real 1020 state additively and leaves the domain table empty", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrationsThrough(
        database,
        "1020_app_authorization_catalog_v2.sql"
      );
      seedLegacyMailboxState(database);
      database.exec(`
        insert into app_organization (id, created_at, updated_at)
        values ('organization-a', 1000, 1000);
      `);

      const stateBefore = persistentState(database);
      const schemaBefore = schemaWithoutMailDomain(database);
      const singletonBefore = database
        .prepare(
          `select type, name, tbl_name, sql
             from sqlite_master
            where name = 'app_mailbox_singleton_idx'`
        )
        .get();

      await applyControlPlaneMigration(database, "1021_app_mail_domain.sql");

      expect(
        database.prepare("select * from app_mail_domain").all()
      ).toStrictEqual([]);
      expect(persistentState(database)).toStrictEqual(stateBefore);
      expect(schemaWithoutMailDomain(database)).toStrictEqual(schemaBefore);
      expect(
        database
          .prepare(
            `select type, name, tbl_name, sql
               from sqlite_master
              where name = 'app_mailbox_singleton_idx'`
          )
          .get()
      ).toStrictEqual(singletonBefore);
      expect(integrityState(database)).toStrictEqual({
        foreignKeys: [],
        integrity: [{ integrity_check: "ok" }],
      });
    } finally {
      database.close();
    }
  });

  it("matches the fresh Drizzle column contract and restricted organization FK", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      const columns = database
        .prepare("pragma table_xinfo(app_mail_domain)")
        .all()
        .map((row) => {
          const column = row as {
            dflt_value: string | null;
            hidden: number;
            name: string;
            notnull: number;
          };
          return {
            defaultValue: column.dflt_value,
            hidden: column.hidden,
            name: column.name,
            notNull: column.notnull,
          };
        });
      expect(columns).toStrictEqual([
        { defaultValue: null, hidden: 0, name: "id", notNull: 1 },
        {
          defaultValue: null,
          hidden: 0,
          name: "organization_id",
          notNull: 1,
        },
        {
          defaultValue: null,
          hidden: 0,
          name: "canonical_domain",
          notNull: 1,
        },
        {
          defaultValue: null,
          hidden: 0,
          name: "canonicalization_profile_id",
          notNull: 1,
        },
        {
          defaultValue: "1",
          hidden: 0,
          name: "canonicalization_version",
          notNull: 1,
        },
        {
          defaultValue: "'pending_verification'",
          hidden: 0,
          name: "status",
          notNull: 1,
        },
        { defaultValue: null, hidden: 0, name: "created_at", notNull: 1 },
        { defaultValue: null, hidden: 0, name: "updated_at", notNull: 1 },
        { defaultValue: "1", hidden: 0, name: "version", notNull: 1 },
      ]);
      const config = getTableConfig(appMailDomain);
      expect({
        columns: config.columns.map((column) => column.name),
        indexes: config.indexes.map((index) => index.config.name),
      }).toStrictEqual({
        columns: columns.map((column) => column.name),
        indexes: [
          "app_mail_domain_current_canonical_idx",
          "app_mail_domain_organization_status_idx",
          "app_mail_domain_canonical_history_idx",
        ],
      });
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
      ]);
      expect(
        database.prepare("pragma foreign_key_list(app_mail_domain)").all()
      ).toMatchObject([
        {
          from: "organization_id",
          on_delete: "RESTRICT",
          on_update: "RESTRICT",
          table: "app_organization",
          to: "id",
        },
      ]);
      const indexes = database
        .prepare("pragma index_list(app_mail_domain)")
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
            name: "app_mail_domain_current_canonical_idx",
            partial: 1,
            unique: 1,
          },
          {
            name: "app_mail_domain_organization_status_idx",
            partial: 0,
            unique: 0,
          },
          {
            name: "app_mail_domain_canonical_history_idx",
            partial: 0,
            unique: 0,
          },
        ])
      );
    } finally {
      database.close();
    }
  });

  it("allows many domains per organization without a singleton", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      database.exec(`
        insert into app_organization (id, created_at, updated_at)
        values ('organization-a', 1000, 1000), ('organization-b', 1000, 1000);
      `);
      for (const [id, organizationId, canonicalDomain] of [
        ["domain-a", "organization-a", "alpha.example"],
        ["domain-b", "organization-a", "beta.example"],
        ["domain-c", "organization-b", "gamma.example"],
      ] as const) {
        insertMailDomain(database, {
          canonicalDomain,
          createdAt: 1000,
          id,
          organizationId,
          updatedAt: 1000,
        });
      }
      expect(
        database
          .prepare(
            `select organization_id, count(*) as count
               from app_mail_domain
              group by organization_id
              order by organization_id`
          )
          .all()
          .map((row) => ({ ...row }))
      ).toStrictEqual([
        { count: 2, organization_id: "organization-a" },
        { count: 1, organization_id: "organization-b" },
      ]);
      expect(() =>
        insertMailDomain(database, {
          canonicalDomain: "missing.example",
          createdAt: 1000,
          id: "domain-missing",
          organizationId: "organization-missing",
          updatedAt: 1000,
        })
      ).toThrow(/foreign key/iu);
    } finally {
      database.close();
    }
  });

  it("enforces the complete lifecycle transition matrix", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      database.exec(`
        insert into app_organization (id, created_at, updated_at)
        values ('organization-a', 1000, 1000);
      `);
      const statuses = [
        "pending_verification",
        "verified",
        "active",
        "suspended",
        "retired",
      ] as const;
      const paths = {
        active: ["verified", "active"],
        pending_verification: [],
        retired: ["retired"],
        suspended: ["verified", "active", "suspended"],
        verified: ["verified"],
      } as const;
      const allowed = new Set([
        "pending_verification>verified",
        "pending_verification>retired",
        "verified>active",
        "verified>pending_verification",
        "verified>retired",
        "active>suspended",
        "active>pending_verification",
        "active>retired",
        "suspended>active",
        "suspended>pending_verification",
        "suspended>retired",
      ]);

      for (const [sourceIndex, source] of statuses.entries()) {
        for (const [targetIndex, target] of statuses.entries()) {
          const id = `matrix-${sourceIndex}-${targetIndex}`;
          insertMailDomain(database, {
            canonicalDomain: `matrix-${sourceIndex}-${targetIndex}.example`,
            createdAt: 1000,
            id,
            organizationId: "organization-a",
            updatedAt: 1000,
          });
          let version = 1;
          let updatedAt = 1000;
          for (const pathStatus of paths[source]) {
            version += 1;
            updatedAt += 1;
            database
              .prepare(
                `update app_mail_domain
                    set status = ?, updated_at = ?, version = ?
                  where id = ?`
              )
              .run(pathStatus, updatedAt, version, id);
          }
          let transitionError: unknown;
          try {
            database
              .prepare(
                `update app_mail_domain
                    set status = ?, updated_at = ?, version = ?
                  where id = ?`
              )
              .run(target, updatedAt + 1, version + 1, id);
          } catch (error) {
            transitionError = error;
          }
          const transitionAllowed = allowed.has(`${source}>${target}`);
          const after = mailDomainRow(database, id);
          expect({
            lifecycleError:
              transitionError instanceof Error &&
              /lifecycle/u.test(transitionError.message),
            status: after?.status,
            succeeded: transitionError === undefined,
            updatedAt: after?.updated_at,
            version: after?.version,
          }).toStrictEqual({
            lifecycleError: !transitionAllowed,
            status: transitionAllowed ? target : source,
            succeeded: transitionAllowed,
            updatedAt: transitionAllowed ? updatedAt + 1 : updatedAt,
            version: transitionAllowed ? version + 1 : version,
          });
        }
      }
    } finally {
      database.close();
    }
  });

  it("owns one global current claim and orders retired epochs", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      database.exec(`
        pragma recursive_triggers = off;
        insert into app_organization (id, created_at, updated_at)
        values ('organization-a', 1000, 1000), ('organization-b', 1000, 1000);
      `);
      insertMailDomain(database, {
        canonicalDomain: "example.com",
        createdAt: 1000,
        id: "domain-a",
        organizationId: "organization-a",
        updatedAt: 1000,
      });

      const collidingInserts = [
        `insert into app_mail_domain
          (id, organization_id, canonical_domain, canonicalization_profile_id,
           created_at, updated_at)
         values ('domain-b', 'organization-b', 'example.com',
           '${MAIL_DOMAIN_CANONICALIZATION_PROFILE_ID}', 1000, 1000)`,
        `insert or replace into app_mail_domain
          (id, organization_id, canonical_domain, canonicalization_profile_id,
           created_at, updated_at)
         values ('domain-b', 'organization-b', 'example.com',
           '${MAIL_DOMAIN_CANONICALIZATION_PROFILE_ID}', 1000, 1000)`,
        `insert into app_mail_domain
          (id, organization_id, canonical_domain, canonicalization_profile_id,
           created_at, updated_at)
         values ('domain-b', 'organization-b', 'example.com',
           '${MAIL_DOMAIN_CANONICALIZATION_PROFILE_ID}', 1000, 1000)
         on conflict do update set updated_at = excluded.updated_at`,
      ];
      for (const statement of collidingInserts) {
        expect(() => database.exec(statement)).toThrow(/current claim/u);
        expect({
          ...database
            .prepare("select count(*) as count from app_mail_domain")
            .get(),
        }).toStrictEqual({ count: 1 });
      }

      database.exec(`
        update app_mail_domain
           set status = 'retired', updated_at = 1100, version = 2
         where id = 'domain-a';
      `);
      expect(() =>
        insertMailDomain(database, {
          canonicalDomain: "example.com",
          createdAt: 1099,
          id: "domain-b",
          organizationId: "organization-b",
          updatedAt: 1099,
        })
      ).toThrow(/predates/u);
      insertMailDomain(database, {
        canonicalDomain: "example.com",
        createdAt: 1100,
        id: "domain-b",
        organizationId: "organization-b",
        updatedAt: 1100,
      });
      database.exec(`
        update app_mail_domain
           set status = 'retired', updated_at = 1200, version = 2
         where id = 'domain-b';
      `);
      insertMailDomain(database, {
        canonicalDomain: "example.com",
        createdAt: 1200,
        id: "domain-c",
        organizationId: "organization-a",
        updatedAt: 1200,
      });
      expect(
        database
          .prepare(
            `select id, status, created_at, updated_at
               from app_mail_domain
              where canonical_domain = 'example.com'
              order by created_at, id`
          )
          .all()
          .map((row) => ({ ...row }))
      ).toStrictEqual([
        {
          created_at: 1000,
          id: "domain-a",
          status: "retired",
          updated_at: 1100,
        },
        {
          created_at: 1100,
          id: "domain-b",
          status: "retired",
          updated_at: 1200,
        },
        {
          created_at: 1200,
          id: "domain-c",
          status: "pending_verification",
          updated_at: 1200,
        },
      ]);
    } finally {
      database.close();
    }
  });

  it("rejects noncanonical direct SQL and unsafe storage values", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      database.exec(`
        insert into app_organization (id, created_at, updated_at)
        values ('organization-a', 1000, 1000);
      `);
      const invalidDomains = [
        "EXAMPLE.COM",
        "bücher.example",
        "example.com.",
        "example..com",
        "-example.com",
        "example-.com",
        "ab--cd.example",
        "foo_bar.example",
        "example.123",
        "localhost",
        `${"a".repeat(64)}.example`,
        `${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(62)}`,
      ];
      for (const [index, canonicalDomain] of invalidDomains.entries()) {
        expect(() =>
          insertMailDomain(database, {
            canonicalDomain,
            createdAt: 1000,
            id: `invalid-${index}`,
            organizationId: "organization-a",
            updatedAt: 1000,
          })
        ).toThrow(/constraint|grammar/u);
      }

      const invalidRecords = [
        {
          canonicalDomain: "blob-id.example",
          createdAt: 1000,
          id: Buffer.from("blob-id"),
          organizationId: "organization-a",
          updatedAt: 1000,
        },
        {
          canonicalDomain: "bad-profile.example",
          createdAt: 1000,
          id: "bad-profile",
          organizationId: "organization-a",
          profileId: "unicode-current",
          updatedAt: 1000,
        },
        {
          canonicalDomain: "float-time.example",
          createdAt: 1.5,
          id: "float-time",
          organizationId: "organization-a",
          updatedAt: 1.5,
        },
        {
          canonicalDomain: "large-time.example",
          createdAt: 9_007_199_254_740_992,
          id: "large-time",
          organizationId: "organization-a",
          updatedAt: 9_007_199_254_740_992,
        },
        {
          canonicalDomain: "bad-status.example",
          createdAt: 1000,
          id: "bad-status",
          organizationId: "organization-a",
          status: "active",
          updatedAt: 1000,
        },
        {
          canonicalDomain: "bad-version.example",
          createdAt: 1000,
          id: "bad-version",
          organizationId: "organization-a",
          updatedAt: 1000,
          version: 2,
        },
      ];
      for (const record of invalidRecords) {
        expect(() => insertMailDomain(database, record)).toThrow(
          /constraint|pending/u
        );
      }
      expect(() =>
        database
          .prepare(
            `insert into app_mail_domain
              (id, organization_id, canonical_domain,
               canonicalization_profile_id, created_at, updated_at)
             values ('blob-domain', 'organization-a', ?, ?, 1000, 1000)`
          )
          .run(
            Buffer.from("blob-domain.example"),
            MAIL_DOMAIN_CANONICALIZATION_PROFILE_ID
          )
      ).toThrow(/constraint/u);
      expect(() =>
        database
          .prepare(
            `insert into app_mail_domain
              (id, organization_id, canonical_domain,
               canonicalization_profile_id, created_at, updated_at)
             values ('blob-profile', 'organization-a', 'blob-profile.example',
                     ?, 1000, 1000)`
          )
          .run(Buffer.from(MAIL_DOMAIN_CANONICALIZATION_PROFILE_ID))
      ).toThrow(/constraint|pending/u);

      insertMailDomain(database, {
        canonicalDomain: "maximum.example",
        createdAt: Number.MAX_SAFE_INTEGER,
        id: "maximum",
        organizationId: "organization-a",
        updatedAt: Number.MAX_SAFE_INTEGER,
      });
      expect(mailDomainRow(database, "maximum")).toMatchObject({
        created_at: Number.MAX_SAFE_INTEGER,
        updated_at: Number.MAX_SAFE_INTEGER,
      });
    } finally {
      database.close();
    }
  });

  it("retains identity and rejects immutable fields, delete, replace, and upsert", async () => {
    const database = await makeMailDomainDatabase();
    try {
      database.exec("pragma recursive_triggers = off");
      const original = mailDomainRow(database, "domain-a");
      const attempts = [
        `update app_mail_domain set id = 'renamed', version = 2 where id = 'domain-a'`,
        `update app_mail_domain set organization_id = 'other', version = 2 where id = 'domain-a'`,
        `update app_mail_domain set canonical_domain = 'other.example', version = 2 where id = 'domain-a'`,
        `update app_mail_domain set canonicalization_profile_id = 'other', version = 2 where id = 'domain-a'`,
        `update app_mail_domain set canonicalization_version = 2, version = 2 where id = 'domain-a'`,
        `update app_mail_domain set created_at = 999, version = 2 where id = 'domain-a'`,
        `update app_mail_domain set updated_at = 1001, version = 2 where id = 'domain-a'`,
        `update app_mail_domain set status = 'verified', updated_at = 999, version = 2 where id = 'domain-a'`,
        `update app_mail_domain set status = 'verified', updated_at = 1001, version = 3 where id = 'domain-a'`,
        `delete from app_mail_domain where id = 'domain-a'`,
        `insert into app_mail_domain
          (id, organization_id, canonical_domain, canonicalization_profile_id,
           created_at, updated_at)
         values ('domain-a', 'organization-a', 'replacement.example',
           '${MAIL_DOMAIN_CANONICALIZATION_PROFILE_ID}', 2000, 2000)`,
        `replace into app_mail_domain
          (id, organization_id, canonical_domain, canonicalization_profile_id,
           created_at, updated_at)
         values ('domain-a', 'organization-a', 'replacement.example',
           '${MAIL_DOMAIN_CANONICALIZATION_PROFILE_ID}', 2000, 2000)`,
        `insert into app_mail_domain
          (id, organization_id, canonical_domain, canonicalization_profile_id,
           created_at, updated_at)
         values ('domain-a', 'organization-a', 'replacement.example',
           '${MAIL_DOMAIN_CANONICALIZATION_PROFILE_ID}', 2000, 2000)
         on conflict (id) do update set status = 'retired', updated_at = 2000,
           version = 2`,
      ];
      for (const statement of attempts) {
        expect(() => database.exec(statement)).toThrow(
          /immutable|lifecycle|retained/u
        );
        expect(mailDomainRow(database, "domain-a")).toStrictEqual(original);
      }
    } finally {
      database.close();
    }
  });

  it("decodes persisted storage rows through the domain entity", async () => {
    const database = await makeMailDomainDatabase();
    try {
      const persisted = database
        .prepare(
          `select id, organization_id as organizationId,
                  canonical_domain as canonicalDomain,
                  canonicalization_profile_id as canonicalizationProfileId,
                  canonicalization_version as canonicalizationVersion,
                  status, created_at as createdAt, updated_at as updatedAt,
                  version
             from app_mail_domain
            where id = 'domain-a'`
        )
        .get() as typeof appMailDomain.$inferSelect;
      expect(
        Schema.decodeUnknownSync(MailDomainSchema)(persisted)
      ).toMatchObject({
        canonicalDomain: "example.com",
        canonicalizationProfileId: MAIL_DOMAIN_CANONICALIZATION_PROFILE_ID,
        canonicalizationVersion: 1,
        createdAt: 1000,
        id: "domain-a",
        organizationId: "organization-a",
        status: "pending_verification",
        updatedAt: 1000,
        version: 1,
      });

      insertMailDomain(database, {
        canonicalDomain: "xn--a.example",
        createdAt: 1000,
        id: "structurally-valid-only",
        organizationId: "organization-a",
        updatedAt: 1000,
      });
      const structurallyValidOnly = database
        .prepare(
          `select id, organization_id as organizationId,
                  canonical_domain as canonicalDomain,
                  canonicalization_profile_id as canonicalizationProfileId,
                  canonicalization_version as canonicalizationVersion,
                  status, created_at as createdAt, updated_at as updatedAt,
                  version
             from app_mail_domain
            where id = 'structurally-valid-only'`
        )
        .get();
      expect(() =>
        Schema.decodeUnknownSync(MailDomainSchema)(structurallyValidOnly)
      ).toThrow(/canonical mail-domain A-label/u);
    } finally {
      database.close();
    }
  });
});

const bootstrapReceiptOperation = "00000000-0000-4000-8000-000000000010";
const renameReceiptOperation = "00000000-0000-4000-8000-000000000011";

const seedMailboxAdministrationV1Receipts = (
  database: DatabaseSync,
  address = "inbox@example.test"
) => {
  insertFreshCutoverOrganization(database, 1000);
  database.exec(`
    insert into app_mailbox
      (id, display_name, status, created_by_user_id, created_at, updated_at,
       version)
    values ('primary', 'Inbox', 'active', 'user-a', 1000, 1000, 1);
    insert into app_mailbox_address
      (mailbox_id, id, address, normalized_address, is_primary, enabled,
       created_at, updated_at)
    values ('primary', 'primary', '${address}', 'inbox@example.test', 1, 1,
            1000, 1000);
    insert into app_mailbox_administration_receipt
      (operation_id, operation_kind, actor_user_id, mailbox_id, display_name,
       expected_version, result_mailbox_id, result_display_name, result_status,
       result_created_by_user_id, result_created_at, result_updated_at,
       result_version, committed_at, schema_version)
    values
      ('${bootstrapReceiptOperation}', 'bootstrap-owner', 'user-a', 'primary',
       'Inbox', null, 'primary', 'Inbox', 'active', 'user-a', 1000, 1000, 1,
       1000, 1);
    update app_mailbox
       set display_name = 'Recruiting', updated_at = 2000, version = 2
     where id = 'primary';
    insert into app_mailbox_administration_receipt
      (operation_id, operation_kind, actor_user_id, mailbox_id, display_name,
       expected_version, result_mailbox_id, result_display_name, result_status,
       result_created_by_user_id, result_created_at, result_updated_at,
       result_version, committed_at, schema_version)
    values
      ('${renameReceiptOperation}', 'rename', 'user-a', 'primary', 'Recruiting',
       1, 'primary', 'Recruiting', 'active', 'user-a', 1000, 2000, 2, 2000, 1);
  `);
};

const seedMalformedBootstrapReceipt = (
  database: DatabaseSync,
  state: "actor" | "address" | "timestamp" | "version"
) => {
  const updatedAt = state === "timestamp" ? 1001 : 1000;
  const version = state === "version" ? 2 : 1;
  const actor = state === "actor" ? "user-b" : "user-a";
  const address =
    state === "address" ? "Inbox@EXAMPLE.TEST" : "inbox@example.test";
  insertFreshCutoverOrganization(database, 1000);
  database.exec(`
    insert into app_mailbox
      (id, display_name, status, created_by_user_id, created_at, updated_at,
       version)
    values ('primary', 'Inbox', 'active', 'user-a', 1000, ${updatedAt}, ${version});
    insert into app_mailbox_address
      (mailbox_id, id, address, normalized_address, is_primary, enabled,
       created_at, updated_at, version)
    values ('primary', 'primary', '${address}', 'inbox@example.test', 1, 1,
            1000, 1000, 1);
    insert into app_mailbox_administration_receipt
      (operation_id, operation_kind, actor_user_id, mailbox_id, display_name,
       expected_version, result_mailbox_id, result_display_name, result_status,
       result_created_by_user_id, result_created_at, result_updated_at,
       result_version, committed_at, schema_version)
    values ('${bootstrapReceiptOperation}', 'bootstrap-owner', '${actor}',
            'primary', 'Inbox', null, 'primary', 'Inbox', 'active', 'user-a',
            1000, ${updatedAt}, ${version}, ${updatedAt}, 1);
  `);
};

describe("mailbox bootstrap receipt V2 migration", () => {
  it.each(["inbox@example.test", "inbox@EXAMPLE.TEST"] as const)(
    "backfills historical %s bootstrap intent without rewriting parents",
    async (address) => {
      const database = new DatabaseSync(":memory:");
      try {
        await applyControlPlaneMigrationsThrough(
          database,
          "1021_app_mail_domain.sql"
        );
        seedMailboxAdministrationV1Receipts(database, address);
        const before = database
          .prepare(
            "select * from app_mailbox_administration_receipt order by operation_id"
          )
          .all();

        await applyControlPlaneMigration(
          database,
          "1022_app_mailbox_bootstrap_receipt_v2.sql"
        );

        expect(
          database
            .prepare(
              "select * from app_mailbox_administration_receipt order by operation_id"
            )
            .all()
        ).toStrictEqual(before);
        expect(
          database
            .prepare("select * from app_mailbox_bootstrap_receipt_v1_intent")
            .all()
            .map((row) => ({ ...row }))
        ).toStrictEqual([
          {
            initial_address: "inbox@example.test",
            operation_id: bootstrapReceiptOperation,
          },
        ]);
        expect(
          database
            .prepare("select * from app_mailbox_bootstrap_receipt_v2")
            .all()
        ).toStrictEqual([]);
        expect(
          database.prepare("pragma foreign_key_check").all()
        ).toStrictEqual([]);
      } finally {
        database.close();
      }
    }
  );

  it("applies with no bootstrap history and seals the cutover", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrationsThrough(
        database,
        "1021_app_mail_domain.sql"
      );
      await applyControlPlaneMigration(
        database,
        "1022_app_mailbox_bootstrap_receipt_v2.sql"
      );

      expect(
        database
          .prepare("select * from app_mailbox_bootstrap_intent_cutover")
          .all()
      ).toMatchObject([{ id: 1, schema_version: 1 }]);
      expect(
        database
          .prepare("select * from app_mailbox_bootstrap_receipt_v1_intent")
          .all()
      ).toStrictEqual([]);
    } finally {
      database.close();
    }
  });

  it("auto-marks an old writer and promotes only an exact V2 intent", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      seedMailboxAdministrationV1Receipts(database);
      expect(
        database
          .prepare("select * from app_mailbox_bootstrap_receipt_v1_intent")
          .get()
      ).toMatchObject({
        initial_address: "inbox@example.test",
        operation_id: bootstrapReceiptOperation,
      });

      expect(() =>
        database
          .prepare(
            `insert into app_mailbox_bootstrap_receipt_v2
               (operation_id, initial_address, schema_version)
             values (?, 'other@example.test', 2)`
          )
          .run(bootstrapReceiptOperation)
      ).toThrow("invalid mailbox bootstrap v2 receipt promotion");
      expect(
        database
          .prepare("select * from app_mailbox_bootstrap_receipt_v1_intent")
          .all()
      ).toHaveLength(1);
      expect(
        database.prepare("select * from app_mailbox_bootstrap_receipt_v2").all()
      ).toStrictEqual([]);

      database
        .prepare(
          `insert into app_mailbox_bootstrap_receipt_v2
             (operation_id, initial_address, schema_version)
           values (?, 'inbox@example.test', 2)`
        )
        .run(bootstrapReceiptOperation);
      expect(
        database
          .prepare("select * from app_mailbox_bootstrap_receipt_v1_intent")
          .all()
      ).toStrictEqual([]);
      expect(
        database.prepare("select * from app_mailbox_bootstrap_receipt_v2").get()
      ).toMatchObject({ initial_address: "inbox@example.test" });
    } finally {
      database.close();
    }
  });

  it("rejects a forged old-writer parent after cutover", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);

      expect(() => seedMalformedBootstrapReceipt(database, "actor")).toThrow(
        "old bootstrap receipt could not bind durable intent"
      );
      expect(
        database
          .prepare("select * from app_mailbox_administration_receipt")
          .all()
      ).toStrictEqual([]);
      expect(
        database
          .prepare("select * from app_mailbox_bootstrap_receipt_v1_intent")
          .all()
      ).toStrictEqual([]);
    } finally {
      database.close();
    }
  });

  it.each(["actor", "address", "timestamp", "version"] as const)(
    "rejects malformed historical bootstrap %s state atomically",
    async (state) => {
      const database = new DatabaseSync(":memory:");
      try {
        await applyControlPlaneMigrationsThrough(
          database,
          "1021_app_mail_domain.sql"
        );
        seedMalformedBootstrapReceipt(database, state);

        await expect(
          applyControlPlaneMigration(
            database,
            "1022_app_mailbox_bootstrap_receipt_v2.sql"
          )
        ).rejects.toThrow(/constraint/u);
        expect(
          database
            .prepare(
              `select count(*) as count
                 from sqlite_master
                where type = 'table'
                  and name = 'app_mailbox_bootstrap_receipt_v1_intent'`
            )
            .get()
        ).toMatchObject({ count: 0 });
      } finally {
        database.close();
      }
    }
  );

  it("seals legacy markers and reapplies without changing the backfill", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrationsThrough(
        database,
        "1021_app_mail_domain.sql"
      );
      seedMailboxAdministrationV1Receipts(database);
      await applyControlPlaneMigration(
        database,
        "1022_app_mailbox_bootstrap_receipt_v2.sql"
      );
      const markerBefore = database
        .prepare("select * from app_mailbox_bootstrap_receipt_v1_intent")
        .all();
      await applyControlPlaneMigration(
        database,
        "1022_app_mailbox_bootstrap_receipt_v2.sql"
      );
      expect(
        database
          .prepare("select * from app_mailbox_bootstrap_receipt_v1_intent")
          .all()
      ).toStrictEqual(markerBefore);
      expect(() =>
        database
          .prepare(
            `insert into app_mailbox_bootstrap_receipt_v1_intent
               (operation_id, initial_address)
             values (?, 'inbox@example.test')`
          )
          .run(renameReceiptOperation)
      ).toThrow("invalid legacy mailbox bootstrap intent binding");
      expect(() =>
        database
          .prepare(
            `update app_mailbox_bootstrap_receipt_v1_intent
                set initial_address = 'changed@example.test'`
          )
          .run()
      ).toThrow("legacy mailbox bootstrap intents are immutable");
      expect(() =>
        database
          .prepare("delete from app_mailbox_bootstrap_receipt_v1_intent")
          .run()
      ).toThrow("legacy mailbox bootstrap intents are retained");
      expect(() =>
        database
          .prepare(
            `insert or replace into app_mailbox_bootstrap_receipt_v1_intent
             select * from app_mailbox_bootstrap_receipt_v1_intent`
          )
          .run()
      ).toThrow("legacy mailbox bootstrap intents are immutable");
    } finally {
      database.close();
    }
  });
});
