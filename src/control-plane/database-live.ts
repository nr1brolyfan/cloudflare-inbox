import * as D1Client from "@effect/sql-d1/D1Client";
import * as DrizzleD1 from "drizzle-orm/effect-d1";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { relations } from "../auth/schema/index.js";
import { BackendResources } from "../http/backend-context";
import { ControlPlaneBatchLive } from "./batch-live";
import { ControlPlaneD1Binding, ControlPlaneDatabase } from "./database";

export const ControlPlaneD1BindingLive = Layer.effect(
  ControlPlaneD1Binding,
  Effect.gen(function* () {
    const resources = yield* BackendResources;
    return ControlPlaneD1Binding.of({ database: resources.database });
  })
);

export const ControlPlaneDatabaseLive = Layer.unwrap(
  Effect.gen(function* () {
    const resources = yield* BackendResources;
    const clientLive = D1Client.layer({ db: resources.database }).pipe(
      Layer.orDie
    );

    return Layer.effect(
      ControlPlaneDatabase,
      DrizzleD1.makeWithDefaults({ relations })
    ).pipe(Layer.provide(clientLive));
  })
);

export const ControlPlaneLive = Layer.mergeAll(
  ControlPlaneD1BindingLive,
  ControlPlaneDatabaseLive,
  ControlPlaneBatchLive.pipe(Layer.provide(ControlPlaneD1BindingLive))
);
