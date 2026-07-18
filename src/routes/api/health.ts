import { createFileRoute } from "@tanstack/react-router";

import { env } from "../../server/env";
import { traceBackendRequest } from "../../server/tracing";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: ({ request }) =>
        traceBackendRequest("website.health.backend", request, () =>
          env.BACKEND.fetch(request)
        ),
    },
  },
});
