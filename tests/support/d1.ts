import { readdir, readFile } from "node:fs/promises";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";

import { LEGACY_DEFAULT_ORGANIZATION_ID } from "#/modules/organization/domain/Organization";

export interface TestD1Result<Row = Readonly<Record<string, unknown>>> {
  readonly error?: string;
  readonly results?: readonly Row[];
  readonly success: boolean;
}

export interface TestD1PreparedStatementLike {
  readonly all: <Row extends Readonly<Record<string, unknown>>>() => Promise<
    TestD1Result<Row>
  >;
  readonly bind: (...values: readonly unknown[]) => TestD1PreparedStatementLike;
}

export interface TestD1DatabaseLike {
  readonly batch: (
    statements: readonly TestD1PreparedStatementLike[]
  ) => Promise<readonly TestD1Result[]>;
  readonly prepare: (sql: string) => TestD1PreparedStatementLike;
}

const migrationsDirectory = new URL(
  "../../migrations/control-plane/",
  import.meta.url
);

const controlPlaneMigrationFiles = async () => {
  const directoryEntries = await readdir(migrationsDirectory);
  const migrationFiles = directoryEntries.filter((file) =>
    file.endsWith(".sql")
  );
  // oxlint-disable-next-line unicorn/no-array-sort -- Migration order is part of the schema contract.
  migrationFiles.sort();
  return migrationFiles;
};

const applyMigrationFiles = async (
  database: DatabaseSync,
  migrationFiles: readonly string[]
) => {
  const migrations = await Promise.all(
    migrationFiles.map((file) =>
      readFile(new URL(file, migrationsDirectory), "utf-8")
    )
  );

  database.exec("pragma foreign_keys = on");
  for (const migration of migrations) {
    if (
      /^\s*(?:begin(?:\s+(?:deferred|exclusive|immediate|transaction))?|commit|rollback)\s*;/imu.test(
        migration
      )
    ) {
      throw new Error("Control-plane migrations must not manage transactions");
    }

    database.exec("begin immediate");
    try {
      database.exec(migration);
      database.exec("commit");
    } catch (error) {
      database.exec("rollback");
      throw error;
    }
  }
};

export const applyControlPlaneMigration = async (
  database: DatabaseSync,
  migrationFile: string
) => {
  const migrationFiles = await controlPlaneMigrationFiles();
  if (!migrationFiles.includes(migrationFile)) {
    throw new Error(`Unknown control-plane migration: ${migrationFile}`);
  }
  await applyMigrationFiles(database, [migrationFile]);
};

export const applyControlPlaneMigrationsThrough = async (
  database: DatabaseSync,
  lastMigrationFile: string
) => {
  const migrationFiles = await controlPlaneMigrationFiles();
  const lastMigrationIndex = migrationFiles.indexOf(lastMigrationFile);
  if (lastMigrationIndex === -1) {
    throw new Error(`Unknown control-plane migration: ${lastMigrationFile}`);
  }
  await applyMigrationFiles(
    database,
    migrationFiles.slice(0, lastMigrationIndex + 1)
  );
};

export const applyControlPlaneMigrations = async (database: DatabaseSync) => {
  await applyMigrationFiles(database, await controlPlaneMigrationFiles());
};

/** Test setup for direct first-mailbox inserts after the fresh ORG-006 cutover. */
export const insertFreshCutoverOrganization = (
  database: DatabaseSync,
  createdAt: number
) => {
  const hasCutoverTable = database
    .prepare(
      `select 1
         from sqlite_master
        where type = 'table'
          and name = 'app_organization_legacy_cutover'`
    )
    .get();
  if (hasCutoverTable === undefined) {
    return;
  }
  const freshCutover = database
    .prepare(
      `select 1
         from app_organization_legacy_cutover
        where id = 1
          and schema_version = 1
          and outcome = 'fresh-empty'
          and source_mailbox_id is null
          and source_created_at is null
          and organization_id is null`
    )
    .get();
  const organization = database
    .prepare("select 1 from app_organization where id = ?")
    .get(LEGACY_DEFAULT_ORGANIZATION_ID);
  if (freshCutover !== undefined && organization === undefined) {
    database
      .prepare(
        `insert into app_organization (id, created_at, updated_at)
         values (?, ?, ?)`
      )
      .run(LEGACY_DEFAULT_ORGANIZATION_ID, createdAt, createdAt);
  }
};

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

interface TestPreparedStatement extends TestD1PreparedStatementLike {
  readonly raw: <
    Row extends readonly unknown[] = readonly unknown[],
  >() => Promise<readonly Row[]>;
}

export const makeTestD1Database = (
  database: DatabaseSync
): TestD1DatabaseLike => {
  const makeStatement = (
    sql: string,
    values: readonly unknown[] = []
  ): TestPreparedStatement => ({
    all: <Row extends Readonly<Record<string, unknown>>>() => {
      try {
        return Promise.resolve({
          results: database
            .prepare(sql)
            .all(...(values as readonly SQLInputValue[])) as Row[],
          success: true,
        } satisfies TestD1Result<Row>);
      } catch (error) {
        return Promise.resolve({
          error: errorMessage(error),
          success: false,
        } satisfies TestD1Result<Row>);
      }
    },
    bind: (...boundValues) => makeStatement(sql, boundValues),
    raw: <Row extends readonly unknown[] = readonly unknown[]>() => {
      try {
        const rows = database
          .prepare(sql)
          .all(...(values as readonly SQLInputValue[])) as readonly Readonly<
          Record<string, unknown>
        >[];
        return Promise.resolve(
          rows.map((row) => Object.values(row)) as unknown as readonly Row[]
        );
      } catch (error) {
        return Promise.reject(error);
      }
    },
  });
  return {
    batch: (statements) => {
      const execute = async () => {
        database.exec("begin immediate");
        const results: TestD1Result[] = [];

        try {
          for (const statement of statements) {
            // oxlint-disable-next-line eslint/no-await-in-loop -- D1 batches execute statements sequentially.
            const result = await statement.all();
            results.push(result);

            if (result.success === false || result.error !== undefined) {
              throw new Error(result.error ?? "D1 batch statement failed");
            }
          }

          database.exec("commit");
          return results;
        } catch (error) {
          database.exec("rollback");
          throw error;
        }
      };
      return execute();
    },
    prepare: (sql) => makeStatement(sql),
  };
};

let organizationLifecycleAuditSequence = 100;

export const activateOrganizationLifecycleProtocol = (
  database: DatabaseSync
) => {
  const row = database
    .prepare(
      "select status from app_organization_lifecycle_activation where id = 1"
    )
    .get() as { readonly status: string } | undefined;
  if (row?.status === "expanded") {
    database.exec(`
      drop trigger app_organization_lifecycle_activation_no_update;
      update app_organization_lifecycle_activation
         set status = 'active'
       where id = 1;
    `);
  }
};

export const insertOrganizationLifecycleAudit = (
  database: DatabaseSync,
  input: {
    readonly action: "resume" | "suspend";
    readonly afterVersion: number;
    readonly beforeVersion: number;
    readonly occurredAt: number;
    readonly organizationId: string;
  }
) => {
  activateOrganizationLifecycleProtocol(database);
  organizationLifecycleAuditSequence += 1;
  const suffix = String(organizationLifecycleAuditSequence).padStart(12, "0");
  const operationId = `00000000-0000-4000-8000-${suffix}`;
  const eventId = `admin-audit-sha256:${organizationLifecycleAuditSequence
    .toString(16)
    .padStart(64, "0")}`;
  const semantic = `organization-${input.action === "suspend" ? "suspended" : "resumed"}`;
  database.exec(`
    insert or ignore into auth_user (id, created_at, updated_at)
    values ('test-system', 0, 0)
  `);
  database
    .prepare(
      `insert into app_organization_administrative_audit_event
        (event_id, schema_version, event_version, operation_id, action,
         actor_id, organization_id, reason_code, change_type,
         resource_version_before, resource_version_after, request_id,
         correlation_id, occurred_at)
       values (?, 1, 1, ?, ?, 'test-system', ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      eventId,
      operationId,
      `organization.${input.action}`,
      input.organizationId,
      semantic,
      semantic,
      input.beforeVersion,
      input.afterVersion,
      `00000000-0000-4000-8000-${suffix}`,
      `00000000-0000-4000-9000-${suffix}`,
      input.occurredAt
    );
};
