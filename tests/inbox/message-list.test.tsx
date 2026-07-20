// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MailboxMessageQueryState } from "#/inbox/mailbox-view-links";
import type {
  MessageListItemData,
  MessageRowAction,
} from "#/inbox/message-list";
import { MessageList } from "#/inbox/message-list";

const messages = {
  items: [
    {
      activityAt: 2000,
      direction: "inbound" as const,
      folderId: "inbox",
      hasAttachments: true,
      id: "message-b",
      read: false,
      recipients: [{ address: "owner@example.test" }],
      sender: { address: "sender@example.test", displayName: "Second" },
      snippet: "Newest message",
      starred: false,
      subject: "Second subject",
      threadId: "thread-shared",
      version: 1,
    },
    {
      activityAt: 1000,
      direction: "inbound" as const,
      folderId: "inbox",
      hasAttachments: false,
      id: "message-a",
      read: true,
      recipients: [{ address: "owner@example.test" }],
      sender: { address: "sender@example.test", displayName: "First" },
      snippet: "Older message",
      starred: false,
      subject: "First subject",
      threadId: "thread-shared",
      version: 2,
    },
  ],
  nextCursor: "next-page",
};

describe(MessageList, () => {
  afterEach(cleanup);

  it("preserves server order and keeps the folder context in thread links", () => {
    const onLoadMore = vi.fn<() => void>();
    const onOpenMessage =
      vi.fn<(threadId: string, messageId: string) => void>();
    render(
      <MessageList
        data={messages}
        filters={{ query: "invoice", starred: true }}
        isLoadingMore={false}
        loadMoreFailed={false}
        onLoadMore={onLoadMore}
        onMessageAction={vi.fn<
          (action: MessageRowAction, message: MessageListItemData) => void
        >()}
        onOpenMessage={onOpenMessage}
        onQueryChange={vi.fn<(state: MailboxMessageQueryState) => void>()}
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
      "/inbox?folder=inbox&thread=thread-shared&message=message-b&q=invoice&starred=true",
      "/inbox?folder=inbox&thread=thread-shared&message=message-a&q=invoice&starred=true",
    ]);
    expect(links).toHaveLength(2);
    fireEvent.click(
      screen.getByRole("link", { name: "Second: Second subject" })
    );
    expect(onOpenMessage).toHaveBeenCalledWith("thread-shared", "message-b");
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(onLoadMore).toHaveBeenCalledOnce();
  });

  it("submits search and filter controls as one query state", () => {
    const onQueryChange = vi.fn<(state: MailboxMessageQueryState) => void>();
    render(
      <MessageList
        data={{ items: [] }}
        filters={{}}
        isLoadingMore={false}
        loadMoreFailed={false}
        onLoadMore={vi.fn<() => void>()}
        onMessageAction={vi.fn<
          (action: MessageRowAction, message: MessageListItemData) => void
        >()}
        onOpenMessage={vi.fn<(threadId: string, messageId: string) => void>()}
        onQueryChange={onQueryChange}
        selection={{ label: "work" }}
      />
    );

    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search messages" }),
      {
        target: { value: "  quarterly report  " },
      }
    );
    fireEvent.change(screen.getByRole("combobox", { name: "Read status" }), {
      target: { value: "unread" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Starred" }));
    fireEvent.click(screen.getByRole("button", { name: "Files" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(onQueryChange).toHaveBeenCalledWith({
      hasAttachment: true,
      query: "quarterly report",
      read: "unread",
      starred: true,
    });
  });

  it("dispatches row actions without opening the message", () => {
    const onMessageAction =
      vi.fn<(action: MessageRowAction, message: MessageListItemData) => void>();
    const onOpenMessage =
      vi.fn<(threadId: string, messageId: string) => void>();
    render(
      <MessageList
        data={{ items: [messages.items[0]] }}
        filters={{}}
        isLoadingMore={false}
        loadMoreFailed={false}
        onLoadMore={vi.fn<() => void>()}
        onMessageAction={onMessageAction}
        onOpenMessage={onOpenMessage}
        onQueryChange={vi.fn<(state: MailboxMessageQueryState) => void>()}
        selection={{ folder: "inbox" }}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Add star" }));

    expect(onMessageAction).toHaveBeenCalledWith("star", messages.items[0]);
    expect(onOpenMessage).not.toHaveBeenCalled();
  });

  it("rejects searches without an FTS term before navigation", () => {
    const onQueryChange = vi.fn<(state: MailboxMessageQueryState) => void>();
    render(
      <MessageList
        data={{ items: [] }}
        filters={{}}
        isLoadingMore={false}
        loadMoreFailed={false}
        onLoadMore={vi.fn<() => void>()}
        onMessageAction={vi.fn<
          (action: MessageRowAction, message: MessageListItemData) => void
        >()}
        onOpenMessage={vi.fn<(threadId: string, messageId: string) => void>()}
        onQueryChange={onQueryChange}
        selection={{ folder: "inbox" }}
      />
    );

    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search messages" }),
      {
        target: { value: "!!!" },
      }
    );
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(onQueryChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain(
      "Enter at least one letter or number"
    );
  });
});
