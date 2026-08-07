// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MailboxMessageQueryState } from "#/modules/mailbox/adapters/react/MailboxViewLinks";
import type {
  MessageListItemData,
  MessageRowAction,
} from "#/modules/mailbox/adapters/react/MessageList";
import { MessageList } from "#/modules/mailbox/adapters/react/MessageList";

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
        filters={{ delivery: "delivery-1", query: "invoice", starred: true }}
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
      "/mail/inbox?message=message-b&thread=thread-shared&q=invoice&starred=true&delivery=delivery-1",
      "/mail/inbox?message=message-a&thread=thread-shared&q=invoice&starred=true&delivery=delivery-1",
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
        filters={{ delivery: "delivery-1" }}
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
      delivery: "delivery-1",
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

  it("renders distinct empty states for views and active filters", () => {
    const props = {
      data: { items: [] },
      isLoadingMore: false,
      loadMoreFailed: false,
      onLoadMore: vi.fn<() => void>(),
      onMessageAction:
        vi.fn<
          (action: MessageRowAction, message: MessageListItemData) => void
        >(),
      onOpenMessage: vi.fn<(threadId: string, messageId: string) => void>(),
      onQueryChange: vi.fn<(state: MailboxMessageQueryState) => void>(),
      selection: { folder: "inbox" } as const,
    };
    const { rerender } = render(<MessageList {...props} filters={{}} />);

    expect(screen.getByText("No messages here")).toBeTruthy();
    rerender(
      <MessageList {...props} filters={{ query: "quarterly report" }} />
    );
    expect(screen.getByText("No matching messages")).toBeTruthy();
  });

  it("keeps loaded messages visible with retryable pagination and action errors", () => {
    const onLoadMore = vi.fn<() => void>();
    const onRetryAction = vi.fn<() => void>();
    render(
      <MessageList
        actionError="The message action could not be completed."
        data={messages}
        filters={{}}
        isLoadingMore={false}
        loadMoreFailed
        onLoadMore={onLoadMore}
        onMessageAction={vi.fn<
          (action: MessageRowAction, message: MessageListItemData) => void
        >()}
        onOpenMessage={vi.fn<(threadId: string, messageId: string) => void>()}
        onQueryChange={vi.fn<(state: MailboxMessageQueryState) => void>()}
        onRetryAction={onRetryAction}
        selection={{ folder: "inbox" }}
      />
    );

    expect({
      actionError: screen.getByRole("alert").textContent,
      messageVisible: Boolean(screen.getByText("Second subject")),
      pageError: Boolean(
        screen.getByText("More messages could not be loaded.")
      ),
    }).toMatchObject({
      actionError: expect.stringContaining("could not be completed"),
      messageVisible: true,
      pageError: true,
    });
    for (const retry of screen.getAllByRole("button", { name: "Try again" })) {
      fireEvent.click(retry);
    }
    expect({
      actionRetries: onRetryAction.mock.calls.length,
      pageRetries: onLoadMore.mock.calls.length,
    }).toStrictEqual({ actionRetries: 1, pageRetries: 1 });
  });

  it("disables every pending row and uses configured system folder ids", () => {
    const configured = {
      ...messages,
      items: [
        messages.items[0],
        { ...messages.items[1], folderId: "all-mail" },
      ],
    };
    render(
      <MessageList
        archiveFolderId="all-mail"
        data={configured}
        filters={{}}
        isLoadingMore={false}
        loadMoreFailed={false}
        onLoadMore={vi.fn<() => void>()}
        onMessageAction={vi.fn<
          (action: MessageRowAction, message: MessageListItemData) => void
        >()}
        onOpenMessage={vi.fn<(threadId: string, messageId: string) => void>()}
        onQueryChange={vi.fn<(state: MailboxMessageQueryState) => void>()}
        pendingMessageIds={new Set(["message-b"])}
        selection={{ folder: "inbox" }}
        trashFolderId="deleted-items"
      />
    );

    const archiveButtons = screen.getAllByRole("button", {
      name: "Archive message",
    });
    const starButtons = screen.getAllByRole("button", { name: /star/iu });
    expect({
      archiveDisabledInTarget: archiveButtons[1]?.hasAttribute("disabled"),
      archivePending: archiveButtons[0]?.hasAttribute("disabled"),
      otherRowEnabled: starButtons.at(-1)?.hasAttribute("disabled"),
      pendingIndicator: Boolean(screen.getByLabelText("Updating message")),
    }).toStrictEqual({
      archiveDisabledInTarget: true,
      archivePending: true,
      otherRowEnabled: false,
      pendingIndicator: true,
    });
  });

  it("keeps saved results visible after a background refresh failure", () => {
    const onRetryRefresh = vi.fn<() => void>();
    render(
      <MessageList
        data={messages}
        filters={{}}
        isLoadingMore={false}
        loadMoreFailed={false}
        onLoadMore={vi.fn<() => void>()}
        onMessageAction={vi.fn<
          (action: MessageRowAction, message: MessageListItemData) => void
        >()}
        onOpenMessage={vi.fn<(threadId: string, messageId: string) => void>()}
        onQueryChange={vi.fn<(state: MailboxMessageQueryState) => void>()}
        onRetryRefresh={onRetryRefresh}
        refreshFailed
        selection={{ folder: "inbox" }}
      />
    );

    expect({
      alert: screen.getByRole("alert").textContent,
      messageVisible: Boolean(screen.getByText("Second subject")),
    }).toMatchObject({
      alert: expect.stringContaining("Showing saved results"),
      messageVisible: true,
    });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetryRefresh).toHaveBeenCalledOnce();
  });

  it("keeps the count anchored while refresh state changes", () => {
    const onRefresh = vi.fn<() => void>();
    const props = {
      data: messages,
      filters: {},
      isLoadingMore: false,
      loadMoreFailed: false,
      onLoadMore: vi.fn<() => void>(),
      onMessageAction:
        vi.fn<
          (action: MessageRowAction, message: MessageListItemData) => void
        >(),
      onOpenMessage: vi.fn<(threadId: string, messageId: string) => void>(),
      onQueryChange: vi.fn<(state: MailboxMessageQueryState) => void>(),
      onRetryRefresh: onRefresh,
      selection: { folder: "inbox" } as const,
    };
    const view = render(<MessageList {...props} />);
    const refreshSlot = screen.getByRole("status");
    const count = refreshSlot.nextElementSibling;

    expect(count?.textContent).toBe("2");
    fireEvent.click(screen.getByRole("button", { name: "Refresh messages" }));
    expect(onRefresh).toHaveBeenCalledOnce();
    view.rerender(<MessageList {...props} isRefreshing />);
    expect(screen.getByText("Refreshing messages")).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "Refresh messages",
        }) as HTMLButtonElement
      ).disabled
    ).toBeTruthy();
    expect(refreshSlot.nextElementSibling).toBe(count);
  });
});
