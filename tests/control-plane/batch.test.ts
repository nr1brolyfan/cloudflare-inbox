import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { describe, expect, it } from "vitest";

import {
  ControlPlaneBatch,
  ControlPlaneBatchError,
  ControlPlaneBatchLive,
} from "#/control-plane/batch";
import { ControlPlaneD1Binding } from "#/control-plane/database";

describe("D1 batch adapter", () => {
  it("rejects success false without an error as a typed uncommitted failure", async () => {
    const statement = {
      bind: () => statement,
    };
    const database = {
      batch: () => Promise.resolve([{ success: false }]),
      prepare: () => statement,
    } as unknown as D1Database;
    const live = ControlPlaneBatchLive.pipe(
      Layer.provide(
        Layer.succeed(
          ControlPlaneD1Binding,
          ControlPlaneD1Binding.of({ database })
        )
      )
    );

    const error = await Effect.runPromise(
      ControlPlaneBatch.pipe(
        Effect.flatMap((batch) => batch.execute([{ sql: "select 1" }])),
        Effect.flip,
        Effect.provide(live)
      )
    );

    expect(error).toBeInstanceOf(ControlPlaneBatchError);
    expect(error).toMatchObject({
      cause: "D1 batch statement failed",
      commitState: "not-committed",
      statement: 0,
    });
  });
});
