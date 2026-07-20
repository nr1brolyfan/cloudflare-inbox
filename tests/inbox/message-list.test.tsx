// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { MessageList } from "#/inbox/message-list";

const messages = {
  hasMore: true,
  items: [
    {
      activityAt: 2000,
      direction: "inbound" as const,
      hasAttachments: true,
      id: "message-b",
      read: false,
      recipients: [{ address: "owner@example.test" }],
      sender: { address: "sender@example.test", displayName: "Second" },
      snippet: "Newest message",
      starred: false,
      subject: "Second subject",
      threadId: "thread-shared",
    },
    {
      activityAt: 1000,
      direction: "inbound" as const,
      hasAttachments: false,
      id: "message-a",
      read: true,
      recipients: [{ address: "owner@example.test" }],
      sender: { address: "sender@example.test", displayName: "First" },
      snippet: "Older message",
      starred: false,
      subject: "First subject",
      threadId: "thread-shared",
    },
  ],
};

describe(MessageList, () => {
  afterEach(cleanup);

  it("preserves server order and keeps the folder context in thread links", () => {
    render(
      <MessageList
        data={messages}
        selection={{ folder: "inbox" }}
        selectedThreadId="thread-shared"
      />
    );

    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.getAttribute("aria-label"))).toStrictEqual([
      "Second: Second subject",
      "First: First subject",
    ]);
    expect(links.map((link) => link.getAttribute("href"))).toStrictEqual([
      "/inbox?folder=inbox&thread=thread-shared&message=message-b",
      "/inbox?folder=inbox&thread=thread-shared&message=message-a",
    ]);
    expect(links).toHaveLength(2);
    expect(screen.getByText("More messages are available")).toBeTruthy();
  });
});
