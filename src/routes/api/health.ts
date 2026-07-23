import { createFileRoute } from "@tanstack/react-router";

import { WebsiteApplication } from "#/apps/website/WebsiteApplication";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: ({ request }) =>
        WebsiteApplication.forward("website.health.backend", request),
    },
  },
});
