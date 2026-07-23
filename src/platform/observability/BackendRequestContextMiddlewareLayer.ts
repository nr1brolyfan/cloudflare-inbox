import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { CurrentBackendRequestContext } from "#/shared/BackendRequestContext";

import { BackendRequestContextMiddleware } from "./BackendRequestContextMiddleware";

/** Captures the fetch-owned context and supplies it to mailbox/admin handlers. */
export const BackendRequestContextMiddlewareLayer = Layer.effect(
  BackendRequestContextMiddleware,
  Effect.gen(function* () {
    const context = yield* CurrentBackendRequestContext;
    return (httpEffect) =>
      httpEffect.pipe(
        Effect.provideService(CurrentBackendRequestContext, context)
      );
  })
);
