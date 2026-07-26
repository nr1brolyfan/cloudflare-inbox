/* oxlint-disable vitest/max-expects -- Each case verifies an atomic migration/storage state. */
import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import {
  applyControlPlaneMigration,
  applyControlPlaneMigrations,
  applyControlPlaneMigrationsThrough,
  makeTestD1Database,
} from "../../support/d1";

const migration = "1024_app_mailbox_legacy_organization_assignment.sql";

const setDefensiveMode = (database: DatabaseSync, active: boolean): void => {
  const { enableDefensive } = database as DatabaseSync & {
    enableDefensive?: (active: boolean) => void;
  };
  enableDefensive?.call(database, active);
};

const make1022Database = async () => {
  const database = new DatabaseSync(":memory:");
  await applyControlPlaneMigrationsThrough(
    database,
    "1022_app_mailbox_bootstrap_receipt_v2.sql"
  );
  return database;
};

const makeFresh1023Database = async () => {
  const database = await make1022Database();
  await applyControlPlaneMigration(
    database,
    "1023_app_organization_legacy_cutover.sql"
  );
  return database;
};

const insertMailbox = (
  database: DatabaseSync,
  createdAt: number | string = 1000,
  id = "primary"
) =>
  database
    .prepare(
      `insert into app_mailbox
        (id, display_name, status, created_by_user_id, created_at, updated_at,
         version)
       values (?, 'Inbox', 'active', 'user-a', ?, ?, 1)`
    )
    .run(id, createdAt, createdAt);

const insertReservedOrganization = (
  database: DatabaseSync,
  createdAt: number | string = 1000
) =>
  database
    .prepare(
      `insert into app_organization (id, created_at, updated_at)
       values ('legacy_default_v1', ?, ?)`
    )
    .run(createdAt, createdAt);

const insertFreshPair = (database: DatabaseSync, createdAt = 1000) => {
  insertReservedOrganization(database, createdAt);
  insertMailbox(database, createdAt);
};

const assignmentRows = (database: DatabaseSync) =>
  database
    .prepare(
      "select * from app_mailbox_legacy_organization_assignment order by mailbox_id"
    )
    .all()
    .map((row) => ({ ...row }));

const sentinelRows = (database: DatabaseSync) =>
  database
    .prepare(
      "select * from app_mailbox_legacy_organization_assignment_cutover order by id"
    )
    .all()
    .map((row) => ({ ...row }));

const integrityState = (database: DatabaseSync) => ({
  foreignKeys: database.prepare("pragma foreign_key_check").all(),
  integrity: database
    .prepare("pragma integrity_check")
    .all()
    .map((row) => ({ ...row })),
});

const countRows = (database: DatabaseSync, table: string) =>
  (
    database.prepare(`select count(*) as count from "${table}"`).get() as {
      readonly count: number;
    }
  ).count;

describe("mailbox legacy organization assignment migration", () => {
  it("upgrades a real legacy snapshot without changing mailbox identity or authority", async () => {
    const database = await make1022Database();
    try {
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
        insert into auth_role_grant
          (subject_type, subject_id, role_id, scope_type, scope_id_present,
           scope_id)
        values ('user', 'user-a', 'owner', 'mailbox', 1, 'primary');
      `);
      await applyControlPlaneMigration(
        database,
        "1023_app_organization_legacy_cutover.sql"
      );
      const authorityBefore = {
        grants: database.prepare("select * from auth_role_grant").all(),
        mailbox: database.prepare("select * from app_mailbox").all(),
        members: database.prepare("select * from app_mailbox_member").all(),
      };

      await applyControlPlaneMigration(database, migration);
      await applyControlPlaneMigration(database, migration);

      expect({
        grants: database.prepare("select * from auth_role_grant").all(),
        mailbox: database.prepare("select * from app_mailbox").all(),
        members: database.prepare("select * from app_mailbox_member").all(),
      }).toStrictEqual(authorityBefore);
      expect(assignmentRows(database)).toStrictEqual([
        {
          effective_at: 1234,
          mailbox_id: "primary",
          organization_id: "legacy_default_v1",
          schema_version: 1,
          source: "legacy-cutover",
        },
      ]);
      expect(sentinelRows(database)).toStrictEqual([
        { id: 1, schema_version: 1 },
      ]);
      expect(
        database
          .prepare("select name from pragma_table_xinfo('app_mailbox')")
          .all()
      ).not.toContainEqual({ name: "organization_id" });
      expect(integrityState(database)).toStrictEqual({
        foreignKeys: [],
        integrity: [{ integrity_check: "ok" }],
      });
    } finally {
      database.close();
    }
  });

  it("records only the sentinel for an exact fresh-empty cutover", async () => {
    const database = await makeFresh1023Database();
    try {
      await applyControlPlaneMigration(database, migration);
      await applyControlPlaneMigration(database, migration);

      expect(assignmentRows(database)).toStrictEqual([]);
      expect(sentinelRows(database)).toStrictEqual([
        { id: 1, schema_version: 1 },
      ]);
      expect(() =>
        database.exec(`insert into app_mailbox_legacy_organization_assignment
          values ('primary', 'legacy_default_v1', 1000, 'fresh-bootstrap', 1)`)
      ).toThrow("invalid fresh mailbox legacy organization ancestry");
      expect(countRows(database, "app_organization")).toBe(0);
      expect(countRows(database, "app_mailbox")).toBe(0);
    } finally {
      database.close();
    }
  });

  it("backfills the exact reserved pair created before 1024", async () => {
    const database = await makeFresh1023Database();
    try {
      insertFreshPair(database);

      await applyControlPlaneMigration(database, migration);

      expect(assignmentRows(database)).toStrictEqual([
        {
          effective_at: 1000,
          mailbox_id: "primary",
          organization_id: "legacy_default_v1",
          schema_version: 1,
          source: "fresh-bootstrap",
        },
      ]);
    } finally {
      database.close();
    }
  });

  it.each([
    "organization-only",
    "mailbox-only",
    "timestamp-mismatch",
    "unrelated-organization",
    "additional-organization",
    "additional-mailbox",
    "advanced-fresh-pair",
  ] as const)(
    "atomically rejects first-application state: %s",
    async (state) => {
      const database = await makeFresh1023Database();
      try {
        if (state === "organization-only") {
          insertReservedOrganization(database);
        } else if (state === "mailbox-only") {
          database.exec(
            "drop trigger app_organization_fresh_mailbox_insert_guard"
          );
          insertMailbox(database);
        } else if (state === "timestamp-mismatch") {
          insertReservedOrganization(database);
          database.exec(
            "drop trigger app_organization_fresh_mailbox_insert_guard"
          );
          insertMailbox(database, 1001);
        } else if (state === "unrelated-organization") {
          database.exec(`insert into app_organization
          (id, created_at, updated_at) values ('organization-a', 1000, 1000)`);
        } else if (state === "additional-organization") {
          insertFreshPair(database);
          database.exec(`insert into app_organization
          (id, created_at, updated_at) values ('organization-a', 1000, 1000)`);
        } else if (state === "additional-mailbox") {
          insertFreshPair(database);
          database.exec(`
          drop index app_mailbox_singleton_idx;
          drop trigger app_organization_fresh_mailbox_insert_guard;
          `);
          insertMailbox(database, 1001, "secondary");
        } else {
          insertFreshPair(database);
          database.exec(`
            update app_organization
               set status = 'suspended', updated_at = 2000, version = 2;
            update app_mailbox
               set status = 'suspended', updated_at = 2000, version = 2;
          `);
        }

        await expect(
          applyControlPlaneMigration(database, migration)
        ).rejects.toThrow(/constraint/u);
        expect(
          database
            .prepare(
              `select count(*) as count from sqlite_master
              where type = 'table'
                and name like 'app_mailbox_legacy_organization_assignment%'`
            )
            .get()
        ).toMatchObject({ count: 0 });
      } finally {
        database.close();
      }
    }
  );

  it.each([
    ["unsafe", 9_007_199_254_740_992],
    ["real", 1.5],
    ["text", "timestamp"],
  ] as const)(
    "rejects a %s fresh timestamp before materialization",
    async (_, timestamp) => {
      const database = await makeFresh1023Database();
      try {
        database.exec("pragma ignore_check_constraints = on");
        insertReservedOrganization(database, timestamp);
        database.exec(
          "drop trigger app_organization_fresh_mailbox_insert_guard"
        );
        insertMailbox(database, timestamp);
        database.exec("pragma ignore_check_constraints = off");

        await expect(
          applyControlPlaneMigration(database, migration)
        ).rejects.toThrow(/constraint/u);
      } finally {
        database.close();
      }
    }
  );

  it("materializes ancestry for a post-ORG-006 old writer without a new statement", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      insertReservedOrganization(database);
      insertMailbox(database);

      expect(assignmentRows(database)).toStrictEqual([
        {
          effective_at: 1000,
          mailbox_id: "primary",
          organization_id: "legacy_default_v1",
          schema_version: 1,
          source: "fresh-bootstrap",
        },
      ]);
    } finally {
      database.close();
    }
  });

  it("rolls back organization, mailbox, and materialized ancestry when a later batch statement fails", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      const d1 = makeTestD1Database(database);

      await expect(
        d1.batch([
          d1.prepare(`insert into app_organization
            (id, created_at, updated_at)
            values ('legacy_default_v1', 1000, 1000)`),
          d1.prepare(`insert into app_mailbox
            (id, display_name, status, created_by_user_id, created_at,
             updated_at, version)
            values ('primary', 'Inbox', 'active', 'user-a', 1000, 1000, 1)`),
          d1.prepare("insert into app_mailbox (id) values ('invalid')"),
        ])
      ).rejects.toThrow(/constraint|failed|reserved legacy organization/u);

      expect({
        auditEvents: countRows(database, "app_administrative_audit_event"),
        assignments: assignmentRows(database),
        grants: countRows(database, "auth_role_grant"),
        mailboxes: countRows(database, "app_mailbox"),
        members: countRows(database, "app_mailbox_member"),
        organizations: countRows(database, "app_organization"),
      }).toStrictEqual({
        assignments: [],
        auditEvents: 0,
        grants: 0,
        mailboxes: 0,
        members: 0,
        organizations: 0,
      });
    } finally {
      database.close();
    }
  });

  it("rejects malformed fresh mailbox insertion and leaves the exact empty state", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      insertReservedOrganization(database, 1000);

      expect(() => insertMailbox(database, 1001)).toThrow(
        /reserved legacy organization|ancestry/u
      );
      expect(assignmentRows(database)).toStrictEqual([]);
      expect(countRows(database, "app_mailbox")).toBe(0);
    } finally {
      database.close();
    }
  });

  it("accepts parent lifecycle changes on reapply without changing ancestry", async () => {
    const database = await makeFresh1023Database();
    try {
      insertFreshPair(database);
      await applyControlPlaneMigration(database, migration);
      const ancestry = assignmentRows(database);
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

      expect(assignmentRows(database)).toStrictEqual(ancestry);
      expect(
        database.prepare("select status, version from app_mailbox").get()
      ).toMatchObject({ status: "suspended", version: 2 });
    } finally {
      database.close();
    }
  });

  it.each(["missing", "changed"] as const)(
    "never repairs a %s assignment after its mailbox exists",
    async (corruption) => {
      const database = await makeFresh1023Database();
      try {
        insertFreshPair(database);
        await applyControlPlaneMigration(database, migration);
        if (corruption === "missing") {
          database.exec(
            "drop trigger app_mailbox_legacy_organization_assignment_no_delete"
          );
          database.exec(
            "delete from app_mailbox_legacy_organization_assignment"
          );
        } else {
          database.exec(
            "drop trigger app_mailbox_legacy_organization_assignment_no_update"
          );
          database.exec(
            `update app_mailbox_legacy_organization_assignment
                set source = 'legacy-cutover'`
          );
        }

        await expect(
          applyControlPlaneMigration(database, migration)
        ).rejects.toThrow(/constraint/u);
        expect(assignmentRows(database)).toHaveLength(
          corruption === "missing" ? 0 : 1
        );
      } finally {
        database.close();
      }
    }
  );

  it("repairs an owned trigger-name no-op collision on a valid reapply", async () => {
    const database = await makeFresh1023Database();
    try {
      await applyControlPlaneMigration(database, migration);
      database.exec(`
        drop trigger app_mailbox_legacy_organization_assignment_cutover_no_update;
        create trigger app_mailbox_legacy_organization_assignment_cutover_no_update
        before update on app_mailbox_legacy_organization_assignment_cutover
        begin select 1; end;
      `);

      await applyControlPlaneMigration(database, migration);

      expect(() =>
        database.exec(`update app_mailbox_legacy_organization_assignment_cutover
                          set schema_version = 1`)
      ).toThrow("legacy organization ancestry cutover is immutable");
    } finally {
      database.close();
    }
  });

  it.each([
    {
      definition: `before insert on app_organization_legacy_cutover when 0
        begin select raise(abort, 'organization legacy cutover is sealed'); end`,
      name: "app_organization_legacy_cutover_no_insert",
    },
    {
      definition: `before update on app_organization_legacy_cutover when 0
        begin select raise(abort, 'organization legacy cutover is immutable'); end`,
      name: "app_organization_legacy_cutover_no_update",
    },
    {
      definition: `before delete on app_organization_legacy_cutover when 0
        begin select raise(abort, 'organization legacy cutover is retained'); end`,
      name: "app_organization_legacy_cutover_no_delete",
    },
    {
      definition: `before insert on app_mailbox when 0
        begin select raise(abort, 'fresh mailbox requires its reserved legacy organization'); end`,
      name: "app_organization_fresh_mailbox_insert_guard",
    },
    {
      definition: `before update of id, created_at on app_mailbox when 0
        begin select raise(abort, 'organization mailbox creation provenance is immutable'); end`,
      name: "app_organization_mailbox_creation_provenance",
    },
    {
      definition: `before insert on app_mailbox when 0
        begin select raise(abort, 'organization primary mailbox replacement is forbidden'); end`,
      name: "app_organization_primary_mailbox_no_replace",
    },
    {
      definition: `before delete on app_mailbox when 0
        begin select raise(abort, 'organization primary mailbox is retained'); end`,
      name: "app_organization_primary_mailbox_no_delete",
    },
  ] as const)(
    "rejects ORG-006 lookalike trigger $name despite matching ownership and error",
    async ({ definition, name }) => {
      const database = await makeFresh1023Database();
      try {
        database.exec(`drop trigger "${name}"`);
        database.exec(`create trigger "${name}" ${definition}`);

        await expect(
          applyControlPlaneMigration(database, migration)
        ).rejects.toThrow(/constraint/u);
        expect(
          database
            .prepare(
              `select count(*) as count from sqlite_master
                where type = 'table'
                  and name like 'app_mailbox_legacy_organization_assignment%'`
            )
            .get()
        ).toMatchObject({ count: 0 });
      } finally {
        database.close();
      }
    }
  );

  it.each([
    {
      replacement: "'LEGACY-PRIMARY'",
      target: "'legacy-primary'",
      variant: "literal case",
    },
    {
      replacement: "'organization  mailbox creation provenance is immutable'",
      target: "'organization mailbox creation provenance is immutable'",
      variant: "literal whitespace",
    },
  ] as const)(
    "rejects an ORG-006 creation-provenance trigger with changed $variant",
    async ({ replacement, target }) => {
      const database = await makeFresh1023Database();
      try {
        const name = "app_organization_mailbox_creation_provenance";
        const original = database
          .prepare(
            "select sql from sqlite_master where type = 'trigger' and name = ?"
          )
          .get(name) as { readonly sql: string };
        database.exec(`drop trigger "${name}"`);
        database.exec(original.sql.replace(target, replacement));

        await expect(
          applyControlPlaneMigration(database, migration)
        ).rejects.toThrow(/constraint/u);
        expect(
          database
            .prepare(
              `select count(*) as count from sqlite_master
                where type = 'table'
                  and name like 'app_mailbox_legacy_organization_assignment%'`
            )
            .get()
        ).toMatchObject({ count: 0 });
      } finally {
        database.close();
      }
    }
  );

  it.each(["missing", "literal-case", "lookalike"] as const)(
    "rejects and preserves a %s organization identity trigger dependency",
    async (state) => {
      const database = await makeFresh1023Database();
      try {
        const name = "app_organization_identity_immutable";
        const original = database
          .prepare(
            "select sql from sqlite_master where type = 'trigger' and name = ?"
          )
          .get(name) as { readonly sql: string };
        database.exec(`drop trigger "${name}"`);
        if (state === "literal-case") {
          database.exec(
            original.sql.replace(
              "'organization identity and creation time are immutable'",
              "'Organization identity and creation time are immutable'"
            )
          );
        } else if (state === "lookalike") {
          database.exec(`create trigger app_organization_identity_immutable
            before update of id, created_at on app_organization
            when 0
            begin
              select raise(abort,
                'organization identity and creation time are immutable');
            end`);
        }
        const dependencyBefore = database
          .prepare(
            "select sql from sqlite_master where type = 'trigger' and name = ?"
          )
          .get(name) as { readonly sql: string } | undefined;
        const cutoverBefore = database
          .prepare("select * from app_organization_legacy_cutover")
          .all()
          .map((row) => ({ ...row }));

        await expect(
          applyControlPlaneMigration(database, migration)
        ).rejects.toThrow(/constraint/u);

        expect(
          database
            .prepare(
              "select sql from sqlite_master where type = 'trigger' and name = ?"
            )
            .get(name)
        ).toStrictEqual(dependencyBefore);
        expect(
          database
            .prepare("select * from app_organization_legacy_cutover")
            .all()
            .map((row) => ({ ...row }))
        ).toStrictEqual(cutoverBefore);
        expect(
          database
            .prepare(
              `select count(*) as count from sqlite_master
                where type = 'table'
                  and name like 'app_mailbox_legacy_organization_assignment%'`
            )
            .get()
        ).toMatchObject({ count: 0 });
      } finally {
        database.close();
      }
    }
  );

  it.each(["legacy", "fresh"] as const)(
    "keeps organization creation time equal to retained %s ancestry",
    async (source) => {
      const database = await make1022Database();
      try {
        if (source === "legacy") {
          insertMailbox(database);
          await applyControlPlaneMigration(
            database,
            "1023_app_organization_legacy_cutover.sql"
          );
          await applyControlPlaneMigration(database, migration);
        } else {
          await applyControlPlaneMigration(
            database,
            "1023_app_organization_legacy_cutover.sql"
          );
          await applyControlPlaneMigration(database, migration);
          insertFreshPair(database);
        }

        expect(() =>
          database.exec(`update app_organization
                            set created_at = 999
                          where id = 'legacy_default_v1'`)
        ).toThrow("organization identity and creation time are immutable");
        expect(
          database
            .prepare(
              `select organization.created_at, assignment.effective_at
                 from app_organization as organization
                 join app_mailbox_legacy_organization_assignment as assignment
                   on assignment.organization_id = organization.id`
            )
            .all()
            .map((row) => ({ ...row }))
        ).toStrictEqual([{ created_at: 1000, effective_at: 1000 }]);
      } finally {
        database.close();
      }
    }
  );

  it("preserves an initial reserved-name trigger collision on an unrelated table", async () => {
    const database = await makeFresh1023Database();
    try {
      database.exec(`
        create table unrelated_trigger_target (id integer);
        create trigger app_mailbox_legacy_organization_assignment_binding
        before insert on unrelated_trigger_target begin select 1; end;
      `);
      const collision = database
        .prepare(
          `select tbl_name, sql from sqlite_master
            where type = 'trigger'
              and name = 'app_mailbox_legacy_organization_assignment_binding'`
        )
        .get();

      await expect(
        applyControlPlaneMigration(database, migration)
      ).rejects.toThrow(/constraint/u);

      expect(
        database
          .prepare(
            `select tbl_name, sql from sqlite_master
              where type = 'trigger'
                and name = 'app_mailbox_legacy_organization_assignment_binding'`
          )
          .get()
      ).toStrictEqual(collision);
      expect(
        database
          .prepare(
            `select count(*) as count from sqlite_master
              where type = 'table'
                and name like 'app_mailbox_legacy_organization_assignment%'`
          )
          .get()
      ).toMatchObject({ count: 0 });
    } finally {
      database.close();
    }
  });

  it.each(["missing", "partial-lookalike"] as const)(
    "rejects a %s first-release mailbox singleton index",
    async (state) => {
      const database = await makeFresh1023Database();
      try {
        database.exec("drop index app_mailbox_singleton_idx");
        if (state === "partial-lookalike") {
          database.exec(`create unique index app_mailbox_singleton_idx
            on app_mailbox ((1)) where status = 'active'`);
        }

        await expect(
          applyControlPlaneMigration(database, migration)
        ).rejects.toThrow(/constraint/u);
      } finally {
        database.close();
      }
    }
  );

  it("keeps a secondary mailbox from appearing without ancestry", async () => {
    const database = await make1022Database();
    try {
      insertMailbox(database);
      await applyControlPlaneMigration(
        database,
        "1023_app_organization_legacy_cutover.sql"
      );
      await applyControlPlaneMigration(database, migration);

      expect(() => insertMailbox(database, 1001, "secondary")).toThrow(
        /app_mailbox_singleton_idx|unique constraint/u
      );
      expect(countRows(database, "app_mailbox")).toBe(1);
      expect(assignmentRows(database)).toHaveLength(1);
    } finally {
      database.close();
    }
  });

  it("rejects a structurally similar table whose expected CHECK is only a comment", async () => {
    const database = await makeFresh1023Database();
    try {
      database.exec(`
        create table app_mailbox_legacy_organization_assignment (
          mailbox_id text not null primary key,
          organization_id text not null,
          effective_at integer not null,
          source text not null,
          schema_version integer not null,
          constraint app_mailbox_legacy_organization_assignment_mailbox_fk
            foreign key (mailbox_id) references app_mailbox (id)
              on update restrict on delete restrict,
          constraint app_mailbox_legacy_organization_assignment_organization_fk
            foreign key (organization_id) references app_organization (id)
              on update restrict on delete restrict,
          constraint app_mailbox_legacy_organization_assignment_mailbox_check
            check (1 /* typeof(mailbox_id) = 'text' and mailbox_id = 'primary' */),
          constraint app_mailbox_legacy_organization_assignment_organization_check
            check (typeof(organization_id) = 'text'
              and organization_id = 'legacy_default_v1'),
          constraint app_mailbox_legacy_organization_assignment_effective_check
            check (typeof(effective_at) = 'integer'
              and effective_at between 0 and 9007199254740991),
          constraint app_mailbox_legacy_organization_assignment_source_check
            check (typeof(source) = 'text'
              and source in ('legacy-cutover', 'fresh-bootstrap')),
          constraint app_mailbox_legacy_organization_assignment_schema_check
            check (typeof(schema_version) = 'integer' and schema_version = 1)
        );
        create table app_mailbox_legacy_organization_assignment_cutover (
          id integer primary key,
          schema_version integer not null,
          constraint app_mailbox_legacy_organization_assignment_cutover_id_check
            check (id = 1),
          constraint app_mailbox_legacy_organization_assignment_cutover_schema_check
            check (typeof(schema_version) = 'integer' and schema_version = 1)
        );
      `);

      await expect(
        applyControlPlaneMigration(database, migration)
      ).rejects.toThrow(/constraint/u);
      expect(
        database
          .prepare(
            `select sql from sqlite_master
              where type = 'table'
                and name = 'app_mailbox_legacy_organization_assignment'`
          )
          .get()
      ).toMatchObject({ sql: expect.stringContaining("check (1 /*") });
    } finally {
      database.close();
    }
  });

  it.each([
    {
      replacement: "mailbox_id = 'PRIMARY'",
      table: "app_mailbox_legacy_organization_assignment",
      target: "mailbox_id = 'primary'",
      variant: "mailbox quoted-literal case",
    },
    {
      replacement: "check (id = 01)",
      table: "app_mailbox_legacy_organization_assignment_cutover",
      target: "check (id = 1)",
      variant: "sentinel numeric-literal spelling",
    },
  ] as const)(
    "rejects changed ORG-007 table DDL $variant",
    async ({ replacement, table, target }) => {
      const database = new DatabaseSync(":memory:");
      try {
        await applyControlPlaneMigrations(database);
        setDefensiveMode(database, false);
        database.exec("pragma writable_schema = on");
        database
          .prepare(
            `update sqlite_master
                set sql = replace(sql, ?, ?)
              where type = 'table' and name = ?`
          )
          .run(target, replacement, table);
        database.exec("pragma writable_schema = off");
        setDefensiveMode(database, true);

        expect(
          database
            .prepare(
              "select sql from sqlite_master where type = 'table' and name = ?"
            )
            .get(table)
        ).toMatchObject({ sql: expect.stringContaining(replacement) });
        await expect(
          applyControlPlaneMigration(database, migration)
        ).rejects.toThrow(/constraint/u);
      } finally {
        database.close();
      }
    }
  );

  it.each(["organization-column", "successor-marker"] as const)(
    "refuses %s handoff without recreating the retired materializer",
    async (handoff) => {
      const database = new DatabaseSync(":memory:");
      try {
        await applyControlPlaneMigrations(database);
        if (handoff === "successor-marker") {
          database.exec(`create table app_mailbox_organization_cutover (
            id integer primary key check (id = 1)
          )`);
        }

        await expect(
          applyControlPlaneMigration(database, migration)
        ).rejects.toThrow(/constraint/u);
        expect(
          database
            .prepare(
              `select 1 from sqlite_master
                where type = 'trigger'
                  and name = 'app_mailbox_legacy_organization_assignment_from_fresh_mailbox'`
            )
            .get()
        ).toBeUndefined();
      } finally {
        database.close();
      }
    }
  );

  it.each(["table", "index", "trigger"] as const)(
    "rejects an unknown or malformed %s collision atomically",
    async (collision) => {
      const database = await makeFresh1023Database();
      try {
        const collisionName =
          collision === "table"
            ? "app_mailbox_legacy_organization_assignment"
            : collision === "index"
              ? "ancestry_unknown_idx"
              : "ancestry_unknown_trigger";
        if (collision === "table") {
          database.exec(`create table app_mailbox_legacy_organization_assignment (
            mailbox_id text primary key, organization_id text, effective_at integer,
            source text, schema_version integer
          )`);
        } else {
          await applyControlPlaneMigration(database, migration);
          if (collision === "index") {
            database.exec(`create index ancestry_unknown_idx
              on app_mailbox_legacy_organization_assignment (organization_id)`);
          } else {
            database.exec(`create trigger ancestry_unknown_trigger
              before update on app_mailbox_legacy_organization_assignment
              begin select 1; end`);
          }
        }

        await expect(
          applyControlPlaneMigration(database, migration)
        ).rejects.toThrow(/constraint/u);
        expect(
          database
            .prepare("select 1 from sqlite_master where name = ?")
            .get(collisionName)
        ).toBeDefined();
      } finally {
        database.close();
      }
    }
  );

  it("seals assignment and sentinel before conflict handling with recursive triggers off", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      insertFreshPair(database);
      const ancestry = assignmentRows(database);
      database.exec("pragma recursive_triggers = off");

      for (const statement of [
        `update app_mailbox_legacy_organization_assignment
            set effective_at = effective_at`,
        "delete from app_mailbox_legacy_organization_assignment",
        `insert or replace into app_mailbox_legacy_organization_assignment
         values ('primary', 'legacy_default_v1', 1000, 'fresh-bootstrap', 1)`,
        `insert into app_mailbox_legacy_organization_assignment
         values ('primary', 'legacy_default_v1', 1000, 'fresh-bootstrap', 1)
         on conflict(mailbox_id) do nothing`,
        `insert into app_mailbox_legacy_organization_assignment
         values ('primary', 'legacy_default_v1', 1000, 'fresh-bootstrap', 1)
         on conflict(mailbox_id) do update set effective_at = excluded.effective_at`,
      ]) {
        expect(() => database.exec(statement)).toThrow(/ancestry|immutable/u);
      }
      for (const statement of [
        `update app_mailbox_legacy_organization_assignment_cutover
            set schema_version = schema_version`,
        "delete from app_mailbox_legacy_organization_assignment_cutover",
        `insert or replace into app_mailbox_legacy_organization_assignment_cutover
         values (1, 1)`,
        `insert into app_mailbox_legacy_organization_assignment_cutover values (1, 1)
         on conflict(id) do nothing`,
      ]) {
        expect(() => database.exec(statement)).toThrow(
          /sealed|immutable|retained/u
        );
      }

      expect(assignmentRows(database)).toStrictEqual(ancestry);
      expect(integrityState(database)).toStrictEqual({
        foreignKeys: [],
        integrity: [{ integrity_check: "ok" }],
      });
    } finally {
      database.close();
    }
  });

  it("has only the mailbox primary-key index and restrictive parent foreign keys", async () => {
    const database = await makeFresh1023Database();
    try {
      insertFreshPair(database);
      await applyControlPlaneMigration(database, migration);

      expect(
        database
          .prepare(
            `select "table", "from", "to", on_update, on_delete
               from pragma_foreign_key_list(
                 'app_mailbox_legacy_organization_assignment')
              order by "table"`
          )
          .all()
          .map((row) => ({ ...row }))
      ).toStrictEqual([
        {
          from: "mailbox_id",
          on_delete: "RESTRICT",
          on_update: "RESTRICT",
          table: "app_mailbox",
          to: "id",
        },
        {
          from: "organization_id",
          on_delete: "RESTRICT",
          on_update: "RESTRICT",
          table: "app_organization",
          to: "id",
        },
      ]);
      expect(
        database
          .prepare(
            `select "unique", origin, partial
               from pragma_index_list(
                 'app_mailbox_legacy_organization_assignment')`
          )
          .all()
          .map((row) => ({ ...row }))
      ).toStrictEqual([{ origin: "pk", partial: 0, unique: 1 }]);
    } finally {
      database.close();
    }
  });
});
