import { createFileRoute } from "@tanstack/react-router";
import * as Effect from "effect/Effect";

import { BackendClient } from "../../server/backend-client";
import { BackendClientLive } from "../../server/backend-client-live";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: ({ request }) =>
        Effect.runPromise(
          BackendClient.pipe(
            Effect.flatMap((backend) =>
              backend.fetch("website.health.backend", request)
            ),
            Effect.provide(BackendClientLive)
          )
        ),
    },
  },
});
