// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MailboxShell } from "#/modules/mailbox/adapters/react/MailboxShell";

const folders = [
  {
    createdAt: 1000,
    id: "drafts",
    kind: "drafts" as const,
    mailboxId: "primary",
    messageCount: 3,
    name: "Drafts",
    unreadCount: 0,
    updatedAt: 1000,
    version: 1,
  },
  {
    createdAt: 1000,
    id: "sent",
    kind: "sent" as const,
    mailboxId: "primary",
    messageCount: 8,
    name: "Sent",
    unreadCount: 4,
    updatedAt: 1000,
    version: 1,
  },
  {
    createdAt: 1000,
    id: "scheduled",
    kind: "scheduled" as const,
    mailboxId: "primary",
    messageCount: 2,
    name: "Scheduled",
    unreadCount: 0,
    updatedAt: 1000,
    version: 1,
  },
  {
    createdAt: 1000,
    id: "inbox",
    kind: "inbox" as const,
    mailboxId: "primary",
    messageCount: 4,
    name: "Inbox",
    unreadCount: 2,
    updatedAt: 1000,
    version: 1,
  },
  {
    createdAt: 1000,
    id: "archive",
    kind: "archive" as const,
    mailboxId: "primary",
    messageCount: 3,
    name: "Archive",
    unreadCount: 0,
    updatedAt: 1000,
    version: 1,
  },
] as const;
const labels = [
  {
    createdAt: 1000,
    id: "label-work",
    mailboxId: "primary",
    name: "Work & travel",
    updatedAt: 1000,
    version: 1,
  },
] as const;

describe(MailboxShell, () => {
  afterEach(cleanup);

  it("renders the mailbox chrome and workspace content", () => {
    const signOut = vi.fn<() => void>();

    render(
      <MailboxShell
        folders={folders}
        labels={labels}
        mailboxAddress="inbox@example.com"
        mailboxName="Primary Inbox"
        principalLabel="user-123"
        isSigningOut={false}
        onNavigate={vi.fn<
          (selection: { folder?: string; label?: string }) => void
        >()}
        onPrefetch={vi.fn<
          (selection: { folder?: string; label?: string }) => void
        >()}
        onSignOut={signOut}
        outboundDeliveryId="delivery-1"
        selectedFolderId="inbox"
        viewTitle="Inbox"
      >
        <p>Workspace content</p>
      </MailboxShell>
    );

    expect({
      content: Boolean(screen.getByText("Workspace content")),
      heading: Boolean(
        screen.getByRole("heading", { level: 1, name: "Inbox" })
      ),
      viewportLocked: document
        .querySelector("main")
        ?.classList.contains("fixed"),
      navigation: Boolean(screen.getByRole("navigation", { name: "Mailbox" })),
    }).toStrictEqual({
      content: true,
      heading: true,
      navigation: true,
      viewportLocked: true,
    });
    expect(
      screen.getByRole("link", { name: /Inbox/u }).getAttribute("aria-current")
    ).toBe("page");
    const archiveLink = screen.getByRole("link", { name: "Archive" });
    expect({
      archiveHref: archiveLink.getAttribute("href"),
      badge: Boolean(screen.getAllByLabelText("3 drafts")[0]),
      scheduledBadge: Boolean(screen.getAllByLabelText("2 scheduled")[0]),
      sentBadge: screen.queryByLabelText("4 unread"),
      labelHref: screen
        .getByRole("link", { name: "Work & travel" })
        .getAttribute("href"),
      title: screen
        .getAllByRole("link", { name: /Drafts/u })[0]
        ?.getAttribute("title"),
    }).toStrictEqual({
      archiveHref: "/mail/archive?delivery=delivery-1",
      badge: true,
      scheduledBadge: true,
      sentBadge: null,
      labelHref: "/mail/labels/label-work?delivery=delivery-1",
      title: "3 drafts",
    });

    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(signOut).toHaveBeenCalledOnce();
  });

  it("prefetches and opens mailbox views without a document navigation", () => {
    const navigate =
      vi.fn<(selection: { folder?: string; label?: string }) => void>();
    const prefetch =
      vi.fn<(selection: { folder?: string; label?: string }) => void>();
    render(
      <MailboxShell
        folders={folders}
        labels={labels}
        mailboxAddress="inbox@example.com"
        mailboxName="Primary Inbox"
        principalLabel="user-123"
        isSigningOut={false}
        onNavigate={navigate}
        onPrefetch={prefetch}
        onSignOut={vi.fn<() => void>()}
        selectedFolderId="inbox"
        viewTitle="Inbox"
      >
        <p>Workspace content</p>
      </MailboxShell>
    );

    const archiveLink = screen.getByRole("link", { name: "Archive" });
    fireEvent.mouseEnter(archiveLink);
    expect(prefetch).toHaveBeenCalledExactlyOnceWith({ folder: "archive" });
    expect(fireEvent.click(archiveLink)).toBeFalsy();
    expect(navigate).toHaveBeenCalledExactlyOnceWith({ folder: "archive" });

    const labelLink = screen.getByRole("link", { name: "Work & travel" });
    labelLink.addEventListener("click", (event) => event.preventDefault(), {
      once: true,
    });
    fireEvent.click(labelLink, { ctrlKey: true });
    expect(navigate).toHaveBeenCalledExactlyOnceWith({ folder: "archive" });
  });

  it("opens and closes the mobile navigation without leaving a hidden dialog", async () => {
    const navigate =
      vi.fn<(selection: { folder?: string; label?: string }) => void>();
    render(
      <MailboxShell
        folders={folders}
        labels={[]}
        mailboxAddress="inbox@example.com"
        mailboxName="Primary Inbox"
        principalLabel="user-123"
        isSigningOut={false}
        onNavigate={navigate}
        onPrefetch={vi.fn<
          (selection: { folder?: string; label?: string }) => void
        >()}
        onSignOut={vi.fn<() => void>()}
        selectedFolderId="inbox"
        viewTitle="Inbox"
      >
        <p>Workspace content</p>
      </MailboxShell>
    );

    const openNavigation = screen.getByRole("button", {
      name: "Open mailbox navigation",
    });

    expect({
      dialog: screen.queryByRole("dialog", { name: "Mailbox navigation" }),
      expanded: openNavigation.getAttribute("aria-expanded"),
    }).toStrictEqual({ dialog: null, expanded: "false" });

    openNavigation.focus();
    fireEvent.click(openNavigation);
    expect({
      dialog: Boolean(
        screen.getByRole("dialog", { name: "Mailbox navigation" })
      ),
      expanded: openNavigation.getAttribute("aria-expanded"),
      noLabels: screen.getAllByText("No labels yet").length,
    }).toStrictEqual({ dialog: true, expanded: "true", noLabels: 2 });

    fireEvent.click(
      within(
        screen.getByRole("dialog", { name: "Mailbox navigation" })
      ).getByRole("link", { name: "Archive" })
    );
    expect({
      dialog: screen.queryByRole("dialog", { name: "Mailbox navigation" }),
      navigateCalls: navigate.mock.calls,
    }).toStrictEqual({
      dialog: null,
      navigateCalls: [[{ folder: "archive" }]],
    });

    openNavigation.focus();
    fireEvent.click(openNavigation);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(
      screen.queryByRole("dialog", { name: "Mailbox navigation" })
    ).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(openNavigation));
  });

  it("keeps mailbox content visible during a failed sign-out", () => {
    const signOut = vi.fn<() => void>();
    render(
      <MailboxShell
        folders={folders}
        labels={labels}
        mailboxAddress="inbox@example.com"
        mailboxName="Primary Inbox"
        principalLabel="user-123"
        isSigningOut
        onNavigate={vi.fn<
          (selection: { folder?: string; label?: string }) => void
        >()}
        onPrefetch={vi.fn<
          (selection: { folder?: string; label?: string }) => void
        >()}
        onSignOut={signOut}
        selectedFolderId="inbox"
        signOutError="Sign out failed. Try again."
        viewTitle="Inbox"
      >
        <p>Workspace content</p>
      </MailboxShell>
    );

    const button = screen.getByRole("button", { name: "Sign out" });
    expect({
      alert: screen.getByRole("alert").textContent,
      content: Boolean(screen.getByText("Workspace content")),
      disabled: button.hasAttribute("disabled"),
    }).toStrictEqual({
      alert: "Sign out failed. Try again.",
      content: true,
      disabled: true,
    });
    fireEvent.click(button);
    expect(signOut).not.toHaveBeenCalled();
  });
});
