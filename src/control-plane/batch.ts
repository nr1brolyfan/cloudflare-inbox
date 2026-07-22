import type { SQLWrapper } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { SQLiteDialect } from "drizzle-orm/sqlite-core";
/* oxlint-disable unicorn/no-array-for-each, unicorn/no-array-method-this-argument -- Effect.forEach is not Array#forEach. */
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ControlPlaneD1Binding, ControlPlaneDatabaseLive } from "./database";

export type ControlPlaneCommitState = "not-committed" | "committed" | "unknown";

export class ControlPlaneBatchError extends Data.TaggedError(
  "ControlPlaneBatchError"
)<{
  readonly cause: unknown;
  readonly commitState: ControlPlaneCommitState;
  readonly statement?: number;
}> {}

/** Drizzle batch item kept compatible with a future Effect-D1 batch API. */
export type ControlPlaneStatement = BatchItem<"sqlite"> & SQLWrapper;

export type ControlPlaneStatements = readonly [
  ControlPlaneStatement,
  ...ControlPlaneStatement[],
];

export interface ControlPlaneBatchResult {
  readonly error?: string;
  readonly results?: readonly unknown[];
  readonly success?: boolean;
}

export interface ControlPlaneBatch {
  readonly execute: (
    statements: ControlPlaneStatements
  ) => Effect.Effect<
    readonly ControlPlaneBatchResult[],
    ControlPlaneBatchError
  >;
}

/** Atomic multi-statement writes unavailable through the Effect D1 driver. */
export const ControlPlaneBatch = Context.Service<ControlPlaneBatch>(
  "cloudflare-inbox/ControlPlaneBatch"
);

/** Cloudflare D1 atomic batch adapter. */
export const ControlPlaneBatchLive = Layer.effect(
  ControlPlaneBatch,
  Effect.gen(function* () {
    const { database } = yield* ControlPlaneD1Binding;
    const dialect = new SQLiteDialect();

    return ControlPlaneBatch.of({
      execute: (statements) =>
        Effect.gen(function* () {
          const prepared = yield* Effect.forEach(
            statements,
            (statement, index) =>
              Effect.try({
                try: () => {
                  const query = dialect.sqlToQuery(statement.getSQL());
                  return database.prepare(query.sql).bind(...query.params);
                },
                catch: (cause) =>
                  new ControlPlaneBatchError({
                    cause,
                    commitState: "not-committed",
                    statement: index,
                  }),
              })
          );
          const results = yield* Effect.tryPromise({
            try: (): Promise<readonly ControlPlaneBatchResult[]> =>
              database.batch(prepared),
            catch: (cause) =>
              new ControlPlaneBatchError({
                cause,
                commitState: "unknown",
              }),
          });

          const failed = results.findIndex(
            (result) => result.success === false || result.error !== undefined
          );
          if (failed !== -1) {
            return yield* new ControlPlaneBatchError({
              cause: results[failed]?.error ?? "D1 batch statement failed",
              commitState: "not-committed",
              statement: failed,
            });
          }

          if (results.length !== statements.length) {
            return yield* new ControlPlaneBatchError({
              cause: new Error(
                `D1 batch returned ${results.length} results for ${statements.length} statements`
              ),
              commitState: "unknown",
            });
          }

          return results;
        }),
    });
  })
);

/** Shared control-plane adapters; the Worker must provide ControlPlaneD1Binding. */
export const ControlPlaneLive = ControlPlaneBatchLive.pipe(
  Layer.provideMerge(ControlPlaneDatabaseLive)
);
