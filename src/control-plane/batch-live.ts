/* oxlint-disable unicorn/no-array-for-each, unicorn/no-array-method-this-argument -- Effect.forEach is not Array#forEach. */
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ControlPlaneBatchError } from "../mailboxes/control-plane-batch-error";
import { ControlPlaneBatch } from "./batch";
import { ControlPlaneD1Binding } from "./database";

export const ControlPlaneBatchLive = Layer.effect(
  ControlPlaneBatch,
  Effect.gen(function* () {
    const { database } = yield* ControlPlaneD1Binding;

    return ControlPlaneBatch.of({
      execute: (statements) =>
        Effect.gen(function* () {
          const prepared = yield* Effect.forEach(
            statements,
            ({ params = [], sql }, statement) =>
              Effect.try({
                try: () => database.prepare(sql).bind(...params),
                catch: (cause) =>
                  new ControlPlaneBatchError({
                    cause,
                    commitState: "not-committed",
                    statement,
                  }),
              })
          );
          const results = yield* Effect.tryPromise({
            try: () => database.batch(prepared),
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
