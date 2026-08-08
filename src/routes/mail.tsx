import { createFileRoute, useRouterState } from "@tanstack/react-router";

import {
  decodeMailboxSearch,
  mailboxSearchForPath,
} from "#/modules/mailbox/adapters/react/MailboxRouting";

import { MailboxApplication } from "./inbox";

export const Route = createFileRoute("/mail")({
  component: MailLayoutRoute,
  validateSearch: decodeMailboxSearch,
});

function MailLayoutRoute() {
  const routeSearch = Route.useSearch();
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const settingsMode = pathname === "/mail/settings";
  const contactsMode = pathname === "/mail/contacts";

  return (
    <MailboxApplication
      search={mailboxSearchForPath(
        settingsMode || contactsMode ? "/mail/inbox" : pathname,
        routeSearch
      )}
      settingsMode={settingsMode}
      contactsMode={contactsMode}
    />
  );
}
