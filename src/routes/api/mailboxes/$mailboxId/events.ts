import { createFileRoute } from "@tanstack/react-router";

import { WebsiteApplication } from "#/apps/website/WebsiteApplication";

export const forwardMailboxEventsResponse = (
  request: Request,
  forward = WebsiteApplication.forward
) => forward("website.mailbox.events.backend", request);

export const Route = createFileRoute("/api/mailboxes/$mailboxId/events")({
  server: {
    handlers: {
      GET: ({ request }) => forwardMailboxEventsResponse(request),
    },
  },
});
