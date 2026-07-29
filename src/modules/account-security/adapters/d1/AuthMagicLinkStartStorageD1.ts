import { makeDrizzleEffectSqliteVerificationStore } from "@effect-auth/core/DrizzleEffectSqliteVerificationStore";
import { VerificationStore } from "@effect-auth/core/Storage";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ControlPlaneDatabase } from "#/platform/control-plane-d1/ControlPlaneDatabase";

/** Challenge storage only; magic-link start does not need the complete auth store set. */
export const EffectAuthVerificationStoreD1Layer = Layer.effect(
  VerificationStore,
  Effect.gen(function* () {
    const database = yield* ControlPlaneDatabase;
    return makeDrizzleEffectSqliteVerificationStore(database);
  })
);
