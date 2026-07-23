import * as Effect from "effect/Effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { BackendHealth } from "../BackendHealth";
import { BackendHealthHttpApi } from "./BackendHealthHttpApi";

/** Encodes BackendHealth results through the shared health contract. */
export const BackendHealthHttpHandlersLayer = HttpApiBuilder.group(
  BackendHealthHttpApi,
  "health",
  Effect.fn("backend.http.health_group")(function* (handlers) {
    const health = yield* BackendHealth;

    return handlers.handle("get", () => health.check);
  })
);
