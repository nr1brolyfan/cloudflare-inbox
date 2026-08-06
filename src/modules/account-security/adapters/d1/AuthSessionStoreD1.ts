import { makeD1SqlitePasswordSessionCommitStore } from "@effect-auth/core/D1SqlitePasswordSessionCommitStore";
import { makeDrizzleSqliteSessionStore } from "@effect-auth/core/DrizzleSqliteSessionStore";
import { SessionStore } from "@effect-auth/core/SessionStorage";
import { PasswordSessionCommitStore } from "@effect-auth/core/Storage";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  ControlPlaneD1Binding,
  ControlPlaneDatabase,
} from "#/platform/control-plane-d1/ControlPlaneDatabase";

import { effectAuthD1Database } from "./EffectAuthD1Database";

/** Session-only auth storage for request paths that must avoid the full store graph. */
export const EffectAuthSessionStoreD1Layer = Layer.unwrap(
  Effect.gen(function* () {
    const database = yield* ControlPlaneDatabase;
    const d1 = yield* ControlPlaneD1Binding;
    return Layer.merge(
      Layer.succeed(SessionStore, makeDrizzleSqliteSessionStore(database)),
      Layer.succeed(
        PasswordSessionCommitStore,
        makeD1SqlitePasswordSessionCommitStore(
          effectAuthD1Database(d1.database)
        )
      )
    );
  })
);
