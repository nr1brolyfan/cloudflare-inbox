import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { BackendHealth } from "../observability/health";
import { BackendHttpApi } from "./api";

/** Encodes BackendHealth results through the shared BackendHttpApi contract. */
export const HealthGroupLive = HttpApiBuilder.group(
  BackendHttpApi,
  "health",
  Effect.fn("backend.http.health_group")(function* (handlers) {
    const health = yield* BackendHealth;

    return handlers.handle("get", () => health.check);
  })
);
