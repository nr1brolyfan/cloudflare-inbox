import * as D1Client from "@effect/sql-d1/D1Client";
import * as DrizzleD1 from "drizzle-orm/effect-d1";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { relations } from "../../auth/schema/index.js";

export interface ControlPlaneD1Binding {
  readonly database: D1Database;
}

/** Raw D1 is exposed only for Cloudflare's atomic batch primitive. */
export const ControlPlaneD1Binding = Context.Service<ControlPlaneD1Binding>(
  "cloudflare-inbox/ControlPlaneD1Binding"
);

export type ControlPlaneDatabase = DrizzleD1.EffectSQLiteD1Database<
  typeof relations
> & {
  readonly $client: D1Client.D1Client;
};

/** Effect-native Drizzle client for ordinary control-plane queries. */
export const ControlPlaneDatabase = Context.Service<ControlPlaneDatabase>(
  "cloudflare-inbox/ControlPlaneDatabase"
);

/** Effect-native Drizzle adapter built directly from the raw D1 binding. */
export const ControlPlaneDatabaseLayer = Layer.unwrap(
  Effect.gen(function* () {
    const { database } = yield* ControlPlaneD1Binding;
    const clientLayer = D1Client.layer({ db: database }).pipe(Layer.orDie);

    return Layer.effect(
      ControlPlaneDatabase,
      DrizzleD1.makeWithDefaults({ relations })
    ).pipe(Layer.provide(clientLayer));
  })
);
