import { describe, expect, it, vi } from "vitest";

import { forwardMailboxEventsResponse } from "#/routes/api/mailboxes/$mailboxId/events";

describe(forwardMailboxEventsResponse, () => {
  it("returns the backend response object without reconstructing the upgrade", async () => {
    const request = new Request(
      "https://inbox.test/api/mailboxes/primary/events",
      { headers: { upgrade: "websocket" } }
    );
    const backendResponse = new Response(null, { status: 204 });
    const forward = vi
      .fn<(operation: string, incoming: Request) => Promise<Response>>()
      .mockResolvedValue(backendResponse);

    const response = await forwardMailboxEventsResponse(request, forward);

    expect(response).toBe(backendResponse);
    expect(forward).toHaveBeenCalledWith(
      "website.mailbox.events.backend",
      request
    );
  });
});
