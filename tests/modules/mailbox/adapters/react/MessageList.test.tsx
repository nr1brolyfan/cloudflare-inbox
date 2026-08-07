// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MailboxMessageQueryState } from "#/modules/mailbox/adapters/react/MailboxViewLinks";
import type {
  MessageListItemData,
  MessageRowAction,
} from "#/modules/mailbox/adapters/react/MessageList";
import { MessageList } from "#/modules/mailbox/adapters/react/MessageList";

const unusedMessageAction =
  vi.fn<(action: MessageRowAction, message: MessageListItemData) => void>();
const unusedMessageBatchAction =
  vi.fn<
    (
      action: MessageRowAction,
      selectedMessages: readonly MessageListItemData[]
    ) => void
  >();

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
      threadMessageCount: 2,
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
      threadMessageCount: 2,
      threadId: "thread-shared",
      version: 2,
    },
  ],
  nextCursor: "next-page",
};

describe(MessageList, () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

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
        onMessageBatchAction={unusedMessageBatchAction}
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
    expect({
      conversations: screen.getAllByLabelText("2 messages in conversation")
        .length,
      links: links.length,
    }).toStrictEqual({ conversations: 2, links: 2 });
    fireEvent.click(
      screen.getByRole("link", { name: "Second: Second subject" })
    );
    expect(onOpenMessage).toHaveBeenCalledWith("thread-shared", "message-b");
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(onLoadMore).toHaveBeenCalledOnce();
  });

  it("applies search and filter controls as one debounced query state", () => {
    const onQueryChange = vi.fn<(state: MailboxMessageQueryState) => void>();
    render(
      <MessageList
        data={{ items: [] }}
        filters={{ delivery: "delivery-1" }}
        isLoadingMore={false}
        loadMoreFailed={false}
        onLoadMore={vi.fn<() => void>()}
        onMessageBatchAction={unusedMessageBatchAction}
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
    fireEvent.click(screen.getByRole("combobox", { name: "Read status" }));
    const unreadOption = screen.getByRole("option", { name: "Unread" });
    fireEvent.pointerDown(unreadOption);
    fireEvent.click(unreadOption);
    fireEvent.click(screen.getByRole("button", { name: "Starred" }));
    fireEvent.click(screen.getByRole("button", { name: "Files" }));
    act(() => vi.advanceTimersByTime(350));

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
        onMessageBatchAction={unusedMessageBatchAction}
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

  it("selects messages without opening them and applies explicit bulk states", () => {
    const onMessageBatchAction =
      vi.fn<
        (
          action: MessageRowAction,
          selectedMessages: readonly MessageListItemData[]
        ) => void
      >();
    const onOpenMessage =
      vi.fn<(threadId: string, messageId: string) => void>();
    render(
      <MessageList
        data={messages}
        filters={{}}
        isLoadingMore={false}
        loadMoreFailed={false}
        onLoadMore={vi.fn<() => void>()}
        onMessageBatchAction={onMessageBatchAction}
        onMessageAction={unusedMessageAction}
        onOpenMessage={onOpenMessage}
        onQueryChange={vi.fn<(state: MailboxMessageQueryState) => void>()}
        selection={{ folder: "inbox" }}
      />
    );

    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Select Second: Second subject",
      })
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select First: First subject" })
    );

    expect(screen.getByText("2 selected")).toBeTruthy();
    expect(onOpenMessage).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Mark selected read" }));
    expect(onMessageBatchAction.mock.calls).toStrictEqual([
      ["read", [messages.items[0]]],
    ]);

    onMessageBatchAction.mockClear();
    fireEvent.click(
      screen.getByRole("button", { name: "Add star to selected" })
    );
    expect(onMessageBatchAction.mock.calls).toStrictEqual([
      ["star", [messages.items[0], messages.items[1]]],
    ]);
  });

  it("selects all loaded messages from the header", () => {
    render(
      <MessageList
        data={messages}
        filters={{}}
        isLoadingMore={false}
        loadMoreFailed={false}
        onLoadMore={vi.fn<() => void>()}
        onMessageBatchAction={unusedMessageBatchAction}
        onMessageAction={vi.fn<
          (action: MessageRowAction, message: MessageListItemData) => void
        >()}
        onOpenMessage={vi.fn<(threadId: string, messageId: string) => void>()}
        onQueryChange={vi.fn<(state: MailboxMessageQueryState) => void>()}
        selection={{ folder: "inbox" }}
      />
    );

    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select all loaded messages" })
    );

    expect(screen.getByText("2 selected")).toBeTruthy();
    expect(
      screen
        .getAllByRole("checkbox")
        .every((checkbox) => Object.hasOwn(checkbox.dataset, "checked"))
    ).toBeTruthy();
  });

  it("hides read controls and strips stale read filters in Sent", () => {
    const onQueryChange = vi.fn<(state: MailboxMessageQueryState) => void>();
    render(
      <MessageList
        data={{ items: [messages.items[0]] }}
        filters={{ read: "unread" }}
        isLoadingMore={false}
        loadMoreFailed={false}
        onLoadMore={vi.fn<() => void>()}
        onMessageBatchAction={unusedMessageBatchAction}
        onMessageAction={unusedMessageAction}
        onOpenMessage={vi.fn<(threadId: string, messageId: string) => void>()}
        onQueryChange={onQueryChange}
        readActionsEnabled={false}
        selection={{ folder: "sent" }}
      />
    );

    expect({
      readButton: screen.queryByRole("button", { name: "Mark read" }),
      readFilter: screen.queryByRole("combobox", { name: "Read status" }),
    }).toStrictEqual({ readButton: null, readFilter: null });
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Select Second: Second subject",
      })
    );
    expect(
      screen.queryByRole("button", { name: "Mark selected read" })
    ).toBeNull();

    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search messages" }),
      { target: { value: "sent invoice" } }
    );
    act(() => vi.advanceTimersByTime(350));
    expect(onQueryChange).toHaveBeenLastCalledWith({
      delivery: undefined,
      hasAttachment: undefined,
      query: "sent invoice",
      read: undefined,
      starred: undefined,
    });

    const messageRow = screen
      .getByRole("link", { name: "Second: Second subject" })
      .closest("article");
    if (!(messageRow instanceof HTMLElement)) {
      throw new Error("Expected the message link to be rendered inside a row");
    }
    fireEvent.contextMenu(messageRow);
    expect(screen.queryByRole("menuitem", { name: "Mark read" })).toBeNull();
    expect(
      screen.getByRole("menuitem", { name: "Move to trash" })
    ).toBeTruthy();
  });

  it("opens row actions on right click and dispatches the chosen action", () => {
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
        onMessageBatchAction={unusedMessageBatchAction}
        onMessageAction={onMessageAction}
        onOpenMessage={onOpenMessage}
        onQueryChange={vi.fn<(state: MailboxMessageQueryState) => void>()}
        selection={{ folder: "inbox" }}
      />
    );

    const messageLink = screen.getByRole("link", {
      name: "Second: Second subject",
    });
    const messageRow = messageLink.closest("article");
    if (!(messageRow instanceof HTMLElement)) {
      throw new Error("Expected the message link to be rendered inside a row");
    }
    fireEvent.contextMenu(messageRow);
    fireEvent.click(screen.getByRole("menuitem", { name: "Move to trash" }));

    expect(onMessageAction).toHaveBeenCalledWith("trash", messages.items[0]);
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
        onMessageBatchAction={unusedMessageBatchAction}
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
    act(() => vi.advanceTimersByTime(350));

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
      onMessageBatchAction: unusedMessageBatchAction,
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

  it("keeps the message workspace visible during the initial fetch", () => {
    render(
      <MessageList
        data={{ items: [] }}
        filters={{}}
        isInitialLoading
        isLoadingMore={false}
        loadMoreFailed={false}
        onLoadMore={vi.fn<() => void>()}
        onMessageBatchAction={unusedMessageBatchAction}
        onMessageAction={vi.fn<
          (action: MessageRowAction, message: MessageListItemData) => void
        >()}
        onOpenMessage={vi.fn<(threadId: string, messageId: string) => void>()}
        onQueryChange={vi.fn<(state: MailboxMessageQueryState) => void>()}
        selection={{ folder: "inbox" }}
      />
    );

    expect(
      screen.getByRole("searchbox", { name: "Search messages" })
    ).toBeTruthy();
    expect(screen.getByLabelText("Loading messages")).toBeTruthy();
    expect(screen.queryByText("No messages here")).toBeNull();
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
        onMessageBatchAction={unusedMessageBatchAction}
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
        onMessageBatchAction={unusedMessageBatchAction}
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

  it("does not show redundant automatic-update messaging", () => {
    render(
      <MessageList
        data={messages}
        filters={{}}
        isLoadingMore={false}
        loadMoreFailed={false}
        onLoadMore={vi.fn<() => void>()}
        onMessageBatchAction={unusedMessageBatchAction}
        onMessageAction={vi.fn<
          (action: MessageRowAction, message: MessageListItemData) => void
        >()}
        onOpenMessage={vi.fn<(threadId: string, messageId: string) => void>()}
        onQueryChange={vi.fn<(state: MailboxMessageQueryState) => void>()}
        selection={{ folder: "inbox" }}
      />
    );

    expect(screen.getByText("Second subject")).toBeTruthy();
    expect(screen.queryByText("Updates automatically")).toBeNull();
    expect(screen.queryByText(/could not be refreshed/iu)).toBeNull();
  });

  it("keeps the count anchored during automatic refreshes", () => {
    const props = {
      data: messages,
      filters: {},
      isLoadingMore: false,
      loadMoreFailed: false,
      onLoadMore: vi.fn<() => void>(),
      onMessageBatchAction: unusedMessageBatchAction,
      onMessageAction:
        vi.fn<
          (action: MessageRowAction, message: MessageListItemData) => void
        >(),
      onOpenMessage: vi.fn<(threadId: string, messageId: string) => void>(),
      onQueryChange: vi.fn<(state: MailboxMessageQueryState) => void>(),
      selection: { folder: "inbox" } as const,
    };
    const view = render(<MessageList {...props} />);
    const refreshSlot = screen.getByRole("status");
    const count = refreshSlot.nextElementSibling;

    expect(count?.textContent).toBe("2");
    expect(
      screen.queryByRole("button", { name: "Refresh messages" })
    ).toBeNull();
    view.rerender(<MessageList {...props} isRefreshing />);
    expect(screen.getByText("Refreshing messages")).toBeTruthy();
    expect(refreshSlot.nextElementSibling).toBe(count);
  });
});
