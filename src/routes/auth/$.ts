import { createFileRoute } from "@tanstack/react-router";

import { WebsiteApplication } from "#/apps/website/WebsiteApplication";

type AuthForward = (operation: string, request: Request) => Promise<Response>;

export const forwardPrivateAuthResponse = async (
  request: Request,
  forward: AuthForward = WebsiteApplication.forward
) => {
  const backendResponse = await forward("website.auth.backend", request);
  const response = new Response(backendResponse.body, backendResponse);
  response.headers.set("cache-control", "private, no-store");
  response.headers.set("pragma", "no-cache");
  return response;
};

export const Route = createFileRoute("/auth/$")({
  server: {
    handlers: {
      ANY: ({ request }) => forwardPrivateAuthResponse(request),
    },
  },
});
