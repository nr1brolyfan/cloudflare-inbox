import { createFileRoute } from "@tanstack/react-router";

import { websiteBackend } from "../../server/backend";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: ({ request }) =>
        websiteBackend.forward("website.health.backend", request),
    },
  },
});
