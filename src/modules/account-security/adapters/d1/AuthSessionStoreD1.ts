import { makeDrizzleEffectSqliteExecutor } from "@effect-auth/core/DrizzleEffectSqliteStorage";
import { makeEffectQbSqliteSessionStore } from "@effect-auth/core/EffectQbSqliteStorage";
import { SessionStore } from "@effect-auth/core/Storage";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ControlPlaneDatabase } from "#/platform/control-plane-d1/ControlPlaneDatabase";

/** Session-only auth storage for request paths that must avoid the full store graph. */
export const EffectAuthSessionStoreD1Layer = Layer.effect(
  SessionStore,
  Effect.gen(function* () {
    const database = yield* ControlPlaneDatabase;
    return makeEffectQbSqliteSessionStore(
      makeDrizzleEffectSqliteExecutor(database)
    );
  })
);
