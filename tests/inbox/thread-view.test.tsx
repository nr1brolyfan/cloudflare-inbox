// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NoThreadSelected, ThreadView } from "#/inbox/thread-view";

const maliciousText =
  '<script>window.pwned = true</script><img onerror="pwn()">';
const thread = {
  hasMore: false,
  messages: [
    {
      activityAt: 1000,
      attachments: [
        {
          disposition: "attachment" as const,
          fileName: '<img src=x onerror="pwn()">.txt',
          id: "attachment-1",
          mimeType: "text/plain",
          size: 512,
        },
      ],
      cc: [],
      direction: "inbound" as const,
      hasHtmlBody: true,
      id: "message-1",
      read: false,
      sender: { address: "sender@example.test", displayName: "Sender" },
      textBody: maliciousText,
      to: [{ address: "owner@example.test" }],
    },
    {
      activityAt: 2000,
      attachments: [],
      cc: [],
      direction: "inbound" as const,
      hasHtmlBody: true,
      id: "message-2",
      read: true,
      sender: { address: "sender@example.test" },
      to: [{ address: "owner@example.test" }],
    },
  ],
  thread: {
    id: "thread-1",
    latestActivityAt: 2000,
    messageCount: 2,
    subject: "Potentially hostile content",
    unreadCount: 1,
  },
};

describe(ThreadView, () => {
  afterEach(cleanup);

  it("renders message and attachment content as inert text", () => {
    const onClose = vi.fn<() => void>();
    const { container } = render(
      <ThreadView
        data={thread}
        filters={{ delivery: "delivery-1", read: "unread" }}
        mailboxId="primary"
        onClose={onClose}
        selection={{ label: "work" }}
      />
    );

    expect(screen.getByText(maliciousText)).toBeTruthy();
    expect(screen.getByText('<img src=x onerror="pwn()">.txt')).toBeTruthy();
    expect(container.querySelector("script, img")).toBeNull();
    const iframe = screen.getByTitle(
      "Sandboxed HTML message from sender@example.test"
    );
    expect({
      referrerPolicy: iframe.getAttribute("referrerpolicy"),
      sandbox: iframe.getAttribute("sandbox"),
      src: iframe.getAttribute("src"),
    }).toStrictEqual({
      referrerPolicy: "no-referrer",
      sandbox: "allow-popups allow-popups-to-escape-sandbox allow-same-origin",
      src: "/api/mailboxes/primary/messages/message-2/html?label=work",
    });
    expect(
      screen
        .getByRole("link", { name: "Close conversation" })
        .getAttribute("href")
    ).toBe("/inbox?label=work&read=unread&delivery=delivery-1");
  });

  it("closes a conversation without a document navigation", () => {
    const onClose = vi.fn<() => void>();
    render(
      <ThreadView
        data={thread}
        filters={{ read: "unread" }}
        mailboxId="primary"
        onClose={onClose}
        selection={{ label: "work" }}
      />
    );

    screen.getByRole("link", { name: "Close conversation" }).click();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("renders the no-conversation-selected empty state", () => {
    render(<NoThreadSelected />);

    expect(screen.getByText("Choose a message")).toBeTruthy();
  });

  it("offers an iframe retry after a preview network failure", () => {
    render(
      <ThreadView
        data={thread}
        filters={{}}
        mailboxId="primary"
        onClose={vi.fn<() => void>()}
        selection={{ folder: "inbox" }}
      />
    );
    const iframe = screen.getByTitle(
      "Sandboxed HTML message from sender@example.test"
    );

    const previewDocument = (iframe as HTMLIFrameElement).contentDocument;
    if (previewDocument === null) {
      throw new Error("Expected iframe document");
    }
    const previewRoot = previewDocument.createElement("html");
    previewRoot.dataset["previewStatus"] = "502";
    previewDocument.append(previewRoot);
    fireEvent.load(iframe);
    expect(screen.getByRole("alert").textContent).toContain(
      "Secure HTML preview could not be loaded"
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(iframe.getAttribute("src")).toContain("previewRetry=1");
  });

  it("reports authoritative preview access failures to the parent", () => {
    const onPreviewAccessFailure = vi.fn<(status: 401 | 403) => void>();
    render(
      <ThreadView
        data={thread}
        filters={{}}
        mailboxId="primary"
        onClose={vi.fn<() => void>()}
        onPreviewAccessFailure={onPreviewAccessFailure}
        selection={{ folder: "inbox" }}
      />
    );
    const iframe = screen.getByTitle(
      "Sandboxed HTML message from sender@example.test"
    );
    if (!(iframe instanceof HTMLIFrameElement)) {
      throw new Error("Expected iframe element");
    }
    const previewDocument = iframe.contentDocument;
    if (previewDocument === null) {
      throw new Error("Expected iframe document");
    }
    const previewRoot = previewDocument.createElement("html");
    previewRoot.dataset["previewStatus"] = "401";
    previewRoot.dataset["previewAccessFailure"] = "401";
    previewDocument.append(previewRoot);

    fireEvent.load(iframe);

    expect({
      ariaHidden: iframe.getAttribute("aria-hidden"),
      callback: onPreviewAccessFailure.mock.calls,
      inert: iframe.hasAttribute("inert"),
    }).toStrictEqual({
      ariaHidden: "true",
      callback: [[401]],
      inert: true,
    });
  });
});
