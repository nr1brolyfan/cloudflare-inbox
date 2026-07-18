import { tracing } from "cloudflare:workers";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { BackendClient } from "./backend-client";
import { env } from "./env";

/** Cloudflare implementation that traces every Website-to-Backend binding call. */
export const BackendClientLive = Layer.succeed(
  BackendClient,
  BackendClient.of({
    fetch: (operation, request) =>
      Effect.promise(() =>
        tracing.enterSpan(operation, (span) => {
          if (span.isTraced) {
            const url = new URL(request.url);
            span.setAttribute("http.request.method", request.method);
            span.setAttribute("url.path", url.pathname);
          }

          return env.BACKEND.fetch(request);
        })
      ),
  })
);
