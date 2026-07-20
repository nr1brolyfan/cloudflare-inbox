// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ThreadView } from "#/inbox/thread-view";

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
    const { container } = render(
      <ThreadView data={thread} selection={{ label: "work" }} />
    );

    expect(screen.getByText(maliciousText)).toBeTruthy();
    expect(screen.getByText('<img src=x onerror="pwn()">.txt')).toBeTruthy();
    expect(container.querySelector("script, img")).toBeNull();
    expect(
      screen.getByText(
        "This message has an HTML body. Secure preview is not available yet."
      )
    ).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Close conversation" })
        .getAttribute("href")
    ).toBe("/inbox?label=work");
  });
});
