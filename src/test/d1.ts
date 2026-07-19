import { readdir, readFile } from "node:fs/promises";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";

import type {
  D1EffectQbDatabaseLike,
  D1EffectQbPreparedStatementLike,
  D1EffectQbResult,
} from "@effect-auth/core/EffectQbSqliteStorage";

const migrationsDirectory = new URL(
  "../../migrations/control-plane/",
  import.meta.url
);

export const applyControlPlaneMigrations = async (database: DatabaseSync) => {
  const directoryEntries = await readdir(migrationsDirectory);
  const migrationFiles = directoryEntries.filter((file) =>
    file.endsWith(".sql")
  );
  // oxlint-disable-next-line unicorn/no-array-sort -- Migration order is part of the schema contract.
  migrationFiles.sort();
  const migrations = await Promise.all(
    migrationFiles.map((file) =>
      readFile(new URL(file, migrationsDirectory), "utf-8")
    )
  );

  database.exec("pragma foreign_keys = on");
  for (const migration of migrations) {
    database.exec(migration);
  }
};

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export const makeTestD1Database = (
  database: DatabaseSync
): D1EffectQbDatabaseLike => {
  type TestPreparedStatement = D1EffectQbPreparedStatementLike & {
    readonly raw: () => Promise<readonly (readonly unknown[])[]>;
  };

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
        } satisfies D1EffectQbResult<Row>);
      } catch (error) {
        return Promise.resolve({
          error: errorMessage(error),
          success: false,
        } satisfies D1EffectQbResult<Row>);
      }
    },
    bind: (...boundValues) => makeStatement(sql, boundValues),
    raw: () => {
      try {
        const rows = database
          .prepare(sql)
          .all(...(values as readonly SQLInputValue[])) as readonly Readonly<
          Record<string, unknown>
        >[];
        return Promise.resolve(rows.map((row) => Object.values(row)));
      } catch (error) {
        return Promise.reject(error);
      }
    },
  });
  return {
    batch: (statements) => {
      const execute = async () => {
        database.exec("begin immediate");
        const results: D1EffectQbResult[] = [];

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
