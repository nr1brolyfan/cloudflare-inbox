import { globSync, readFileSync } from "node:fs";
import path from "node:path";
/* oxlint-disable unicorn/no-array-sort, vitest/max-expects -- Migration order and end-state evidence form one rehearsal. */
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";

import { splitSqlStatements } from "../../node_modules/alchemy/src/Cloudflare/D1/ApplyMigrations";
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

const applyMigrationBatch = (
  database: DatabaseSync,
  file: string,
  sequence: number
) => {
  const statements = splitSqlStatements(
    readFileSync(path.join(root, file), "utf-8")
  );
  database.exec("begin immediate");
  try {
    for (const statement of statements) {
      database.exec(statement);
    }
    database
      .prepare(
        "insert into d1_migrations (id,name,applied_at) values (?,?,datetime('now'))"
      )
      .run(sequence.toString().padStart(5, "0"), path.basename(file));
    database.exec("commit");
  } catch (error) {
    database.exec("rollback");
    throw error;
  }
};

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

  it("resumes the production ledger after 1007 and reaches final integrity", () => {
    const database = new DatabaseSync(":memory:");
    const files = migrationFiles();
    try {
      createLedger(database);
      for (const [index, file] of files.entries()) {
        if (index === 37) {
          break;
        }
        applyMigrationBatch(database, file, index + 1);
      }
      expect(
        database
          .prepare("select id,name from d1_migrations order by id desc limit 1")
          .get()
      ).toMatchObject({ id: "00037", name: "1007_app_ai_tool_audit.sql" });

      for (const [index, file] of files.entries()) {
        if (index < 37) {
          continue;
        }
        applyMigrationBatch(database, file, index + 1);
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
    } finally {
      database.close();
    }
  });

  it("rolls back schema writes and the ledger when a batch statement fails", () => {
    const database = new DatabaseSync(":memory:");
    try {
      createLedger(database);
      database.exec("create table example (value text not null)");
      expect(() => {
        database.exec("begin immediate");
        try {
          database.exec(
            "insert into example (value) values ('before-failure')"
          );
          database.exec("insert into missing_table (value) values ('failure')");
          database.exec(
            "insert into d1_migrations (id,name,applied_at) values ('00001','failed.sql',datetime('now'))"
          );
          database.exec("commit");
        } catch (error) {
          database.exec("rollback");
          throw error;
        }
      }).toThrow(/no such table/u);
      expect(
        database.prepare("select count(*) as count from example").get()
      ).toMatchObject({ count: 0 });
      expect(
        database.prepare("select count(*) as count from d1_migrations").get()
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
    expect(patch).toContain("sqlData:");
    expect(patch).toContain('initDecision._tag === "poll"');
    expect(patch.indexOf("migration.sql")).toBeLessThan(
      patch.search(/INSERT INTO \$\{migrationsTable\}/u)
    );
    expect(patch).not.toContain("batch: statements.map");
  });
});
