// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  NoThreadSelected,
  ThreadView,
} from "#/modules/mailbox/adapters/react/ThreadView";

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
      replyEligible: true,
      sender: { address: "sender@example.test", displayName: "Sender" },
      textBody: maliciousText,
      to: [{ address: "owner@example.test" }],
    },
    {
      activityAt: 2000,
      attachments: [],
      cc: [],
      direction: "outbound" as const,
      hasHtmlBody: true,
      id: "message-2",
      read: true,
      replyEligible: false,
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

    expect([
      Boolean(screen.getByText(maliciousText)),
      Boolean(screen.getByText('<img src=x onerror="pwn()">.txt')),
    ]).toStrictEqual([true, true]);
    expect({
      activeContent: container.querySelector("script, img"),
      outbound: container.querySelector('[data-direction="outbound"]')
        ?.textContent,
    }).toStrictEqual({
      activeContent: null,
      outbound: expect.stringContaining("You"),
    });
    expect(
      screen
        .getByRole("link", {
          name: 'Download <img src=x onerror="pwn()">.txt',
        })
        .getAttribute("href")
    ).toBe(
      "/api/mailboxes/primary/messages/message-1/attachments/attachment-1/download?label=work"
    );
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
    ).toBe("/mail/labels/work?read=unread&delivery=delivery-1");
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

  it("offers reply only for eligible inbound messages and excludes outbound", () => {
    const onReply = vi.fn<(messageId: string) => void>();
    render(
      <ThreadView
        data={thread}
        filters={{}}
        mailboxId="primary"
        onClose={vi.fn<() => void>()}
        onReply={onReply}
        replyError={{ messageId: "message-1", retryable: true }}
        selection={{ folder: "inbox" }}
      />
    );

    const actions = screen.getAllByRole("button", { name: /reply/iu });
    expect(actions).toHaveLength(1);
    fireEvent.click(actions[0] as HTMLButtonElement);
    expect(onReply).toHaveBeenCalledWith("message-1");
    expect(screen.getByRole("alert").textContent).toContain(
      "Reply draft could not be created"
    );
  });

  it("collapses and styles nested plain-text quotes", () => {
    const quotedBody = [
      "This is the new reply.",
      "",
      "On Friday, Sender <sender@example.test> wrote:",
      "",
      "> Previous reply",
      ">",
      "> > Older reply",
      "> > > Oldest reply",
    ].join("\n");
    const { container } = render(
      <ThreadView
        data={{
          hasMore: false,
          messages: [
            {
              ...thread.messages[0],
              attachments: [],
              hasHtmlBody: false,
              textBody: quotedBody,
            },
          ],
          thread: { ...thread.thread, messageCount: 1, unreadCount: 1 },
        }}
        filters={{}}
        mailboxId="primary"
        onClose={vi.fn<() => void>()}
        selection={{ folder: "inbox" }}
      />
    );

    expect({
      authored: Boolean(screen.getByText("This is the new reply.")),
      collapsed: screen.queryByText("Previous reply"),
    }).toStrictEqual({ authored: true, collapsed: null });

    fireEvent.click(screen.getByRole("button", { name: "Show quoted text" }));

    expect({
      attribution: Boolean(screen.getByText(/On Friday.+wrote:/u)),
      nestedDepth: container.querySelector('[data-quote-depth="3"]')
        ?.textContent,
      quoteMarkers: container.textContent?.includes("> Previous reply"),
    }).toStrictEqual({
      attribution: true,
      nestedDepth: "Oldest reply",
      quoteMarkers: false,
    });

    fireEvent.click(screen.getByRole("button", { name: "Hide quoted text" }));
    expect(screen.queryByText("Previous reply")).toBeNull();
  });

  it.each([
    ["folder", { folder: "inbox" } as const],
    ["label", { label: "work" } as const],
  ])(
    "hides Reply for inbound messages outside the selected %s",
    (_, selection) => {
      render(
        <ThreadView
          data={{
            ...thread,
            messages: [
              {
                ...thread.messages[0],
                attachments: [],
                replyEligible: false,
              },
            ],
            thread: { ...thread.thread, messageCount: 1, unreadCount: 1 },
          }}
          filters={{}}
          mailboxId="primary"
          onClose={vi.fn<() => void>()}
          onReply={vi.fn<(messageId: string) => void>()}
          selection={selection}
        />
      );

      expect(screen.queryByRole("button", { name: "Reply" })).toBeNull();
    }
  );

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
