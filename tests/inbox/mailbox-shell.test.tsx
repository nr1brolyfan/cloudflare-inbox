// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MailboxShell } from "#/inbox/mailbox-shell";

describe(MailboxShell, () => {
  afterEach(cleanup);

  it("renders the mailbox chrome and workspace content", () => {
    const signOut = vi.fn<() => void>();

    render(
      <MailboxShell
        mailboxName="Primary Inbox"
        principalLabel="user-123"
        isSigningOut={false}
        onSignOut={signOut}
      >
        <p>Workspace content</p>
      </MailboxShell>
    );

    expect(
      screen.getByRole("heading", { level: 1, name: "Inbox" })
    ).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Mailbox" })).toBeTruthy();
    expect(screen.getByText("Workspace content")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(signOut).toHaveBeenCalledOnce();
  });

  it("opens and closes the mobile navigation without leaving a hidden dialog", () => {
    render(
      <MailboxShell
        mailboxName="Primary Inbox"
        principalLabel="user-123"
        isSigningOut={false}
        onSignOut={vi.fn<() => void>()}
      >
        <p>Workspace content</p>
      </MailboxShell>
    );

    const openNavigation = screen.getByRole("button", {
      name: "Open mailbox navigation",
    });

    expect(openNavigation.getAttribute("aria-expanded")).toBe("false");
    expect(
      screen.queryByRole("dialog", { name: "Mailbox navigation" })
    ).toBeNull();

    fireEvent.click(openNavigation);
    expect(openNavigation.getAttribute("aria-expanded")).toBe("true");
    expect(
      screen.getByRole("dialog", { name: "Mailbox navigation" })
    ).toBeTruthy();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(
      screen.queryByRole("dialog", { name: "Mailbox navigation" })
    ).toBeNull();
  });
});
