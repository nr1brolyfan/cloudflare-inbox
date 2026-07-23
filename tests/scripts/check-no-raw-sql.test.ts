import { describe, expect, it } from "vitest";

import { checkSourcePolicy } from "../../scripts/check-no-raw-sql";

const messages = {
  binding: "ControlPlaneD1Binding capability access",
  native: "native D1 prepare/batch/exec access",
  rawObject: "handwritten SQL object passed to an execution call",
  rawString: "raw string SQL execution",
  sqlRaw: "sql.raw(...) bypasses typed Drizzle fragments",
  storage: "storage.sql.exec(...) execution",
  unsafe: ".unsafe(...) bypasses typed SQL execution",
} as const;

const withControlPlane = (source: string): string =>
  `const database: ControlPlaneDatabase = acquire();\n${source}`;

describe("raw SQL source policy", () => {
  it("allows typed Drizzle fragments through imported and client aliases", () => {
    const source = [
      'import { sql as drizzleSql } from "drizzle-orm";',
      "const database: ControlPlaneDatabase = acquire();",
      "const client = database;",
      `const fragment = drizzleSql<string>\`select \${mailbox.id}\`;`,
      "client.all(fragment);",
      `database.all(drizzleSql\`select \${mailbox.id}\`);`,
    ].join("\n");

    expect(
      checkSourcePolicy(
        "src/modules/mailbox/application/MailboxReading.ts",
        source
      )
    ).toStrictEqual([]);
  });

  it("ignores comments, strings, and non-executable sql data", () => {
    const source = [
      "// database.prepare('select 1'); sql.raw('select 1');",
      "/* client.batch([]); storage.sql.exec('vacuum'); */",
      'const documentation = "ControlPlaneD1Binding client.unsafe()";',
      'const metadata = { sql: "displayed query text" };',
      "logger.info(metadata);",
      'permissionCatalog.all("mailbox:read");',
    ].join("\n");

    expect(
      checkSourcePolicy(
        "src/modules/mailbox/application/Documentation.ts",
        source
      )
    ).toStrictEqual([]);
  });

  it("allows direct object-shaped domain prepare calls", () => {
    expect(
      checkSourcePolicy(
        "src/modules/mailbox/application/Audit.ts",
        'audit.prepare({ _tag: "MailboxCreated", sql: "audit metadata" });'
      )
    ).toStrictEqual([]);
  });

  it("does not treat unrelated methods as SQL capabilities", () => {
    const source = [
      "queue.batch([]);",
      '/mail/.exec("mail");',
      'audit.prepare({ sql: "audit metadata" });',
      "sandbox.unsafe(operation);",
      "database.prepare(query);",
      "db.exec(query);",
      "d1.batch([]);",
    ].join("\n");

    expect(
      checkSourcePolicy(
        "src/modules/mailbox/application/DomainWorkflow.ts",
        source
      )
    ).toStrictEqual([]);
  });

  it("allows native D1 access in the reviewed batch adapter", () => {
    const source = [
      "const database: D1Database = acquire();",
      "const client = database;",
      "const prepared = client.prepare(query.sql);",
      "await client.batch(prepared);",
    ].join("\n");

    expect(
      checkSourcePolicy(
        "src/platform/control-plane-d1/ControlPlaneBatch.ts",
        source
      )
    ).toStrictEqual([]);
  });

  it("tracks raw D1 obtained through an allowed binding capability", () => {
    const source = [
      "const program = Effect.gen(function* () {",
      "  const binding = yield* ControlPlaneD1Binding;",
      "  binding.database.prepare(query.sql);",
      "});",
    ].join("\n");

    expect(
      checkSourcePolicy(
        "src/modules/account-security/adapters/d1/AccountSecurityStorageD1.ts",
        source
      )
    ).toStrictEqual([messages.native]);
  });

  it("allows storage SQL execution in mailbox migrations", () => {
    expect(
      checkSourcePolicy(
        "src/modules/mailbox/adapters/sqlite/MailboxSqliteMigrations.ts",
        "storage.sql.exec(statement);"
      )
    ).toStrictEqual([]);
  });

  it.each([
    "src/modules/account-security/adapters/d1/AccountSecurityStorageD1.ts",
    "src/platform/control-plane-d1/ControlPlaneBatch.ts",
    "src/platform/control-plane-d1/ControlPlaneDatabase.ts",
    "src/apps/backend-worker/BackendWorker.ts",
  ])("allows ControlPlaneD1Binding access in %s", (file) => {
    expect(
      checkSourcePolicy(file, "const binding = ControlPlaneD1Binding;")
    ).toStrictEqual([]);
  });

  it.each([
    {
      message: messages.sqlRaw,
      name: "aliased sql.raw access",
      source: [
        'import { sql as drizzleSql } from "drizzle-orm";',
        'drizzleSql.raw("select 1");',
      ].join("\n"),
    },
    {
      message: messages.unsafe,
      name: "unsafe method extraction",
      source: "const runUnsafe = database.unsafe;",
    },
    {
      message: messages.native,
      name: "prepare through a client alias",
      source: "const client = database; client.prepare(query.sql);",
    },
    {
      message: messages.native,
      name: "native batch method extraction",
      source: "const runBatch = database.batch;",
    },
    {
      message: messages.native,
      name: "computed native access",
      source: 'database["prepare"](query.sql);',
    },
    {
      message: messages.native,
      name: "native access through the Effect D1 client config",
      source: "database.$client.config.db.prepare(query.sql);",
    },
    {
      message: messages.native,
      name: "destructured native access",
      source: "const { batch: runBatch } = database; runBatch([]);",
    },
    ...["all", "get", "run", "values"].map((method) => ({
      message: messages.rawString,
      name: `raw database.${method} strings`,
      source: `database.${method}("select 1");`,
    })),
    {
      message: messages.rawString,
      name: "raw strings through client and value aliases",
      source: [
        "const client = database;",
        'const statement = "select 1";',
        "client.all(statement);",
      ].join("\n"),
    },
    {
      message: messages.rawString,
      name: "clients acquired from an aliased Effect service",
      source: [
        'import { ControlPlaneDatabase as Database } from "./ControlPlaneDatabase";',
        "const program = Effect.gen(function* () {",
        "  const controlPlane = yield* Database;",
        '  controlPlane.all("select 1");',
        "});",
      ].join("\n"),
    },
    {
      message: messages.rawString,
      name: "typed client parameters",
      source: [
        "const query = (controlPlane: EffectSQLiteD1Database) =>",
        '  controlPlane.all("select 1");',
      ].join("\n"),
    },
    {
      message: messages.rawString,
      name: "destructured query methods and concatenated SQL",
      source: [
        "const { all: queryAll } = database;",
        'queryAll("select " + tableName);',
      ].join("\n"),
    },
    {
      message: messages.rawString,
      name: "raw access through the native client",
      source: 'database.$client["get"]("select 1");',
    },
    {
      message: messages.rawObject,
      name: "handwritten statements passed to execute",
      source: [
        'const statement = { params: [], sql: "select 1" };',
        "batch.execute([statement]);",
      ].join("\n"),
    },
    {
      message: messages.storage,
      name: "storage SQL outside migrations",
      source: "storage.sql.exec(statement);",
    },
    {
      message: messages.binding,
      name: "aliased raw binding imports",
      source: [
        'import { ControlPlaneD1Binding as RawBinding } from "./ControlPlaneDatabase";',
        "const binding = RawBinding;",
      ].join("\n"),
    },
  ])("rejects $name", ({ message, source }) => {
    expect(
      checkSourcePolicy(
        "src/modules/mailbox/application/Unreviewed.ts",
        withControlPlane(source)
      )
    ).toStrictEqual([message]);
  });

  it.each([
    {
      file: "src/platform/control-plane-d1/ControlPlaneBatch.ts",
      message: messages.sqlRaw,
      source: 'sql.raw("select 1");',
    },
    {
      file: "src/platform/control-plane-d1/ControlPlaneBatch.ts",
      message: messages.rawObject,
      source: 'database.batch([{ sql: "select 1", params: [] }]);',
    },
    {
      file: "src/modules/mailbox/adapters/sqlite/MailboxSqliteMigrations.ts",
      message: messages.native,
      source: "database.prepare(query.sql);",
    },
    {
      file: "src/apps/backend-worker/BackendWorker.ts",
      message: messages.rawString,
      source: 'database.all("select 1");',
    },
  ])(
    "keeps the exception for $file capability-scoped",
    ({ file, message, source }) => {
      expect(checkSourcePolicy(file, withControlPlane(source))).toStrictEqual([
        message,
      ]);
    }
  );
});
