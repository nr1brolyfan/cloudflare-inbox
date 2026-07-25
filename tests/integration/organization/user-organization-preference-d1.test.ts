/* oxlint-disable vitest/max-expects -- Each case verifies one atomic storage generation. */
import { DatabaseSync } from "node:sqlite";

import { getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import { appUserOrganizationPreference } from "#/modules/organization/adapters/d1/OrganizationSchema";
import {
  OrganizationPreferenceSettingsJson,
  UserOrganizationPreferenceSchema,
} from "#/modules/organization/domain/UserOrganizationPreference";

import {
  applyControlPlaneMigration,
  applyControlPlaneMigrationsThrough,
  insertFreshCutoverOrganization,
} from "../../support/d1";

const migration = "1028_app_user_organization_preference.sql";

const makeFresh1027Database = async () => {
  const database = new DatabaseSync(":memory:");
  await applyControlPlaneMigrationsThrough(
    database,
    "1027_app_mailbox_organization.sql"
  );
  return database;
};

const makePopulated1027Database = async () => {
  const database = new DatabaseSync(":memory:");
  await applyControlPlaneMigrationsThrough(
    database,
    "1022_app_mailbox_bootstrap_receipt_v2.sql"
  );
  database.exec(`
    insert into auth_user (id, created_at, updated_at)
    values ('user-a', 1000, 1000), ('user-b', 1000, 1000);
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
    "1027_app_mailbox_organization.sql",
  ]) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- Migration generations are ordered.
    await applyControlPlaneMigration(database, file);
  }
  return database;
};

const preferenceRows = (database: DatabaseSync) =>
  database
    .prepare(
      `select * from app_user_organization_preference
       order by organization_id, user_id`
    )
    .all()
    .map((row) => ({ ...row }));

const persistentState = (database: DatabaseSync) => ({
  data: Object.fromEntries(
    (
      database
        .prepare(
          `select name from sqlite_master where type = 'table'
           and name not like 'sqlite_%' order by name`
        )
        .all() as { readonly name: string }[]
    ).map(({ name }) => [
      name,
      database.prepare(`select * from "${name}" order by rowid`).all(),
    ])
  ),
  schema: database
    .prepare(
      `select type, name, tbl_name, sql from sqlite_master
       where name not like 'sqlite_%' order by type, name`
    )
    .all(),
});

const insertFreshMailbox = (database: DatabaseSync) => {
  database.exec(`
    insert into auth_user (id, created_at, updated_at)
    values ('user-a', 1000, 1000), ('user-b', 1000, 1000);
  `);
  insertFreshCutoverOrganization(database, 1000);
  database.exec(`insert into app_mailbox
    (id, display_name, status, created_by_user_id, created_at, updated_at)
    values ('primary', 'Inbox', 'active', 'user-a', 1000, 1000)`);
};

const mutateSealedRow = (
  database: DatabaseSync,
  triggerName: string,
  statement: string,
  options: { readonly ignoreChecks?: boolean } = {}
) => {
  const trigger = database
    .prepare(
      "select sql from sqlite_master where type = 'trigger' and name = ?"
    )
    .get(triggerName) as { readonly sql: string };
  database.exec(`drop trigger "${triggerName}"`);
  database.exec("pragma foreign_keys = off");
  if (options.ignoreChecks === true) {
    database.exec("pragma ignore_check_constraints = on");
  }
  database.exec(statement);
  database.exec("pragma ignore_check_constraints = off");
  database.exec(trigger.sql);
};

describe("organization-scoped user preference migration", () => {
  it("backfills populated default and null rows byte-for-byte from sealed cutover", async () => {
    const database = await makePopulated1027Database();
    try {
      database.exec(`
        insert into app_organization (id, created_at, updated_at)
        values ('unrelated', 2000, 2000);
        insert into app_user_preference
          (user_id, default_mailbox_id, settings_json, created_at, updated_at,
           version)
        values
          ('user-a', 'primary', '{"theme":"dark","n":1}', 1000, 1200, 7),
          ('user-b', null, '{ "density" : "compact" }', 1001, 1300, 3);
      `);
      const legacy = database
        .prepare("select * from app_user_preference order by user_id")
        .all()
        .map((row) => ({ ...row }));

      await applyControlPlaneMigration(database, migration);

      expect(preferenceRows(database)).toStrictEqual(
        legacy.map((row) => ({
          ...row,
          organization_id: "legacy_default_v1",
        }))
      );
      expect(
        database
          .prepare("select * from app_user_preference order by user_id")
          .all()
          .map((row) => ({ ...row }))
      ).toStrictEqual(legacy);
      expect({
        ...database
          .prepare("select * from app_user_organization_preference_cutover")
          .get(),
      }).toStrictEqual({
        bridge_effective_at: 1000,
        bridge_source: "legacy-cutover",
        id: 1,
        outcome: "legacy-primary",
        schema_version: 1,
        source_created_at: 1000,
        source_mailbox_id: "primary",
        source_organization_id: "legacy_default_v1",
      });
    } finally {
      database.close();
    }
  });

  it.each([
    [
      "organization",
      "app_organization_legacy_cutover_no_update",
      "update app_organization_legacy_cutover set organization_id = 'other' where id = 1",
      true,
    ],
    [
      "cutover timestamp",
      "app_organization_legacy_cutover_no_update",
      "update app_organization_legacy_cutover set source_created_at = 1001 where id = 1",
      false,
    ],
    [
      "bridge timestamp",
      "app_mailbox_legacy_organization_assignment_no_update",
      "update app_mailbox_legacy_organization_assignment set effective_at = 1001 where mailbox_id = 'primary'",
      false,
    ],
    [
      "bridge source",
      "app_mailbox_legacy_organization_assignment_no_update",
      "update app_mailbox_legacy_organization_assignment set source = 'fresh-bootstrap' where mailbox_id = 'primary'",
      false,
    ],
  ] as const)(
    "rejects tampered %s provenance even when the legacy default is null",
    async (_, trigger, statement, ignoreChecks) => {
      const database = await makePopulated1027Database();
      try {
        database.exec(`insert into app_user_preference
          (user_id, default_mailbox_id, settings_json, created_at, updated_at)
          values ('user-b', null, '{}', 1000, 1000)`);
        mutateSealedRow(database, trigger, statement, { ignoreChecks });
        const before = persistentState(database);
        await expect(
          applyControlPlaneMigration(database, migration)
        ).rejects.toThrow(/constraint/iu);
        expect(persistentState(database)).toStrictEqual(before);
        expect(
          database
            .prepare("select default_mailbox_id from app_user_preference")
            .get()
        ).toMatchObject({ default_mailbox_id: null });
      } finally {
        database.close();
      }
    }
  );

  it("records a fresh-empty cutover without creating a preference", async () => {
    const database = await makeFresh1027Database();
    try {
      await applyControlPlaneMigration(database, migration);
      expect(preferenceRows(database)).toStrictEqual([]);
      expect(
        database
          .prepare("select * from app_user_organization_preference_cutover")
          .get()
      ).toMatchObject({ outcome: "fresh-empty", source_organization_id: null });
    } finally {
      database.close();
    }
  });

  it("aborts fresh-empty plus any legacy preference atomically", async () => {
    const database = await makeFresh1027Database();
    try {
      database.exec(`
        insert into auth_user (id, created_at, updated_at)
        values ('user-a', 1000, 1000);
        insert into app_user_preference
          (user_id, settings_json, created_at, updated_at)
        values ('user-a', '{}', 1000, 1000);
      `);
      const before = persistentState(database);
      await expect(
        applyControlPlaneMigration(database, migration)
      ).rejects.toThrow(/constraint/iu);
      expect(persistentState(database)).toStrictEqual(before);
    } finally {
      database.close();
    }
  });

  it.each([
    ["orphan user", "delete from auth_user where id = 'user-b'"],
    [
      "missing default ancestry",
      "pragma foreign_keys = off; update app_user_preference set default_mailbox_id = 'missing' where user_id = 'user-b'",
    ],
    [
      "malformed settings",
      "pragma ignore_check_constraints = on; update app_user_preference set settings_json = '[]' where user_id = 'user-b'; pragma ignore_check_constraints = off",
    ],
    [
      "unsafe time",
      "pragma ignore_check_constraints = on; update app_user_preference set created_at = -1, updated_at = -1 where user_id = 'user-b'; pragma ignore_check_constraints = off",
    ],
    [
      "real version",
      "pragma ignore_check_constraints = on; update app_user_preference set version = 1.5 where user_id = 'user-b'; pragma ignore_check_constraints = off",
    ],
  ] as const)(
    "rejects %s without persistent mutation",
    async (_, corruption) => {
      const database = await makePopulated1027Database();
      try {
        database.exec(`insert into app_user_preference
        (user_id, settings_json, created_at, updated_at)
        values ('user-b', '{}', 1000, 1000)`);
        database.exec(corruption);
        const before = persistentState(database);
        await expect(
          applyControlPlaneMigration(database, migration)
        ).rejects.toThrow(/constraint/iu);
        expect(persistentState(database)).toStrictEqual(before);
      } finally {
        database.close();
      }
    }
  );

  it.each(["suspended", "deleted"] as const)(
    "retains a structurally valid %s default as dormant",
    async (status) => {
      const database = await makePopulated1027Database();
      try {
        database.exec(`insert into app_user_preference
          (user_id, default_mailbox_id, settings_json, created_at, updated_at)
          values ('user-b', 'primary', '{}', 1000, 1000)`);
        database.exec(`update app_mailbox set status = '${status}',
          deleted_at = ${status === "deleted" ? "1100" : "null"},
          updated_at = 1100, version = 2 where id = 'primary'`);
        await applyControlPlaneMigration(database, migration);
        expect(preferenceRows(database)[0]).toMatchObject({
          default_mailbox_id: "primary",
          user_id: "user-b",
        });
      } finally {
        database.close();
      }
    }
  );

  it("supports independent null preferences for users and organizations", async () => {
    const database = await makeFresh1027Database();
    try {
      await applyControlPlaneMigration(database, migration);
      insertFreshMailbox(database);
      database.exec(`
        insert into app_organization (id, created_at, updated_at)
        values ('organization-b', 1000, 1000);
        insert into app_user_organization_preference
          (organization_id, user_id, default_mailbox_id, settings_json,
           created_at, updated_at)
        values
          ('legacy_default_v1', 'user-a', null, '{}', 1000, 1000),
          ('legacy_default_v1', 'user-b', null, '{}', 1000, 1000),
          ('organization-b', 'user-a', null, '{}', 1000, 1000);
      `);
      expect(preferenceRows(database)).toHaveLength(3);
    } finally {
      database.close();
    }
  });

  it.each(["on", "off"] as const)(
    "checks parents and exact default ancestry with foreign keys %s",
    async (foreignKeys) => {
      const database = await makeFresh1027Database();
      try {
        await applyControlPlaneMigration(database, migration);
        insertFreshMailbox(database);
        database.exec(`insert into app_organization (id, created_at, updated_at)
          values ('organization-b', 1000, 1000)`);
        database.exec(`pragma foreign_keys = ${foreignKeys}`);
        for (const statement of [
          `insert into app_user_organization_preference
            (organization_id, user_id, settings_json, created_at, updated_at)
           values ('missing', 'user-a', '{}', 1000, 1000)`,
          `insert into app_user_organization_preference
            (organization_id, user_id, settings_json, created_at, updated_at)
           values ('legacy_default_v1', 'missing', '{}', 1000, 1000)`,
          `insert into app_user_organization_preference
            (organization_id, user_id, default_mailbox_id, settings_json,
             created_at, updated_at)
           values ('legacy_default_v1', 'user-a', 'missing', '{}', 1000, 1000)`,
          `insert into app_user_organization_preference
            (organization_id, user_id, default_mailbox_id, settings_json,
             created_at, updated_at)
           values ('organization-b', 'user-a', 'primary', '{}', 1000, 1000)`,
        ]) {
          expect(() => database.exec(statement)).toThrow(
            /preference|foreign key/iu
          );
        }
        expect(preferenceRows(database)).toStrictEqual([]);
      } finally {
        database.close();
      }
    }
  );

  it("rejects a cross-organization default update with foreign keys off", async () => {
    const database = await makeFresh1027Database();
    try {
      await applyControlPlaneMigration(database, migration);
      insertFreshMailbox(database);
      database.exec(`
        insert into app_organization (id, created_at, updated_at)
        values ('organization-b', 1000, 1000);
        insert into app_user_organization_preference
          (organization_id, user_id, settings_json, created_at, updated_at)
        values ('organization-b', 'user-a', '{}', 1000, 1000);
        pragma foreign_keys = off;
      `);
      const original = preferenceRows(database);
      expect(() =>
        database.exec(`update app_user_organization_preference
          set default_mailbox_id = 'primary', updated_at = 1100, version = 2
          where organization_id = 'organization-b' and user_id = 'user-a'`)
      ).toThrow(/ancestry/u);
      expect(preferenceRows(database)).toStrictEqual(original);
    } finally {
      database.close();
    }
  });

  it("accepts same-organization suspended and deleted defaults as dormant", async () => {
    const database = await makeFresh1027Database();
    try {
      await applyControlPlaneMigration(database, migration);
      insertFreshMailbox(database);
      database.exec(`
        update app_mailbox set status = 'suspended', updated_at = 1100,
          version = 2 where id = 'primary';
        insert into app_user_organization_preference
          (organization_id, user_id, default_mailbox_id, settings_json,
           created_at, updated_at)
        values ('legacy_default_v1', 'user-a', 'primary', '{}', 1000, 1000);
        update app_mailbox set status = 'deleted', deleted_at = 1200,
          updated_at = 1200, version = 3 where id = 'primary';
        update app_user_organization_preference
          set settings_json = '{"dormant":true}', updated_at = 1200,
              version = 2
          where organization_id = 'legacy_default_v1' and user_id = 'user-a';
        insert into app_user_organization_preference
          (organization_id, user_id, default_mailbox_id, settings_json,
           created_at, updated_at)
        values ('legacy_default_v1', 'user-b', 'primary', '{}', 1200, 1200);
      `);
      expect(preferenceRows(database)).toMatchObject([
        {
          default_mailbox_id: "primary",
          settings_json: '{"dormant":true}',
          user_id: "user-a",
          version: 2,
        },
        {
          default_mailbox_id: "primary",
          user_id: "user-b",
          version: 1,
        },
      ]);
    } finally {
      database.close();
    }
  });

  it("retains organization and mailbox parents with foreign keys off", async () => {
    const database = await makeFresh1027Database();
    try {
      await applyControlPlaneMigration(database, migration);
      insertFreshMailbox(database);
      database.exec(`insert into app_user_organization_preference
        (organization_id, user_id, default_mailbox_id, settings_json,
         created_at, updated_at)
        values ('legacy_default_v1', 'user-a', 'primary', '{}', 1000, 1000);
        pragma foreign_keys = off`);
      const original = preferenceRows(database);
      expect(() =>
        database.exec("delete from app_mailbox where id = 'primary'")
      ).toThrow(/retained/u);
      expect(() =>
        database.exec(
          "delete from app_organization where id = 'legacy_default_v1'"
        )
      ).toThrow(/retained/u);
      expect(preferenceRows(database)).toStrictEqual(original);
      expect(database.prepare("pragma foreign_key_check").all()).toStrictEqual(
        []
      );
    } finally {
      database.close();
    }
  });

  it("matches SQLite Unicode code-point length at the settings boundary", async () => {
    const database = await makeFresh1027Database();
    try {
      await applyControlPlaneMigration(database, migration);
      insertFreshMailbox(database);
      const accepted = `{"v":"${"😀".repeat(65_528)}"}`;
      const rejected = `{"v":"${"😀".repeat(65_529)}"}`;
      expect([...accepted]).toHaveLength(65_536);
      expect([...rejected]).toHaveLength(65_537);
      expect(() =>
        Schema.decodeUnknownSync(OrganizationPreferenceSettingsJson)(accepted)
      ).not.toThrow();
      expect(() =>
        Schema.decodeUnknownSync(OrganizationPreferenceSettingsJson)(rejected)
      ).toThrow(/65536 Unicode code points/u);
      database
        .prepare(
          `insert into app_user_organization_preference
            (organization_id, user_id, settings_json, created_at, updated_at)
           values ('legacy_default_v1', 'user-a', ?, 1000, 1000)`
        )
        .run(accepted);
      expect(
        database
          .prepare(
            "select length(settings_json) as length from app_user_organization_preference"
          )
          .get()
      ).toMatchObject({ length: 65_536 });
      expect(() =>
        database
          .prepare(`update app_user_organization_preference
            set settings_json = ?, updated_at = 1100, version = 2`)
          .run(rejected)
      ).toThrow(/constraint/u);
      expect(preferenceRows(database)[0]).toMatchObject({
        settings_json: accepted,
        version: 1,
      });
    } finally {
      database.close();
    }
  });

  it("enforces insert, update, identity, time, replacement, and delete contracts", async () => {
    const database = await makeFresh1027Database();
    try {
      await applyControlPlaneMigration(database, migration);
      insertFreshMailbox(database);
      database.exec(`insert into app_user_organization_preference
        (organization_id, user_id, default_mailbox_id, settings_json,
         created_at, updated_at)
        values ('legacy_default_v1', 'user-a', 'primary', '{}', 1000, 1000)`);
      database.exec(`update app_user_organization_preference
        set default_mailbox_id = null, settings_json = '{"theme":"dark"}',
            updated_at = 1100, version = 2`);
      const original = preferenceRows(database);
      database.exec("pragma recursive_triggers = off");
      for (const statement of [
        "update app_user_organization_preference set version = 4",
        "update app_user_organization_preference set updated_at = 999, version = 3",
        "update app_user_organization_preference set user_id = 'user-b', version = 3",
        "update app_user_organization_preference set created_at = 999, version = 3",
        "delete from app_user_organization_preference",
        `replace into app_user_organization_preference
          (organization_id, user_id, settings_json, created_at, updated_at)
         values ('legacy_default_v1', 'user-a', '{}', 2000, 2000)`,
        `insert into app_user_organization_preference
          (organization_id, user_id, settings_json, created_at, updated_at)
         values ('legacy_default_v1', 'user-a', '{}', 2000, 2000)
         on conflict do update set settings_json = excluded.settings_json`,
      ]) {
        expect(() => database.exec(statement)).toThrow(
          /immutable|invalid|retained/iu
        );
        expect(preferenceRows(database)).toStrictEqual(original);
      }
    } finally {
      database.close();
    }
  });

  it("freezes every legacy write form after exact backfill", async () => {
    const database = await makePopulated1027Database();
    try {
      database.exec(`insert into app_user_preference
        (user_id, settings_json, created_at, updated_at)
        values ('user-b', '{}', 1000, 1000)`);
      await applyControlPlaneMigration(database, migration);
      const original = database
        .prepare("select * from app_user_preference")
        .all();
      database.exec("pragma recursive_triggers = off");
      for (const statement of [
        "update app_user_preference set settings_json = '{}'",
        "delete from app_user_preference",
        `insert into app_user_preference
          (user_id, settings_json, created_at, updated_at)
         values ('user-a', '{}', 1000, 1000)`,
        `replace into app_user_preference
          (user_id, settings_json, created_at, updated_at)
         values ('user-b', '{}', 1000, 1000)`,
        `insert into app_user_preference
          (user_id, settings_json, created_at, updated_at)
         values ('user-b', '{}', 1000, 1000)
         on conflict do update set settings_json = excluded.settings_json`,
      ]) {
        expect(() => database.exec(statement)).toThrow(/frozen/u);
        expect(
          database.prepare("select * from app_user_preference").all()
        ).toStrictEqual(original);
      }
    } finally {
      database.close();
    }
  });

  it("is forward-only, does not heal, and fences predecessor reapplication", async () => {
    const database = await makeFresh1027Database();
    try {
      await applyControlPlaneMigration(database, migration);
      const before = persistentState(database);
      await expect(
        applyControlPlaneMigration(database, migration)
      ).rejects.toThrow(/constraint/iu);
      expect(persistentState(database)).toStrictEqual(before);
      await expect(
        applyControlPlaneMigration(
          database,
          "1027_app_mailbox_organization.sql"
        )
      ).rejects.toThrow(/constraint/iu);
      expect(persistentState(database)).toStrictEqual(before);

      database.exec("drop trigger app_user_organization_preference_no_delete");
      const corrupted = persistentState(database);
      await expect(
        applyControlPlaneMigration(database, migration)
      ).rejects.toThrow(/constraint/iu);
      expect(persistentState(database)).toStrictEqual(corrupted);
    } finally {
      database.close();
    }
  });

  it.each(["table", "index", "trigger", "glob-lookalike"] as const)(
    "rejects a preexisting %s collision before mutation",
    async (kind) => {
      const database = await makeFresh1027Database();
      try {
        if (kind === "table") {
          database.exec(
            "create table app_user_organization_preference (id text)"
          );
        } else if (kind === "index") {
          database.exec(`create index app_mailbox_organization_id_unique_idx
            on app_mailbox (id)`);
        } else if (kind === "trigger") {
          database.exec(`create trigger app_user_preference_frozen_insert
            before insert on app_user_preference begin select 1; end`);
        } else {
          database.exec(
            "create table app_user_organization_preference_lookalike (id text)"
          );
        }
        const before = persistentState(database);
        await expect(
          applyControlPlaneMigration(database, migration)
        ).rejects.toThrow(/constraint/iu);
        expect(persistentState(database)).toStrictEqual(before);
      } finally {
        database.close();
      }
    }
  );

  it("installs exact composite FK and indexes with clean integrity", async () => {
    const database = await makeFresh1027Database();
    try {
      await applyControlPlaneMigration(database, migration);
      const foreignKeys = database
        .prepare("pragma foreign_key_list('app_user_organization_preference')")
        .all() as readonly Record<string, unknown>[];
      const mailboxId = foreignKeys.find(
        (row) => row.table === "app_mailbox"
      )?.id;
      expect(
        foreignKeys
          .filter((row) => row.id === mailboxId)
          .map((row) => ({
            from: row.from,
            onDelete: row.on_delete,
            onUpdate: row.on_update,
            to: row.to,
          }))
      ).toStrictEqual([
        {
          from: "organization_id",
          onDelete: "RESTRICT",
          onUpdate: "RESTRICT",
          to: "organization_id",
        },
        {
          from: "default_mailbox_id",
          onDelete: "RESTRICT",
          onUpdate: "RESTRICT",
          to: "id",
        },
      ]);
      expect(
        database
          .prepare(
            `select name, "unique", partial from pragma_index_list('app_mailbox')
             where name = 'app_mailbox_organization_id_unique_idx'`
          )
          .get()
      ).toMatchObject({ partial: 0, unique: 1 });
      expect(database.prepare("pragma foreign_key_check").all()).toStrictEqual(
        []
      );
      expect(database.prepare("pragma integrity_check").all()).toMatchObject([
        { integrity_check: "ok" },
      ]);
    } finally {
      database.close();
    }
  });

  it("models the exact nonnull Drizzle contract and decodes its domain entity", async () => {
    const database = await makeFresh1027Database();
    try {
      await applyControlPlaneMigration(database, migration);
      insertFreshMailbox(database);
      database.exec(`insert into app_user_organization_preference
        (organization_id, user_id, default_mailbox_id, settings_json,
         created_at, updated_at)
        values ('legacy_default_v1', 'user-a', 'primary', '{"theme":"dark"}',
          1000, 1000)`);
      const config = getTableConfig(appUserOrganizationPreference);
      expect({
        columns: config.columns.map((column) => ({
          name: column.name,
          notNull: column.notNull,
        })),
        indexes: config.indexes.map((index) => index.config.name),
      }).toStrictEqual({
        columns: [
          { name: "organization_id", notNull: true },
          { name: "user_id", notNull: true },
          { name: "default_mailbox_id", notNull: false },
          { name: "settings_json", notNull: true },
          { name: "created_at", notNull: true },
          { name: "updated_at", notNull: true },
          { name: "version", notNull: true },
        ],
        indexes: [
          "app_user_organization_preference_user_idx",
          "app_user_organization_preference_default_idx",
        ],
      });
      expect(
        config.foreignKeys.map((key) => ({
          columns: key.reference().columns.map((column) => column.name),
          foreignColumns: key
            .reference()
            .foreignColumns.map((column) => column.name),
          foreignTable: getTableName(key.reference().foreignTable),
          onDelete: key.onDelete,
          onUpdate: key.onUpdate,
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
        {
          columns: ["organization_id", "default_mailbox_id"],
          foreignColumns: ["organization_id", "id"],
          foreignTable: "app_mailbox",
          onDelete: "restrict",
          onUpdate: "restrict",
        },
      ]);
      const persisted = database
        .prepare(
          `select organization_id as organizationId, user_id as userId,
                  default_mailbox_id as defaultMailboxId,
                  settings_json as settingsJson, created_at as createdAt,
                  updated_at as updatedAt, version
             from app_user_organization_preference`
        )
        .get();
      expect(
        Schema.decodeUnknownSync(UserOrganizationPreferenceSchema)(persisted)
      ).toMatchObject({
        defaultMailboxId: "primary",
        organizationId: "legacy_default_v1",
        settingsJson: '{"theme":"dark"}',
        userId: "user-a",
      });
    } finally {
      database.close();
    }
  });
});
