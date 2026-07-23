import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { describe, expect, it } from "vitest";

import {
  ControlPlaneBatch,
  ControlPlaneBatchError,
  ControlPlaneBatchLayer,
} from "#/platform/control-plane-d1/ControlPlaneBatch";
import type {
  ControlPlaneStatement,
  ControlPlaneStatements,
} from "#/platform/control-plane-d1/ControlPlaneBatch";
import {
  ControlPlaneD1Binding,
  ControlPlaneDatabase,
  ControlPlaneDatabaseLayer,
} from "#/platform/control-plane-d1/ControlPlaneDatabase";
import { appMailbox } from "#/platform/control-plane-d1/ControlPlaneSchema";

const query = (statement: SQL): ControlPlaneStatement => ({
  _: { dialect: "sqlite", result: undefined },
  getSQL: () => statement,
});

const bindingLayer = (database: D1Database) =>
  Layer.succeed(ControlPlaneD1Binding, ControlPlaneD1Binding.of({ database }));

const layer = (database: D1Database) =>
  ControlPlaneBatchLayer.pipe(Layer.provide(bindingLayer(database)));

const executeEffect = (
  database: D1Database,
  statements: ControlPlaneStatements
) =>
  ControlPlaneBatch.pipe(
    Effect.flatMap((batch) => batch.execute(statements)),
    Effect.provide(layer(database))
  );

const execute = (database: D1Database, statements: ControlPlaneStatements) =>
  Effect.runPromise(executeEffect(database, statements));

const executeError = (
  database: D1Database,
  statements: ControlPlaneStatements
) => Effect.runPromise(Effect.flip(executeEffect(database, statements)));

describe("D1 batch adapter", () => {
  it("compiles Drizzle statements and preserves parameter and result order", async () => {
    const preparedSql: string[] = [];
    const boundParams: unknown[][] = [];
    const preparedStatements: unknown[] = [];
    const database = {
      batch: (statements: readonly unknown[]) => {
        expect(statements).toStrictEqual(preparedStatements);
        return Promise.resolve([
          { results: [{ value: "first" }], success: true },
          { results: [{ value: "second" }], success: true },
        ]);
      },
      prepare: (statementSql: string) => {
        preparedSql.push(statementSql);
        const statement = {
          bind: (...params: unknown[]) => {
            boundParams.push(params);
            preparedStatements.push(statement);
            return statement;
          },
        };
        return statement;
      },
    } as unknown as D1Database;

    const controlPlane = await Effect.runPromise(
      ControlPlaneDatabase.pipe(
        Effect.provide(
          ControlPlaneDatabaseLayer.pipe(Layer.provide(bindingLayer(database)))
        )
      )
    );

    const results = await execute(database, [
      controlPlane.select({ value: sql<string>`${"first"}` }).from(appMailbox),
      controlPlane.select({ value: sql<string>`${"second"}` }).from(appMailbox),
    ]);

    expect(preparedSql).toStrictEqual([
      'select ? from "app_mailbox"',
      'select ? from "app_mailbox"',
    ]);
    expect(boundParams).toStrictEqual([["first"], ["second"]]);
    expect(results.map((result) => result.results)).toStrictEqual([
      [{ value: "first" }],
      [{ value: "second" }],
    ]);
  });

  it("reports preparation failures as uncommitted at their statement index", async () => {
    let prepareCalls = 0;
    let batchCalled = false;
    const statement = { bind: () => statement };
    const database = {
      batch: () => {
        batchCalled = true;
        return Promise.resolve([]);
      },
      prepare: () => {
        prepareCalls += 1;
        if (prepareCalls === 2) {
          throw new Error("prepare failed");
        }
        return statement;
      },
    } as unknown as D1Database;

    const error = await executeError(database, [
      query(sql`select 1`),
      query(sql`select 2`),
    ]);

    expect(batchCalled).toBeFalsy();
    expect(error).toMatchObject({
      commitState: "not-committed",
      statement: 1,
    });
  });

  it("reports bind failures as uncommitted", async () => {
    const database = {
      batch: () => Promise.resolve([]),
      prepare: () => ({
        bind: () => {
          throw new Error("bind failed");
        },
      }),
    } as unknown as D1Database;

    const error = await executeError(database, [query(sql`select ${1}`)]);

    expect(error).toMatchObject({
      commitState: "not-committed",
      statement: 0,
    });
  });

  it("reports rejected batch execution with an unknown commit state", async () => {
    const statement = { bind: () => statement };
    const database = {
      batch: () => Promise.reject(new Error("connection lost")),
      prepare: () => statement,
    } as unknown as D1Database;

    const error = await executeError(database, [query(sql`select 1`)]);

    expect(error).toMatchObject({ commitState: "unknown" });
    expect(error.statement).toBeUndefined();
  });

  it("rejects success false without an error as a typed uncommitted failure", async () => {
    const statement = {
      bind: () => statement,
    };
    const database = {
      batch: () => Promise.resolve([{ success: false }]),
      prepare: () => statement,
    } as unknown as D1Database;

    const error = await executeError(database, [query(sql`select 1`)]);

    expect(error).toBeInstanceOf(ControlPlaneBatchError);
    expect(error).toMatchObject({
      cause: "D1 batch statement failed",
      commitState: "not-committed",
      statement: 0,
    });
  });

  it("reports a result cardinality mismatch with an unknown commit state", async () => {
    const statement = { bind: () => statement };
    const database = {
      batch: () => Promise.resolve([{ success: true }]),
      prepare: () => statement,
    } as unknown as D1Database;

    const error = await executeError(database, [
      query(sql`select 1`),
      query(sql`select 2`),
    ]);

    expect(error).toMatchObject({ commitState: "unknown" });
    expect(error.statement).toBeUndefined();
  });
});
