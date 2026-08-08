import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/mail/")({
  // oxlint-disable-next-line eslint/arrow-body-style -- TanStack requires throwing its non-Error redirect control object.
  beforeLoad: () => {
    // oxlint-disable-next-line typescript/only-throw-error -- TanStack Router uses a thrown redirect control object.
    throw redirect({ replace: true, to: "/mail/inbox" });
  },
});
