import { createFileRoute } from "@tanstack/react-router";
import * as Effect from "effect/Effect";

import { BackendClient } from "../../server/backend-client";
import { BackendClientLive } from "../../server/backend-client-live";

export const Route = createFileRoute("/auth/$")({
  server: {
    handlers: {
      ANY: ({ request }) =>
        Effect.runPromise(
          BackendClient.pipe(
            Effect.flatMap((backend) =>
              backend.fetch("website.auth.backend", request)
            ),
            Effect.provide(BackendClientLive)
          )
        ),
    },
  },
});
