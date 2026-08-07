import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/mail/")({
  beforeLoad: () => {
    throw redirect({ replace: true, to: "/mail/inbox" });
  },
});
