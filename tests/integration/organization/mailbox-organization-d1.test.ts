/* oxlint-disable vitest/max-expects -- Each case verifies one atomic storage generation. */
import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import {
  applyControlPlaneMigration,
  applyControlPlaneMigrationsThrough,
} from "../../support/d1";

const migration = "1027_app_mailbox_organization.sql";

const makeFresh1026Database = async () => {
  const database = new DatabaseSync(":memory:");
  await applyControlPlaneMigrationsThrough(
    database,
    "1026_app_legacy_mail_domain_claim.sql"
  );
  return database;
};

const makeFresh1027Database = async () => {
  const database = await makeFresh1026Database();
  await applyControlPlaneMigration(database, migration);
  return database;
};

const makePopulated1026Database = async () => {
  const database = new DatabaseSync(":memory:");
  await applyControlPlaneMigrationsThrough(
    database,
    "1022_app_mailbox_bootstrap_receipt_v2.sql"
  );
  database.exec(`
    insert into auth_user (id, created_at, updated_at)
    values ('user-a', 1000, 1000);
    insert into app_mailbox
      (id, display_name, status, created_by_user_id, created_at, updated_at,
       version)
    values ('primary', 'Inbox', 'active', 'user-a', 1000, 1000, 1);
    insert into app_mailbox_member
      (mailbox_id, user_id, created_at, updated_at)
    values ('primary', 'user-a', 1000, 1000);
    insert into app_mailbox_address
      (mailbox_id, id, address, normalized_address, is_primary, enabled,
       created_at, updated_at)
    values ('primary', 'primary', 'inbox@example.test', 'inbox@example.test',
      1, 1, 1000, 1000);
    insert into auth_role_grant
      (subject_type, subject_id, role_id, scope_type, scope_id_present,
       scope_id)
    values ('user', 'user-a', 'owner', 'mailbox', 1, 'primary');
  `);
  for (const file of [
    "1023_app_organization_legacy_cutover.sql",
    "1024_app_mailbox_legacy_organization_assignment.sql",
    "1025_app_organization_owner_assignment.sql",
    "1026_app_legacy_mail_domain_claim.sql",
  ]) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- Migration generations are ordered.
    await applyControlPlaneMigration(database, file);
  }
  return database;
};

const insertOrganization = (database: DatabaseSync, createdAt = 1000) =>
  database.exec(`insert into app_organization (id, created_at, updated_at)
    values ('legacy_default_v1', ${createdAt}, ${createdAt})`);

const insertMailbox = (database: DatabaseSync, organizationSql?: string) =>
  database.exec(`insert into app_mailbox
    (id, display_name, status, created_by_user_id, created_at, updated_at,
     version${organizationSql === undefined ? "" : ", organization_id"})
    values ('primary', 'Inbox', 'active', 'user-a', 1000, 1000, 1${
      organizationSql === undefined ? "" : `, ${organizationSql}`
    })`);

const persistentBytes = (database: DatabaseSync) => ({
  data: Object.fromEntries(
    [
      "app_mailbox",
      "app_organization",
      "app_organization_legacy_cutover",
      "app_mailbox_legacy_organization_assignment",
      "app_mailbox_legacy_organization_assignment_cutover",
      "app_organization_owner_assignment_receipt",
      "app_organization_owner_assignment_cutover",
      "app_mail_domain",
      "app_mail_domain_claim_receipt",
      "app_mail_domain_claim_cutover",
      "app_mailbox_organization_generation",
    ]
      .filter(
        (table) =>
          database
            .prepare(
              "select 1 from sqlite_master where type = 'table' and name = ?"
            )
            .get(table) !== undefined
      )
      .map((table) => [
        table,
        database.prepare(`select * from "${table}"`).all(),
      ])
  ),
  schema: database
    .prepare(
      `select type, name, tbl_name, sql from sqlite_master
       where name not like 'sqlite_%' order by type, name`
    )
    .all(),
});

describe("canonical mailbox organization migration", () => {
  it("preserves a populated mailbox and backfills solely from its retained bridge", async () => {
    const database = await makePopulated1026Database();
    try {
      const before = { ...database.prepare("select * from app_mailbox").get() };
      const bridge = database
        .prepare(
          "select organization_id from app_mailbox_legacy_organization_assignment where mailbox_id = 'primary'"
        )
        .get() as { readonly organization_id: string };
      await applyControlPlaneMigration(database, migration);
      expect({
        ...database.prepare("select * from app_mailbox").get(),
      }).toStrictEqual({ ...before, organization_id: bridge.organization_id });
      expect(
        database
          .prepare("select * from app_mailbox_legacy_organization_assignment")
          .all()
          .map((row) => ({ ...row }))
      ).toStrictEqual([
        {
          effective_at: 1000,
          mailbox_id: "primary",
          organization_id: "legacy_default_v1",
          schema_version: 1,
          source: "legacy-cutover",
        },
      ]);
    } finally {
      database.close();
    }
  });

  it("adds a physically nullable but logically required restricted column and exact partial index", async () => {
    const database = await makeFresh1027Database();
    try {
      const column = database
        .prepare(
          `select name, type, "notnull", dflt_value, pk, hidden
           from pragma_table_xinfo('app_mailbox') where name = 'organization_id'`
        )
        .get();
      expect({ ...column }).toStrictEqual({
        dflt_value: null,
        hidden: 0,
        name: "organization_id",
        notnull: 0,
        pk: 0,
        type: "TEXT",
      });
      expect({
        ...database
          .prepare(
            `select sql from sqlite_master
             where type = 'index' and name = 'app_mailbox_organization_status_idx'`
          )
          .get(),
      }).toStrictEqual({
        sql: `CREATE INDEX app_mailbox_organization_status_idx
  on app_mailbox (organization_id, status, id)
  where deleted_at is null`,
      });
      expect(
        database.prepare("pragma foreign_key_list('app_mailbox')").all()
      ).toContainEqual(
        expect.objectContaining({
          from: "organization_id",
          on_delete: "RESTRICT",
          on_update: "RESTRICT",
          table: "app_organization",
          to: "id",
        })
      );
    } finally {
      database.close();
    }
  });

  it.each(["missing", "no-op", "string-marker-lookalike"] as const)(
    "rejects %s inherited trigger generation before ALTER",
    async (corruption) => {
      const database = await makeFresh1026Database();
      try {
        if (corruption === "missing") {
          database.exec(
            "drop trigger app_mailbox_legacy_organization_assignment_binding"
          );
        } else if (corruption === "no-op") {
          database.exec(`
            drop trigger app_organization_no_delete;
            create trigger app_organization_no_delete
            before delete on app_organization begin select 1; end;
          `);
        } else {
          database.exec(`
            drop trigger app_organization_fresh_mailbox_insert_guard;
            create trigger app_organization_fresh_mailbox_insert_guard
            before insert on app_mailbox begin
              select 'fresh mailbox requires its reserved legacy organization';
            end;
          `);
        }
        const before = persistentBytes(database);
        await expect(
          applyControlPlaneMigration(database, migration)
        ).rejects.toThrow(/constraint/iu);
        expect(persistentBytes(database)).toStrictEqual(before);
        expect(
          database
            .prepare(
              "select 1 from pragma_table_xinfo('app_mailbox') where name = 'organization_id'"
            )
            .get()
        ).toBeUndefined();
      } finally {
        database.close();
      }
    }
  );

  it.each([
    ["rolling old writer", undefined],
    ["current writer", "'legacy_default_v1'"],
  ] as const)(
    "materializes exact fresh ancestry for the %s",
    async (_, value) => {
      const database = await makeFresh1027Database();
      try {
        insertOrganization(database);
        insertMailbox(database, value);
        expect(
          database.prepare("select * from app_mailbox").get()
        ).toMatchObject({
          id: "primary",
          organization_id: "legacy_default_v1",
        });
        expect(
          database
            .prepare("select * from app_mailbox_legacy_organization_assignment")
            .get()
        ).toMatchObject({
          effective_at: 1000,
          mailbox_id: "primary",
          organization_id: "legacy_default_v1",
          schema_version: 1,
          source: "fresh-bootstrap",
        });
      } finally {
        database.close();
      }
    }
  );

  it.each([
    ["wrong", "'other'"],
    ["empty", "''"],
    ["integer", "1"],
    ["blob", "x'6c65676163795f64656661756c745f7631'"],
  ] as const)(
    "rejects %s explicit organization with foreign keys on and off",
    async (_, value) => {
      await Promise.all(
        (["on", "off"] as const).map(async (foreignKeys) => {
          const database = await makeFresh1027Database();
          try {
            insertOrganization(database);
            if (_ === "wrong") {
              database.exec(`insert into app_organization
                (id, created_at, updated_at) values ('other', 1000, 1000)`);
            }
            database.exec(`pragma foreign_keys = ${foreignKeys}`);
            expect(() => insertMailbox(database, value)).toThrow(
              /organization|ancestry/u
            );
            expect(
              database.prepare("select * from app_mailbox").all()
            ).toStrictEqual([]);
            expect(
              database
                .prepare(
                  "select * from app_mailbox_legacy_organization_assignment"
                )
                .all()
            ).toStrictEqual([]);
          } finally {
            database.close();
          }
        })
      );
    }
  );

  it("rejects mutation, replacement, and upsert while allowing lifecycle updates", async () => {
    const database = await makeFresh1027Database();
    try {
      insertOrganization(database);
      insertMailbox(database, "'legacy_default_v1'");
      const attempts = [
        "update app_mailbox set organization_id = null where id = 'primary'",
        "update app_mailbox set organization_id = 'other' where id = 'primary'",
        "update app_mailbox set id = 'other' where id = 'primary'",
        `insert or replace into app_mailbox
          (id, display_name, status, created_by_user_id, created_at, updated_at,
           version, organization_id)
         values ('primary', 'Other', 'active', 'user-b', 2000, 2000, 1,
           'legacy_default_v1')`,
        `insert into app_mailbox
          (id, display_name, status, created_by_user_id, created_at, updated_at,
           version, organization_id)
         values ('primary', 'Other', 'active', 'user-b', 2000, 2000, 1,
           'legacy_default_v1')
         on conflict (id) do update set display_name = excluded.display_name`,
      ];
      database.exec("pragma recursive_triggers = off");
      for (const statement of attempts) {
        expect(() => database.exec(statement)).toThrow(
          /immutable|inconsistent|ancestry/u
        );
      }
      database.exec(`update app_mailbox set display_name = 'Renamed',
        status = 'suspended', updated_at = 1100, version = 2
        where id = 'primary'`);
      expect(database.prepare("select * from app_mailbox").get()).toMatchObject(
        {
          display_name: "Renamed",
          organization_id: "legacy_default_v1",
          status: "suspended",
          version: 2,
        }
      );
    } finally {
      database.close();
    }
  });

  it.each(["on", "off"] as const)(
    "retains mailbox and organization parents with foreign keys %s",
    async (foreignKeys) => {
      const database = await makePopulated1026Database();
      try {
        await applyControlPlaneMigration(database, migration);
        database.exec(`pragma foreign_keys = ${foreignKeys}`);
        const before = persistentBytes(database);
        expect(() =>
          database.exec("delete from app_mailbox where id = 'primary'")
        ).toThrow(/retained/u);
        expect(() =>
          database.exec(
            "delete from app_organization where id = 'legacy_default_v1'"
          )
        ).toThrow(/retained/u);
        expect(persistentBytes(database)).toStrictEqual(before);
      } finally {
        database.close();
      }
    }
  );

  it("rolls back bridge and canonical column when a later batch step fails", async () => {
    const database = await makeFresh1027Database();
    try {
      insertOrganization(database);
      database.exec("begin immediate");
      expect(() => {
        insertMailbox(database);
        database.exec("insert into missing_later_batch_table values (1)");
      }).toThrow(/missing_later_batch_table/u);
      database.exec("rollback");
      expect(database.prepare("select * from app_mailbox").all()).toStrictEqual(
        []
      );
      expect(
        database
          .prepare("select * from app_mailbox_legacy_organization_assignment")
          .all()
      ).toStrictEqual([]);
    } finally {
      database.close();
    }
  });

  it("rejects manual reapplication before mutation and never heals missing artifacts", async () => {
    const database = await makeFresh1027Database();
    try {
      insertOrganization(database);
      insertMailbox(database);
      const before = persistentBytes(database);
      await expect(
        applyControlPlaneMigration(database, migration)
      ).rejects.toThrow(/constraint/iu);
      expect(persistentBytes(database)).toStrictEqual(before);

      database.exec("drop trigger app_mailbox_organization_immutable");
      const corrupted = persistentBytes(database);
      await expect(
        applyControlPlaneMigration(database, migration)
      ).rejects.toThrow(/constraint/iu);
      expect(persistentBytes(database)).toStrictEqual(corrupted);
    } finally {
      database.close();
    }
  });

  it("rejects predecessor migration reapplication in the column era", async () => {
    const database = await makeFresh1027Database();
    try {
      for (const predecessor of [
        "1023_app_organization_legacy_cutover.sql",
        "1024_app_mailbox_legacy_organization_assignment.sql",
        "1025_app_organization_owner_assignment.sql",
        "1026_app_legacy_mail_domain_claim.sql",
      ]) {
        const before = persistentBytes(database);
        // oxlint-disable-next-line eslint/no-await-in-loop -- Each predecessor observes the unchanged successor generation.
        await expect(
          applyControlPlaneMigration(database, predecessor)
        ).rejects.toThrow(/constraint/iu);
        expect(persistentBytes(database)).toStrictEqual(before);
      }
    } finally {
      database.close();
    }
  });

  it("keeps full foreign-key and integrity checks clean", async () => {
    const database = await makeFresh1027Database();
    try {
      insertOrganization(database);
      insertMailbox(database);
      expect(database.prepare("pragma foreign_key_check").all()).toStrictEqual(
        []
      );
      expect(
        database
          .prepare("pragma integrity_check")
          .all()
          .map((row) => ({ ...row }))
      ).toStrictEqual([{ integrity_check: "ok" }]);
    } finally {
      database.close();
    }
  });
});
