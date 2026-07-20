// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MailboxShell } from "#/inbox/mailbox-shell";

const folders = [
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
        mailboxName="Primary Inbox"
        principalLabel="user-123"
        isSigningOut={false}
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
      navigation: Boolean(screen.getByRole("navigation", { name: "Mailbox" })),
    }).toStrictEqual({ content: true, heading: true, navigation: true });
    expect(
      screen.getByRole("link", { name: /Inbox/u }).getAttribute("aria-current")
    ).toBe("page");
    expect(
      screen.getByRole("link", { name: "Archive" }).getAttribute("href")
    ).toBe("/inbox?folder=archive&delivery=delivery-1");
    expect(
      screen.getByRole("link", { name: "Work & travel" }).getAttribute("href")
    ).toBe("/inbox?label=label-work&delivery=delivery-1");

    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(signOut).toHaveBeenCalledOnce();
  });

  it("opens and closes the mobile navigation without leaving a hidden dialog", () => {
    render(
      <MailboxShell
        folders={folders}
        labels={[]}
        mailboxName="Primary Inbox"
        principalLabel="user-123"
        isSigningOut={false}
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

    fireEvent.click(openNavigation);
    expect(openNavigation.getAttribute("aria-expanded")).toBe("true");
    expect(
      screen.getByRole("dialog", { name: "Mailbox navigation" })
    ).toBeTruthy();
    expect(screen.getAllByText("No labels yet")).toHaveLength(2);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(
      screen.queryByRole("dialog", { name: "Mailbox navigation" })
    ).toBeNull();
  });

  it("keeps mailbox content visible during a failed sign-out", () => {
    const signOut = vi.fn<() => void>();
    render(
      <MailboxShell
        folders={folders}
        labels={labels}
        mailboxName="Primary Inbox"
        principalLabel="user-123"
        isSigningOut
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
