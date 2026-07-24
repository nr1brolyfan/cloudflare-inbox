/* oxlint-disable vitest/max-expects -- Each migration scenario verifies one atomic storage outcome. */
import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import { LEGACY_DEFAULT_ORGANIZATION_ID } from "#/modules/organization/domain/Organization";

import {
  applyControlPlaneMigration,
  applyControlPlaneMigrationsThrough,
  makeTestD1Database,
} from "../../support/d1";

const migration = "1023_app_organization_legacy_cutover.sql";

const make1022Database = async () => {
  const database = new DatabaseSync(":memory:");
  await applyControlPlaneMigrationsThrough(
    database,
    "1022_app_mailbox_bootstrap_receipt_v2.sql"
  );
  return database;
};

const insertMailbox = (
  database: DatabaseSync,
  id: string,
  createdAt: number | string
) =>
  database
    .prepare(
      `insert into app_mailbox
        (id, display_name, status, created_by_user_id, created_at, updated_at,
         version)
       values (?, 'Inbox', 'active', 'user-a', ?, ?, 1)`
    )
    .run(id, createdAt, createdAt);

const insertFreshBootstrapPair = (database: DatabaseSync, createdAt = 1000) => {
  database
    .prepare(
      `insert into app_organization (id, created_at, updated_at)
       values ('legacy_default_v1', ?, ?)`
    )
    .run(createdAt, createdAt);
  insertMailbox(database, "primary", createdAt);
};

const cutoverRows = (database: DatabaseSync) =>
  database
    .prepare("select * from app_organization_legacy_cutover order by id")
    .all()
    .map((row) => ({ ...row }));

const integrityState = (database: DatabaseSync) => ({
  foreignKeys: database.prepare("pragma foreign_key_check").all(),
  integrity: database
    .prepare("pragma integrity_check")
    .all()
    .map((row) => ({ ...row })),
});

const snapshotTables = (database: DatabaseSync, tables: readonly string[]) =>
  Object.fromEntries(
    tables.map((table) => [
      table,
      database.prepare(`select * from "${table}" order by rowid`).all(),
    ])
  );

const legacySnapshotTables = [
  "auth_user",
  "app_mailbox",
  "app_mailbox_member",
  "app_mailbox_address",
  "app_user_preference",
  "app_mailbox_administration_receipt",
  "app_mailbox_bootstrap_receipt_v1_intent",
] as const;

const protectedMailboxTables = [
  "app_mailbox",
  "app_mailbox_member",
  "app_mailbox_address",
  "app_mailbox_administration_receipt",
  "app_mailbox_bootstrap_receipt_v1_intent",
  "app_mailbox_bootstrap_receipt_v2",
] as const;

const seedLegacySnapshot = (database: DatabaseSync) => {
  database.exec(`
    insert into auth_user (id, created_at, updated_at)
    values ('user-a', 1234, 1234);
    insert into app_mailbox
      (id, display_name, status, created_by_user_id, created_at, updated_at,
       version)
    values ('primary', 'Inbox', 'active', 'user-a', 1234, 1234, 1);
    insert into app_mailbox_member
      (mailbox_id, user_id, created_at, updated_at)
    values ('primary', 'user-a', 1234, 1234);
    insert into app_mailbox_address
      (mailbox_id, id, address, normalized_address, display_name, is_primary,
       enabled, created_at, updated_at, version)
    values ('primary', 'primary', 'inbox@example.test', 'inbox@example.test',
            'Inbox', 1, 1, 1234, 1234, 1);
    insert into app_user_preference
      (user_id, default_mailbox_id, settings_json, created_at, updated_at,
       version)
    values ('user-a', 'primary', '{"theme":"dark"}', 1234, 1234, 1);
    insert into app_mailbox_administration_receipt
      (operation_id, operation_kind, actor_user_id, mailbox_id, display_name,
       expected_version, result_mailbox_id, result_display_name, result_status,
       result_created_by_user_id, result_created_at, result_updated_at,
       result_version, committed_at, schema_version)
    values ('00000000-0000-4000-8000-000000000010', 'bootstrap-owner',
            'user-a', 'primary', 'Inbox', null, 'primary', 'Inbox', 'active',
            'user-a', 1234, 1234, 1, 1234, 1);
  `);
};

const seedFreshRuntimeDependents = (database: DatabaseSync) => {
  database.exec(`
    insert into app_mailbox_member
      (mailbox_id, user_id, created_at, updated_at)
    values ('primary', 'user-a', 1000, 1000);
    insert into app_mailbox_address
      (mailbox_id, id, address, normalized_address, display_name, is_primary,
       enabled, created_at, updated_at, version)
    values ('primary', 'primary', 'inbox@example.test', 'inbox@example.test',
            'Inbox', 1, 1, 1000, 1000, 1);
    insert into app_mailbox_administration_receipt
      (operation_id, operation_kind, actor_user_id, mailbox_id, display_name,
       expected_version, result_mailbox_id, result_display_name, result_status,
       result_created_by_user_id, result_created_at, result_updated_at,
       result_version, committed_at, schema_version)
    values ('00000000-0000-4000-8000-000000000010', 'bootstrap-owner',
            'user-a', 'primary', 'Inbox', null, 'primary', 'Inbox', 'active',
            'user-a', 1000, 1000, 1, 1000, 1);
    insert into app_mailbox_bootstrap_receipt_v2
      (operation_id, initial_address, schema_version)
    values ('00000000-0000-4000-8000-000000000010', 'inbox@example.test', 2);
  `);
};

describe("organization legacy cutover migration", () => {
  it("upgrades a real 1022 legacy snapshot without rewriting legacy rows", async () => {
    const database = await make1022Database();
    try {
      seedLegacySnapshot(database);
      const before = snapshotTables(database, legacySnapshotTables);

      await applyControlPlaneMigration(database, migration);
      await applyControlPlaneMigration(database, migration);

      expect(snapshotTables(database, legacySnapshotTables)).toStrictEqual(
        before
      );
      expect(
        database
          .prepare("select * from app_organization")
          .all()
          .map((row) => ({
            ...row,
          }))
      ).toStrictEqual([
        {
          created_at: 1234,
          id: LEGACY_DEFAULT_ORGANIZATION_ID,
          status: "active",
          updated_at: 1234,
          version: 1,
        },
      ]);
      expect(cutoverRows(database)).toStrictEqual([
        {
          id: 1,
          organization_id: LEGACY_DEFAULT_ORGANIZATION_ID,
          outcome: "legacy-primary",
          schema_version: 1,
          source_created_at: 1234,
          source_mailbox_id: "primary",
        },
      ]);
      expect(integrityState(database)).toStrictEqual({
        foreignKeys: [],
        integrity: [{ integrity_check: "ok" }],
      });
    } finally {
      database.close();
    }
  });

  it("records fresh-empty without creating a synthetic organization", async () => {
    const database = await make1022Database();
    try {
      await applyControlPlaneMigration(database, migration);

      expect(
        database.prepare("select * from app_organization").all()
      ).toStrictEqual([]);
      expect(cutoverRows(database)).toStrictEqual([
        {
          id: 1,
          organization_id: null,
          outcome: "fresh-empty",
          schema_version: 1,
          source_created_at: null,
          source_mailbox_id: null,
        },
      ]);
      expect(() => insertMailbox(database, "primary", 1000)).toThrow(
        "fresh mailbox requires its reserved legacy organization"
      );
      expect(integrityState(database)).toStrictEqual({
        foreignKeys: [],
        integrity: [{ integrity_check: "ok" }],
      });
    } finally {
      database.close();
    }
  });

  it.each([
    ["non-primary", false],
    ["multiple", true],
  ] as const)("rejects %s mailbox state atomically", async (_, multiple) => {
    const database = await make1022Database();
    try {
      if (multiple) {
        insertMailbox(database, "primary", 1000);
        database.exec("drop index app_mailbox_singleton_idx");
        insertMailbox(database, "secondary", 1001);
      } else {
        insertMailbox(database, "secondary", 1000);
      }

      await expect(
        applyControlPlaneMigration(database, migration)
      ).rejects.toThrow(/constraint/u);
      expect(
        database
          .prepare(
            `select count(*) as count from sqlite_master
              where type = 'table'
                and name = 'app_organization_legacy_cutover'`
          )
          .get()
      ).toMatchObject({ count: 0 });
      expect(
        database.prepare("select * from app_organization").all()
      ).toStrictEqual([]);
    } finally {
      database.close();
    }
  });

  it.each([
    ["unsafe", 9_007_199_254_740_992],
    ["real", 1.5],
    ["text", "not-a-timestamp"],
  ] as const)("rejects a %s source created_at", async (_, createdAt) => {
    const database = await make1022Database();
    try {
      insertMailbox(database, "primary", createdAt);

      await expect(
        applyControlPlaneMigration(database, migration)
      ).rejects.toThrow(/constraint/u);
      expect(
        database.prepare("select * from app_organization").all()
      ).toStrictEqual([]);
    } finally {
      database.close();
    }
  });

  it.each(["legacy_default_v1", "organization-a"])(
    "rejects preexisting organization %s even when the mailbox state is valid",
    async (organizationId) => {
      const database = await make1022Database();
      try {
        insertMailbox(database, "primary", 1000);
        database
          .prepare(
            `insert into app_organization (id, created_at, updated_at)
             values (?, 1000, 1000)`
          )
          .run(organizationId);

        await expect(
          applyControlPlaneMigration(database, migration)
        ).rejects.toThrow(/constraint/u);
        expect(
          database.prepare("select * from app_organization").all()
        ).toHaveLength(1);
      } finally {
        database.close();
      }
    }
  );

  it("reapplies legacy provenance after legal organization and mailbox lifecycle changes", async () => {
    const database = await make1022Database();
    try {
      insertMailbox(database, "primary", 1000);
      await applyControlPlaneMigration(database, migration);
      const cutover = cutoverRows(database);
      database.exec(`
        update app_organization
           set status = 'suspended', updated_at = 2000, version = 2
         where id = 'legacy_default_v1';
        update app_mailbox
           set display_name = 'Renamed', status = 'suspended',
               updated_at = 2000, version = 2
         where id = 'primary';
      `);

      await applyControlPlaneMigration(database, migration);

      expect(cutoverRows(database)).toStrictEqual(cutover);
      expect(
        database
          .prepare("select status, updated_at, version from app_organization")
          .get()
      ).toMatchObject({ status: "suspended", updated_at: 2000, version: 2 });
    } finally {
      database.close();
    }
  });

  it("reapplies fresh provenance for the exact trusted-bootstrap pair", async () => {
    const database = await make1022Database();
    try {
      await applyControlPlaneMigration(database, migration);
      insertFreshBootstrapPair(database);

      await applyControlPlaneMigration(database, migration);

      expect(cutoverRows(database)[0]).toMatchObject({
        organization_id: null,
        outcome: "fresh-empty",
        source_mailbox_id: null,
      });
    } finally {
      database.close();
    }
  });

  it("accepts intentional lifecycle updates while retaining fresh creation provenance", async () => {
    const database = await make1022Database();
    try {
      await applyControlPlaneMigration(database, migration);
      insertFreshBootstrapPair(database);

      database.exec(`
        update app_organization
           set status = 'suspended', updated_at = 2000, version = 2
         where id = 'legacy_default_v1';
        update app_mailbox
           set display_name = 'Renamed', status = 'suspended',
               updated_at = 2000, version = 2
         where id = 'primary';
      `);
      await applyControlPlaneMigration(database, migration);

      expect(
        database
          .prepare(
            `select display_name, status, created_at, updated_at, version
               from app_mailbox`
          )
          .get()
      ).toMatchObject({
        created_at: 1000,
        display_name: "Renamed",
        status: "suspended",
        updated_at: 2000,
        version: 2,
      });
    } finally {
      database.close();
    }
  });

  it.each([
    "primary-without-organization",
    "reserved-organization-without-mailbox",
    "unrelated-organization",
    "timestamp-disagreement",
    "additional-organization",
    "additional-mailbox",
  ] as const)("rejects forged fresh provenance: %s", async (state) => {
    const database = await make1022Database();
    try {
      await applyControlPlaneMigration(database, migration);
      if (state === "primary-without-organization") {
        database.exec(
          "drop trigger app_organization_fresh_mailbox_insert_guard"
        );
        insertMailbox(database, "primary", 1000);
      } else if (state === "reserved-organization-without-mailbox") {
        database.exec(`insert into app_organization
          (id, created_at, updated_at)
          values ('legacy_default_v1', 1000, 1000)`);
      } else if (state === "unrelated-organization") {
        database.exec(`insert into app_organization
          (id, created_at, updated_at)
          values ('organization-a', 1000, 1000)`);
      } else if (state === "timestamp-disagreement") {
        database.exec(`insert into app_organization
          (id, created_at, updated_at)
          values ('legacy_default_v1', 1000, 1000)`);
        database.exec(
          "drop trigger app_organization_fresh_mailbox_insert_guard"
        );
        insertMailbox(database, "primary", 1001);
      } else if (state === "additional-organization") {
        insertFreshBootstrapPair(database);
        database.exec(`insert into app_organization
          (id, created_at, updated_at)
          values ('organization-a', 1000, 1000)`);
      } else {
        insertFreshBootstrapPair(database);
        database.exec("drop index app_mailbox_singleton_idx");
        database.exec(
          "drop trigger app_organization_fresh_mailbox_insert_guard"
        );
        insertMailbox(database, "secondary", 1000);
      }

      await expect(
        applyControlPlaneMigration(database, migration)
      ).rejects.toThrow(/constraint/u);
    } finally {
      database.close();
    }
  });

  it("restores an exact owned trigger over a same-name no-op collision", async () => {
    const database = await make1022Database();
    try {
      await applyControlPlaneMigration(database, migration);
      database.exec(`
        drop trigger app_organization_legacy_cutover_no_update;
        create trigger app_organization_legacy_cutover_no_update
        before update on app_organization_legacy_cutover
        begin
          select 1;
        end;
      `);

      await applyControlPlaneMigration(database, migration);

      expect(
        Object.fromEntries(
          (
            database
              .prepare(
                `select name, sql
                   from sqlite_master
                  where type = 'trigger'
                    and name like 'app_organization_%'
                  order by name`
              )
              .all() as { readonly name: string; readonly sql: string }[]
          ).map(({ name, sql }) => [name, sql])
        )
      ).toMatchObject({
        app_organization_fresh_mailbox_insert_guard: expect.stringContaining(
          "fresh mailbox requires its reserved legacy organization"
        ),
        app_organization_legacy_cutover_no_delete: expect.stringContaining(
          "organization legacy cutover is retained"
        ),
        app_organization_legacy_cutover_no_insert: expect.stringContaining(
          "organization legacy cutover is sealed"
        ),
        app_organization_legacy_cutover_no_update: expect.stringContaining(
          "organization legacy cutover is immutable"
        ),
        app_organization_mailbox_creation_provenance: expect.stringContaining(
          "organization mailbox creation provenance is immutable"
        ),
        app_organization_primary_mailbox_no_delete: expect.stringContaining(
          "organization primary mailbox is retained"
        ),
        app_organization_primary_mailbox_no_replace: expect.stringContaining(
          "organization primary mailbox replacement is forbidden"
        ),
      });
      expect(() =>
        database
          .prepare(
            "update app_organization_legacy_cutover set schema_version = 1"
          )
          .run()
      ).toThrow("organization legacy cutover is immutable");
    } finally {
      database.close();
    }
  });

  it.each(["legacy-primary", "fresh-runtime"] as const)(
    "retains mailbox creation provenance for %s while allowing lifecycle fields",
    async (outcome) => {
      const database = await make1022Database();
      try {
        if (outcome === "legacy-primary") {
          insertMailbox(database, "primary", 1000);
          await applyControlPlaneMigration(database, migration);
        } else {
          await applyControlPlaneMigration(database, migration);
          insertFreshBootstrapPair(database);
        }

        expect(() =>
          database
            .prepare(
              "update app_mailbox set created_at = 999 where id = 'primary'"
            )
            .run()
        ).toThrow("organization mailbox creation provenance is immutable");
        expect(() =>
          database
            .prepare(
              "update app_mailbox set id = 'changed' where id = 'primary'"
            )
            .run()
        ).toThrow(/creation provenance|foreign key/iu);
        database.exec(`update app_mailbox
          set display_name = 'Renamed', status = 'suspended',
              updated_at = 2000, version = 2
          where id = 'primary'`);
        expect(
          database
            .prepare(
              "select id, created_at, display_name, status, version from app_mailbox"
            )
            .get()
        ).toMatchObject({
          created_at: 1000,
          display_name: "Renamed",
          id: "primary",
          status: "suspended",
          version: 2,
        });
      } finally {
        database.close();
      }
    }
  );

  it.each(["legacy-primary", "fresh-runtime"] as const)(
    "retains the complete protected primary row graph against delete and replace for %s",
    async (outcome) => {
      const database = await make1022Database();
      try {
        if (outcome === "legacy-primary") {
          seedLegacySnapshot(database);
          await applyControlPlaneMigration(database, migration);
        } else {
          await applyControlPlaneMigration(database, migration);
          insertFreshBootstrapPair(database);
          seedFreshRuntimeDependents(database);
        }
        const before = snapshotTables(database, protectedMailboxTables);

        expect(() =>
          database.prepare("delete from app_mailbox where id = 'primary'").run()
        ).toThrow("organization primary mailbox is retained");
        expect(snapshotTables(database, protectedMailboxTables)).toStrictEqual(
          before
        );

        database.exec("pragma recursive_triggers = off");
        expect(
          database.prepare("pragma recursive_triggers").get()
        ).toMatchObject({ recursive_triggers: 0 });
        expect(() =>
          database
            .prepare(
              `insert or replace into app_mailbox
                (id, display_name, status, created_by_user_id, created_at,
                 updated_at, version)
               values ('primary', 'Replacement', 'active', 'user-b', 2000,
                       2000, 1)`
            )
            .run()
        ).toThrow("organization primary mailbox replacement is forbidden");
        expect(snapshotTables(database, protectedMailboxTables)).toStrictEqual(
          before
        );

        await applyControlPlaneMigration(database, migration);
        expect(snapshotTables(database, protectedMailboxTables)).toStrictEqual(
          before
        );
      } finally {
        database.close();
      }
    }
  );

  it("rolls back a complete old-writer batch after a fresh cutover", async () => {
    const database = await make1022Database();
    try {
      await applyControlPlaneMigration(database, migration);
      const d1 = makeTestD1Database(database);

      await expect(
        d1.batch([
          d1.prepare(`insert into app_mailbox
            (id, display_name, status, created_by_user_id, created_at,
             updated_at, version)
            values ('primary', 'Inbox', 'active', 'user-a', 1000, 1000, 1)`),
          d1.prepare(`insert into app_mailbox_address
            (mailbox_id, id, address, normalized_address, is_primary, enabled,
             created_at, updated_at)
            values ('primary', 'primary', 'inbox@example.test',
                    'inbox@example.test', 1, 1, 1000, 1000)`),
          d1.prepare(`insert into app_mailbox_administration_receipt
            (operation_id, operation_kind, actor_user_id, mailbox_id,
             display_name, expected_version, result_mailbox_id,
             result_display_name, result_status, result_created_by_user_id,
             result_created_at, result_updated_at, result_version,
             committed_at, schema_version)
            values ('00000000-0000-4000-8000-000000000010',
                    'bootstrap-owner', 'user-a', 'primary', 'Inbox', null,
                    'primary', 'Inbox', 'active', 'user-a', 1000, 1000, 1,
                    1000, 1)`),
        ])
      ).rejects.toThrow(
        "fresh mailbox requires its reserved legacy organization"
      );
      expect({
        addresses: database.prepare("select * from app_mailbox_address").all(),
        mailboxes: database.prepare("select * from app_mailbox").all(),
        receipts: database
          .prepare("select * from app_mailbox_administration_receipt")
          .all(),
      }).toStrictEqual({ addresses: [], mailboxes: [], receipts: [] });
    } finally {
      database.close();
    }
  });

  it.each(["missing", "changed"] as const)(
    "rejects %s provenance on reapply",
    async (corruption) => {
      const database = await make1022Database();
      try {
        insertMailbox(database, "primary", 1000);
        await applyControlPlaneMigration(database, migration);
        if (corruption === "missing") {
          database.exec(
            "drop trigger app_organization_legacy_cutover_no_delete"
          );
          database.prepare("delete from app_organization_legacy_cutover").run();
        } else {
          database.exec(
            "drop trigger app_organization_legacy_cutover_no_update"
          );
          database.exec("pragma ignore_check_constraints = on");
          database
            .prepare(
              "update app_organization_legacy_cutover set source_created_at = 1001"
            )
            .run();
          database.exec("pragma ignore_check_constraints = off");
        }

        await expect(
          applyControlPlaneMigration(database, migration)
        ).rejects.toThrow(/constraint/u);
      } finally {
        database.close();
      }
    }
  );

  it("rejects a preexisting partial cutover table instead of treating it as first application", async () => {
    const database = await make1022Database();
    try {
      database.exec(`create table app_organization_legacy_cutover (
        id integer primary key,
        schema_version integer not null,
        outcome text not null,
        source_mailbox_id text,
        source_created_at integer,
        organization_id text,
        foreign key (source_mailbox_id) references app_mailbox (id)
          on update restrict on delete restrict,
        foreign key (organization_id) references app_organization (id)
          on update restrict on delete restrict
      )`);

      await expect(
        applyControlPlaneMigration(database, migration)
      ).rejects.toThrow(/constraint/u);
      expect(
        database.prepare("select * from app_organization_legacy_cutover").all()
      ).toStrictEqual([]);
    } finally {
      database.close();
    }
  });

  it("seals the cutover against update, delete, replace, and upsert", async () => {
    const database = await make1022Database();
    try {
      await applyControlPlaneMigration(database, migration);
      const original = cutoverRows(database);
      for (const statement of [
        "update app_organization_legacy_cutover set schema_version = 1",
        "delete from app_organization_legacy_cutover",
        `insert or replace into app_organization_legacy_cutover
         select * from app_organization_legacy_cutover`,
        `insert into app_organization_legacy_cutover
         values (1, 1, 'fresh-empty', null, null, null)
         on conflict(id) do update set schema_version = excluded.schema_version`,
      ]) {
        expect(() => database.exec(statement)).toThrow(
          /sealed|immutable|retained/u
        );
      }
      expect(cutoverRows(database)).toStrictEqual(original);
    } finally {
      database.close();
    }
  });

  it("uses restrictive foreign keys for retained legacy provenance", async () => {
    const database = await make1022Database();
    try {
      insertMailbox(database, "primary", 1000);
      await applyControlPlaneMigration(database, migration);

      expect(() =>
        database
          .prepare("update app_mailbox set id = 'changed' where id = 'primary'")
          .run()
      ).toThrow(/creation provenance|foreign key/iu);
      expect(integrityState(database)).toStrictEqual({
        foreignKeys: [],
        integrity: [{ integrity_check: "ok" }],
      });
    } finally {
      database.close();
    }
  });
});
