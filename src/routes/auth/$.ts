import { createFileRoute } from "@tanstack/react-router";

import { websiteBackend } from "../../server/backend";

export const Route = createFileRoute("/auth/$")({
  server: {
    handlers: {
      ANY: ({ request }) =>
        websiteBackend.forward("website.auth.backend", request),
    },
  },
});
