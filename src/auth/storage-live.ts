import { makeDrizzleEffectSqliteExecutor } from "@effect-auth/core/DrizzleEffectSqliteStorage";
import {
  EffectQbSqliteAuthStorageLive,
  makeD1EffectQbSqliteAtomicPlanExecutor,
} from "@effect-auth/core/EffectQbSqliteStorage";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  ControlPlaneD1Binding,
  ControlPlaneDatabase,
} from "../control-plane/database";

/** Shared auth stores use Drizzle for queries and raw D1 only for atomic plans. */
export const EffectAuthStorageLive = Layer.unwrap(
  Effect.gen(function* () {
    const database = yield* ControlPlaneDatabase;
    const d1 = yield* ControlPlaneD1Binding;

    return EffectQbSqliteAuthStorageLive(
      makeDrizzleEffectSqliteExecutor(database),
      makeD1EffectQbSqliteAtomicPlanExecutor(d1.database)
    );
  })
);
