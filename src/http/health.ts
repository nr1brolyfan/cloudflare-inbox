import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { BackendHttpApi } from "./api";
import type { BackendHealthReport } from "./health-contract";

export type { BackendHealthReport, StorageHealth } from "./health-contract";

export interface BackendHealth {
  readonly check: Effect.Effect<BackendHealthReport>;
}

/** Domain health probe used by the HTTP group; it does not encode responses. */
export const BackendHealth = Context.Service<BackendHealth>(
  "cloudflare-inbox/BackendHealth"
);

/** Encodes BackendHealth results through the shared BackendHttpApi contract. */
export const HealthGroupLive = HttpApiBuilder.group(
  BackendHttpApi,
  "health",
  Effect.fn("backend.http.health_group")(function* (handlers) {
    const health = yield* BackendHealth;

    return handlers.handle("get", () => health.check);
  })
);
