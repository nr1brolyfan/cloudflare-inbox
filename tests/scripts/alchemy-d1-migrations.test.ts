import { createHash } from "node:crypto";
import { globSync, readFileSync } from "node:fs";
import path from "node:path";
/* oxlint-disable unicorn/no-array-sort, vitest/max-expects -- Migration order and end-state evidence form one rehearsal. */
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";

import {
  compileD1ImportSql,
  rebalanceSqlBooleanExpression,
  splitSqlStatements,
} from "../../node_modules/alchemy/src/Cloudflare/D1/ApplyMigrations";
import {
  d1ImportUploadTimeoutMillis,
  nextImportBookmark,
  pollD1Import,
  resolveImportInit,
} from "../../node_modules/alchemy/src/Cloudflare/D1/ImportDatabase";

const root = fileURLToPath(new URL("../..", import.meta.url));
const migrationFiles = () =>
  globSync("migrations/control-plane/*.sql", { cwd: root }).sort();

const createLedger = (database: DatabaseSync) =>
  database.exec(`create table d1_migrations (
    id text primary key,
    name text not null,
    applied_at text not null
  )`);

const schemaSql = (database: DatabaseSync) =>
  database
    .prepare(
      "select type,name,tbl_name,sql from sqlite_schema order by type,name"
    )
    .all();

const maximumParenthesisDepth = (sql: string) => {
  let depth = 0;
  let maximum = 0;
  for (const character of sql) {
    if (character === "(") {
      depth += 1;
      maximum = Math.max(maximum, depth);
    } else if (character === ")") {
      depth -= 1;
    }
  }
  expect(depth).toBe(0);
  return maximum;
};

const applySqlBatch = (
  database: DatabaseSync,
  source: string,
  name: string,
  sequence: number,
  compileForD1 = false
) => {
  const migrationSql = compileForD1 ? compileD1ImportSql(source, name) : source;
  const payload = [
    migrationSql,
    `insert into d1_migrations (id,name,applied_at) values ('${sequence.toString().padStart(5, "0")}','${name}',datetime('now'));`,
  ].join("\n");
  database.exec("begin immediate");
  try {
    database.exec(payload);
    database.exec("commit");
  } catch (error) {
    database.exec("rollback");
    throw error;
  }
};

const applyMigrationBatch = (
  database: DatabaseSync,
  file: string,
  sequence: number,
  compileForD1 = false
) =>
  applySqlBatch(
    database,
    readFileSync(path.join(root, file), "utf-8"),
    path.basename(file),
    sequence,
    compileForD1
  );

const makeLegacy1024Database = (history: "none" | "receipt") => {
  const database = new DatabaseSync(":memory:");
  const files = migrationFiles();
  createLedger(database);
  const bootstrapIndex = files.findIndex(
    (file) =>
      path.basename(file) === "1022_app_mailbox_bootstrap_receipt_v2.sql"
  );
  if (bootstrapIndex === -1) {
    throw new Error("Missing bootstrap receipt migration fixture");
  }
  for (const [index, file] of files.entries()) {
    applyMigrationBatch(database, file, index + 1);
    if (index === bootstrapIndex) {
      break;
    }
  }
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
       scope_id, expires_at, metadata, revoked_at)
    values ('user', 'user-a', 'owner', 'mailbox', 1, 'primary', null, null,
            null);`);
  if (history === "receipt") {
    database.exec(`
      insert into app_mailbox_administration_receipt
        (operation_id, operation_kind, actor_user_id, mailbox_id, display_name,
         expected_version, result_mailbox_id, result_display_name,
         result_status, result_created_by_user_id, result_created_at,
         result_updated_at, result_version, committed_at, schema_version)
      values ('00000000-0000-4000-8000-000000000010', 'bootstrap-owner',
        'user-a', 'primary', 'Inbox', null, 'primary', 'Inbox', 'active',
        'user-a', 1000, 1000, 1, 1000, 1);
      insert into app_administrative_audit_event
        (event_id, schema_version, event_version, operation_id, action, outcome,
         actor_type, actor_id, tenant_scope_type, tenant_scope_id,
         resource_type, resource_id, request_id, correlation_id, reason_code,
         change_type, resource_version_before, resource_version_after,
         occurred_at)
      values ('admin-audit-sha256:${"a".repeat(64)}', 1, 1,
        '00000000-0000-4000-8000-000000000010', 'mailbox.owner-bootstrap',
        'succeeded', 'user', 'user-a', 'legacy-mailbox', 'primary', 'mailbox',
        'primary', null, null, 'owner-bootstrap', 'mailbox-bootstrapped', null,
        1, 1000);`);
  }
  for (const name of [
    "1023_app_organization_legacy_cutover.sql",
    "1024_app_mailbox_legacy_organization_assignment.sql",
  ]) {
    const index = files.findIndex((file) => path.basename(file) === name);
    const file = files[index];
    if (file === undefined) {
      throw new Error("Missing organization migration fixture");
    }
    applyMigrationBatch(database, file, index + 1);
  }
  return database;
};

const ownerAssignmentState = (database: DatabaseSync) => ({
  cutover: database
    .prepare(
      "select id,schema_version from app_organization_owner_assignment_cutover"
    )
    .all(),
  grants: database
    .prepare(
      `select subject_type,subject_id,role_id,scope_type,scope_id_present,
        scope_id,expires_at,metadata,revoked_at from auth_role_grant
       where role_id = 'organization.owner' order by subject_id`
    )
    .all(),
  members: database
    .prepare(
      `select id,organization_id,user_id,status,version
       from app_organization_member order by id`
    )
    .all(),
  receipts: database
    .prepare(
      `select organization_id,mailbox_id,user_id,membership_id,source,
        source_bootstrap_operation_id,source_audit_event_id,schema_version
       from app_organization_owner_assignment_receipt order by organization_id`
    )
    .all(),
});

describe("patched Alchemy D1 migration batching", () => {
  it("keeps trigger bodies, quoted semicolons, and comments complete", () => {
    const sql = `
      -- ignored ; delimiter
      create table example (id integer primary key, value text);
      create trigger example_insert
      after insert on example
      begin
        insert into example (value) values ('quoted;value');
        select case when new.id > 0 then 1 else 0 end;
      end;
      /* ignored ; delimiter */
      insert into example (value) values ('final');
    `;

    const statements = splitSqlStatements(sql);

    expect(statements).toHaveLength(3);
    const database = new DatabaseSync(":memory:");
    try {
      for (const statement of statements) {
        database.exec(statement);
      }
      expect(
        database.prepare("select count(*) as count from example").get()
      ).toMatchObject({ count: 2 });
    } finally {
      database.close();
    }
  });

  it("rejects migration-level transaction control inside the D1 batch", () => {
    for (const sql of [
      "begin; select 1; commit;",
      "savepoint migration; select 1; release migration;",
      "rollback;",
    ]) {
      expect(() => splitSqlStatements(sql)).toThrow(
        "Migration transaction control is incompatible with D1 import"
      );
    }
  });

  it("compiles temp scratch objects without rewriting comments or values", () => {
    const compiled = compileD1ImportSql(
      `
        -- create temp table ignored (value text);
        create temp table scratch (value text);
        insert into scratch values ('create temp view ignored as select 1');
        create temporary view scratch_view as select value from scratch;
        drop view scratch_view;
        drop table scratch;
      `,
      "1020_app_authorization_catalog_v2.sql"
    );

    expect(compiled).toContain("create  table __d1_scratch_scratch");
    expect(compiled).toContain("create  view __d1_scratch_scratch_view");
    expect(compiled).toContain("select value from __d1_scratch_scratch");
    expect(compiled).toContain("-- create temp table ignored");
    expect(compiled).toContain("'create temp view ignored as select 1'");
    for (const sql of [
      "pragma foreign_keys = off;",
      "attach database 'other.db' as other;",
      "delete from sqlite_schema;",
    ]) {
      expect(() => compileD1ImportSql(sql, "safe.sql")).toThrow(
        "Migration statement is incompatible with D1 import"
      );
    }
    for (const sql of [
      'create temp table "quoted" (value text);',
      "create temp table if not exists conditional (value text);",
      "create temp table qualified (value text); select * from temp.qualified;",
      "create temp trigger unsupported after insert on anything begin select 1; end;",
      'create temp table qualified (value text); select * from "temp".qualified;',
      "create/**/temp table commented (value text);",
      "create temp table qualified (value text); select * from 'temp'/**/.qualified;",
    ]) {
      expect(() =>
        compileD1ImportSql(sql, "1020_app_authorization_catalog_v2.sql")
      ).toThrow(/incompatible|unsupported/iu);
    }
    expect(() =>
      compileD1ImportSql(
        "create temp table future_scratch (value text);",
        "future.sql"
      )
    ).toThrow("TEMP objects are not approved for migration future.sql");
    expect(() =>
      compileD1ImportSql('delete from "sqlite_schema";', "safe.sql")
    ).toThrow("Migration statement is incompatible with D1 import");
    expect(
      compileD1ImportSql("create table final (value text)", "safe.sql")
    ).toBe("create table final (value text)\n;");
    expect(
      compileD1ImportSql("select 'temp.foo' -- trailing", "safe.sql")
    ).toBe("select 'temp.foo' -- trailing\n;");
    expect(() =>
      compileD1ImportSql("delete/**/from 'sqlite_schema';", "safe.sql")
    ).toThrow("Migration statement is incompatible with D1 import");
    expect(() =>
      compileD1ImportSql(
        "with doomed as (select 1) delete from sqlite_schema;",
        "safe.sql"
      )
    ).toThrow("Migration statement is incompatible with D1 import");
  });

  it("balances SQL boolean chains without changing three-valued results", () => {
    const database = new DatabaseSync(":memory:");
    try {
      database.exec(`create table truth_values (value integer);
        insert into truth_values values (0), (1), (null);`);
      const expressions = [
        "a.value and b.value and c.value and d.value",
        "a.value or b.value or c.value or d.value",
        "a.value and b.value and c.value or d.value or a.value",
        "a.value between 0 and 1 and b.value and c.value",
        "case when a.value and b.value and c.value then 1 else 0 end and d.value",
        `exists (select 1 from truth_values x
          where x.value is a.value and x.value is b.value and x.value is c.value
          order by x.value limit 1) and d.value`,
      ];
      for (const expression of expressions) {
        const balanced = rebalanceSqlBooleanExpression(expression);
        const rows = database
          .prepare(`select ${expression} as original, ${balanced} as balanced
            from truth_values a, truth_values b, truth_values c, truth_values d`)
          .all();
        expect(rows.every((row) => row.original === row.balanced)).toBeTruthy();
      }

      const longChain = Array.from({ length: 255 }, (_, index) =>
        index % 2 === 0 ? "null" : "1"
      ).join(" and ");
      const balanced = rebalanceSqlBooleanExpression(longChain);
      expect(maximumParenthesisDepth(balanced)).toBe(8);
      expect(
        database.prepare(`select ${balanced} as value`).get()
      ).toMatchObject({ value: null });
      const quotedAndCommented = rebalanceSqlBooleanExpression(
        "flag = 'AND OR' and /* AND */ other = 1 -- OR\n and final = 1"
      );
      expect(quotedAndCommented).toContain("'AND OR'");
      expect(quotedAndCommented).toContain("/* AND */");
      expect(quotedAndCommented).toContain("-- OR\n");
    } finally {
      database.close();
    }
  });

  it("gates the 1025 statement 24 rewrite by its exact SHA-256", () => {
    const file =
      "migrations/control-plane/1025_app_organization_owner_assignment.sql";
    const source = readFileSync(path.join(root, file), "utf-8");
    const original = splitSqlStatements(source);
    expect(original).toHaveLength(45);
    const originalTarget = original[23] ?? "";
    expect(createHash("sha256").update(originalTarget).digest("hex")).toBe(
      "649363a4e6dee14f953c03f4e070507c536e977737e44338af25a53035a9bf3b"
    );

    const compiled = splitSqlStatements(
      compileD1ImportSql(source, path.basename(file))
    );
    const compiledTarget = compiled[23] ?? "";
    expect(compiledTarget).not.toBe(originalTarget);
    expect(maximumParenthesisDepth(compiledTarget)).toBe(29);
    expect(createHash("sha256").update(compiledTarget).digest("hex")).toBe(
      "74b4130caa1668507d396b77eb8e017f3e0f418e5cd550885b69128c55458767"
    );
    expect(() =>
      compileD1ImportSql(
        source.replace("-- First application", "-- Changed application"),
        path.basename(file)
      )
    ).toThrow(/Refusing D1 expression rewrite.*statement 24.*SHA-256/u);
    expect(compileD1ImportSql("select 1;", "unrelated.sql")).toBe("select 1;");
  });

  it.each(["none", "receipt"] as const)(
    "preserves 1025 candidate and prior-receipt semantics with %s history",
    (history) => {
      const original = makeLegacy1024Database(history);
      const compiled = makeLegacy1024Database(history);
      const name = "1025_app_organization_owner_assignment.sql";
      const source = readFileSync(
        path.join(root, "migrations/control-plane", name),
        "utf-8"
      );
      const compiledSource = compileD1ImportSql(source, name);
      try {
        original.exec(source);
        compiled.exec(compiledSource);
        expect(ownerAssignmentState(compiled)).toStrictEqual(
          ownerAssignmentState(original)
        );

        original.exec(source);
        compiled.exec(compiledSource);
        expect(ownerAssignmentState(compiled)).toStrictEqual(
          ownerAssignmentState(original)
        );
      } finally {
        original.close();
        compiled.close();
      }
    }
  );

  it("resumes cached D1 imports without requiring another upload URL", () => {
    expect(
      resolveImportInit(
        {
          atBookmark: "cached-bookmark",
          filename: "server.sql",
          status: "active",
        },
        "fallback.sql"
      )
    ).toStrictEqual({
      _tag: "poll",
      bookmark: "cached-bookmark",
      filename: "server.sql",
    });
    expect(
      resolveImportInit(
        {
          filename: "server.sql",
          result: { numQueries: 12 },
          status: "complete",
        },
        "fallback.sql"
      )
    ).toStrictEqual({
      _tag: "complete",
      result: { filename: "server.sql", numQueries: 12 },
    });
    expect(
      resolveImportInit(
        { filename: "server.sql", uploadUrl: "https://upload.invalid" },
        "fallback.sql"
      )
    ).toStrictEqual({
      _tag: "upload",
      filename: "server.sql",
      uploadUrl: "https://upload.invalid",
    });
    expect(
      resolveImportInit({ error: "failed" }, "fallback.sql")
    ).toStrictEqual({ _tag: "error", message: "failed" });
    expect(
      resolveImportInit({ status: "complete" }, "fallback.sql")
    ).toStrictEqual({
      _tag: "error",
      message: "D1 import complete result missing",
    });
    expect(
      resolveImportInit({ status: "error" }, "fallback.sql")
    ).toStrictEqual({ _tag: "error", message: "D1 import failed" });
    expect(nextImportBookmark("retained")).toBe("retained");
    expect(nextImportBookmark("retained", null)).toBe("retained");
    expect(nextImportBookmark("retained", "replacement")).toBe("replacement");
  });

  it("retains polling bookmarks, adopts replacements, backs off, and times out", async () => {
    const bookmarks: string[] = [];
    const delays: number[] = [];
    const responses = [
      {},
      { at_bookmark: "replacement" },
      {
        filename: "complete.sql",
        result: { num_queries: 24 },
        status: "complete" as const,
      },
    ];
    const result = await Effect.runPromise(
      pollD1Import({
        bookmark: "retained",
        fallbackFilename: "fallback.sql",
        request: (bookmark) =>
          Effect.sync(() => {
            bookmarks.push(bookmark);
            return responses.shift() ?? { status: "error" as const };
          }),
        sleep: (delay) => Effect.sync(() => void delays.push(delay)),
        timeout: Duration.seconds(1),
      })
    );

    expect(result).toStrictEqual({ filename: "complete.sql", numQueries: 24 });
    expect(bookmarks).toStrictEqual(["retained", "retained", "replacement"]);
    expect(delays).toStrictEqual([1000, 2000]);
    const timeout = await Effect.runPromiseExit(
      pollD1Import({
        bookmark: "retained",
        fallbackFilename: "fallback.sql",
        request: () => Effect.never,
        timeout: Duration.millis(1),
      })
    );
    expect(timeout._tag).toBe("Failure");
    expect(d1ImportUploadTimeoutMillis(100 * 1024)).toBe(5 * 60 * 1000);
    expect(d1ImportUploadTimeoutMillis(5 * 1024 * 1024 * 1024)).toBe(
      5120 * 2000
    );
  });

  it("replays the expression-depth-100 verified payload from ledger 54", () => {
    const database = new DatabaseSync(":memory:");
    const files = migrationFiles();
    try {
      createLedger(database);
      for (const [index, file] of files.entries()) {
        if (index === 54) {
          break;
        }
        applyMigrationBatch(database, file, index + 1);
      }
      expect(
        database
          .prepare("select id,name from d1_migrations order by id desc limit 1")
          .get()
      ).toMatchObject({
        id: "00054",
        name: "1024_app_mailbox_legacy_organization_assignment.sql",
      });

      for (const [index, file] of files.entries()) {
        if (index < 54) {
          continue;
        }
        applyMigrationBatch(database, file, index + 1, true);
      }

      expect(files).toHaveLength(61);
      expect(
        database.prepare("select count(*) as count from d1_migrations").get()
      ).toMatchObject({ count: 61 });
      expect(
        database
          .prepare("select id,name from d1_migrations order by id desc limit 1")
          .get()
      ).toMatchObject({
        id: "00061",
        name: "1031_app_mailbox_bootstrap_security_intent.sql",
      });
      expect(
        database
          .prepare(
            "select count(*) as count from sqlite_schema where type = 'trigger'"
          )
          .get()
      ).toMatchObject({ count: 178 });
      expect(database.prepare("pragma quick_check").get()).toMatchObject({
        quick_check: "ok",
      });
      expect(
        database
          .prepare(
            "select count(*) as count from sqlite_schema where name glob '__d1_scratch_*'"
          )
          .get()
      ).toMatchObject({ count: 0 });

      const expected = new DatabaseSync(":memory:");
      try {
        createLedger(expected);
        for (const [index, file] of files.entries()) {
          applyMigrationBatch(expected, file, index + 1);
        }
        expect(schemaSql(database)).toStrictEqual(schemaSql(expected));
      } finally {
        expected.close();
      }
    } finally {
      database.close();
    }
  });

  it("rolls back compiled scratch, schema writes, and ledger on failure", () => {
    const database = new DatabaseSync(":memory:");
    try {
      createLedger(database);
      database.exec(`create trigger fail_ledger
        before insert on d1_migrations
        begin
          select raise(abort, 'ledger failure');
        end;`);
      expect(() =>
        applySqlBatch(
          database,
          `create temp table scratch (value text);
           create table example (value text not null);
           insert into example values ('before-failure');
           drop table scratch;`,
          "1020_app_authorization_catalog_v2.sql",
          1,
          true
        )
      ).toThrow(/ledger failure/u);
      expect(
        database.prepare("select count(*) as count from d1_migrations").get()
      ).toMatchObject({ count: 0 });
      expect(
        database
          .prepare(
            "select count(*) as count from sqlite_schema where name in ('example','__d1_scratch_scratch')"
          )
          .get()
      ).toMatchObject({ count: 0 });
    } finally {
      database.close();
    }
  });

  it("keeps the ledger insert last in one D1 import", () => {
    const patch = readFileSync(
      path.join(root, "patches/alchemy@2.0.0-beta.62.patch"),
      "utf-8"
    );
    expect(patch).toContain("yield* importD1Database({");
    expect(patch).toContain("compileD1ImportSql(migration.sql, migration.id)");
    expect(patch).toContain("__d1_scratch_");
    expect(patch).toContain("sqlData:");
    expect(patch).toContain('initDecision._tag === "poll"');
    expect(patch.indexOf("migrationSql")).toBeLessThan(
      patch.search(/INSERT INTO \$\{migrationsTable\}/u)
    );
    expect(patch).not.toContain("batch: statements.map");
  });
});
