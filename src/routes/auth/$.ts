import { createFileRoute } from "@tanstack/react-router";

import { WebsiteApplication } from "#/apps/website/WebsiteApplication";

export const Route = createFileRoute("/auth/$")({
  server: {
    handlers: {
      ANY: ({ request }) =>
        WebsiteApplication.forward("website.auth.backend", request),
    },
  },
});
