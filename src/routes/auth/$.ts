import { createFileRoute } from "@tanstack/react-router";

import { env } from "../../server/env";
import { traceBackendRequest } from "../../server/tracing";

export const Route = createFileRoute("/auth/$")({
  server: {
    handlers: {
      ANY: ({ request }) =>
        traceBackendRequest("website.auth.backend", request, () =>
          env.BACKEND.fetch(request)
        ),
    },
  },
});
