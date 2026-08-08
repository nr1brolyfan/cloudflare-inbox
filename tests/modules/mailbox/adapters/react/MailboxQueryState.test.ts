import { QueryClient } from "@tanstack/react-query";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  projectPendingMessageActions,
  projectPendingThreadActions,
  reconcileMailboxMessageActionCaches,
  reconcileMailboxThreadReadCaches,
} from "#/modules/mailbox/adapters/react/MailboxQueryState";
import { MailboxMessageActionCommand } from "#/modules/mailbox/application/MailboxMessageActions";

const command = Schema.decodeUnknownSync(MailboxMessageActionCommand);
const messages = {
  items: [
    {
      activityAt: 2000,
      direction: "inbound" as const,
      folderId: "inbox",
      hasAttachments: true,
      id: "message-b",
      read: false,
      replyEligible: true,
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
  nextCursor: "cursor-2",
};
const thread = {
  hasMore: false,
  messages: [
    {
      activityAt: 1000,
      attachments: [],
      cc: [],
      direction: "inbound" as const,
      hasHtmlBody: false,
      id: "message-b",
      read: false,
      sender: { address: "sender@example.test" },
      replyEligible: true,
      textBody: "Body",
      to: [{ address: "owner@example.test" }],
    },
  ],
  thread: {
    id: "thread-shared",
    latestActivityAt: 1000,
    messageCount: 1,
    subject: "Second subject",
    unreadCount: 1,
  },
};

const actionCommon = {
  expectedVersion: 1,
  mailboxId: "primary",
  operationId: "operation-1",
};

describe("mailbox optimistic query state", () => {
  it("projects concurrent read and star actions without mutating source data", () => {
    const projected = projectPendingMessageActions(
      messages,
      [
        command({
          ...actionCommon,
          _tag: "SetRead",
          messageId: "message-b",
          read: true,
        }),
        command({
          ...actionCommon,
          _tag: "SetStarred",
          messageId: "message-a",
          operationId: "operation-2",
          starred: true,
        }),
      ],
      { folder: "inbox" },
      {},
      {}
    );

    expect({
      projected: projected.items.map(({ id, read, starred, version }) => ({
        id,
        read,
        starred,
        version,
      })),
      source: messages.items.map(({ id, read, starred }) => ({
        id,
        read,
        starred,
      })),
    }).toStrictEqual({
      projected: [
        { id: "message-b", read: true, starred: false, version: 1 },
        { id: "message-a", read: true, starred: true, version: 2 },
      ],
      source: [
        { id: "message-b", read: false, starred: false },
        { id: "message-a", read: true, starred: false },
      ],
    });
  });

  it("removes optimistic filter misses and moves only from folder views", () => {
    const read = command({
      ...actionCommon,
      _tag: "SetRead",
      messageId: "message-b",
      read: true,
    });
    const archive = command({
      ...actionCommon,
      _tag: "Archive",
      messageId: "message-b",
    });

    expect({
      archivedFolder: projectPendingMessageActions(
        messages,
        [archive],
        { folder: "inbox" },
        {},
        { archiveFolderId: "all-mail" }
      ).items.map((item) => item.id),
      archivedLabel: projectPendingMessageActions(
        messages,
        [archive],
        { label: "work" },
        {},
        { archiveFolderId: "all-mail" }
      ).items.map(({ folderId, id }) => ({ folderId, id })),
      unread: projectPendingMessageActions(
        { ...messages, items: [messages.items[0]] },
        [read],
        { folder: "inbox" },
        { read: "unread" },
        {}
      ).items.map((item) => item.id),
    }).toStrictEqual({
      archivedFolder: ["message-a"],
      archivedLabel: [
        { folderId: "all-mail", id: "message-b" },
        { folderId: "inbox", id: "message-a" },
      ],
      unread: [],
    });
  });

  it("projects thread read state and unread count", () => {
    const projected = projectPendingThreadActions(thread, [
      command({
        ...actionCommon,
        _tag: "SetRead",
        messageId: "message-b",
        read: true,
      }),
    ]);

    expect({
      projectedRead: projected.messages[0]?.read,
      projectedUnread: projected.thread.unreadCount,
      sourceRead: thread.messages[0]?.read,
      sourceUnread: thread.thread.unreadCount,
    }).toStrictEqual({
      projectedRead: true,
      projectedUnread: 0,
      sourceRead: false,
      sourceUnread: 1,
    });
  });

  it("optimistically marks every loaded view of a pending thread read", () => {
    const pendingThreadIds = new Set(["thread-shared"]);
    const projectedList = projectPendingMessageActions(
      messages,
      [],
      { folder: "inbox" },
      {},
      {},
      pendingThreadIds
    );
    const projectedUnread = projectPendingMessageActions(
      { ...messages, items: [messages.items[0]] },
      [],
      { folder: "inbox" },
      { read: "unread" },
      {},
      pendingThreadIds
    );
    const projectedThread = projectPendingThreadActions(
      thread,
      [],
      pendingThreadIds
    );

    expect({
      listReads: projectedList.items.map((message) => message.read),
      sourceListReads: messages.items.map((message) => message.read),
      sourceThreadUnread: thread.thread.unreadCount,
      threadReads: projectedThread.messages.map((message) => message.read),
      threadUnread: projectedThread.thread.unreadCount,
      unreadIds: projectedUnread.items.map((message) => message.id),
    }).toStrictEqual({
      listReads: [true, true],
      sourceListReads: [false, true],
      sourceThreadUnread: 1,
      threadReads: [true],
      threadUnread: 0,
      unreadIds: [],
    });
  });

  it("reconciles every thread anchor without invalidating conversations", () => {
    const queryClient = new QueryClient();
    const listKey = [
      "mailbox",
      "messages",
      "session-1",
      "primary",
      "Folder",
      "inbox",
      undefined,
      undefined,
      undefined,
      undefined,
    ] as const;
    const unreadKey = [...listKey.slice(0, 7), "unread", undefined, undefined];
    const infinite = {
      pageParams: [undefined, "cursor-2"],
      pages: [
        { items: [messages.items[1]], nextCursor: "cursor-2" },
        { items: [messages.items[0]] },
      ],
    };
    queryClient.setQueryData(listKey, infinite);
    queryClient.setQueryData(unreadKey, infinite);
    for (const anchor of ["message-a", "message-b"]) {
      queryClient.setQueryData(
        [
          "mailbox",
          "thread",
          "session-1",
          "primary",
          "Folder",
          "inbox",
          anchor,
          "thread-shared",
        ],
        { ok: true, thread }
      );
    }
    reconcileMailboxMessageActionCaches(queryClient, "primary", {
      folderId: "inbox",
      id: "message-b",
      read: true,
      starred: false,
      version: 3,
    });
    const list = queryClient.getQueryData<typeof infinite>(listKey);
    const unread = queryClient.getQueryData<typeof infinite>(unreadKey);
    const threads = queryClient
      .getQueriesData<{ readonly ok: true; readonly thread: typeof thread }>({
        queryKey: ["mailbox", "thread"],
      })
      .map(([, data]) => data?.thread);
    const threadInvalidated = queryClient
      .getQueryCache()
      .findAll({ queryKey: ["mailbox", "thread"] })
      .map((query) => query.state.isInvalidated);

    expect({
      listMessage: list?.pages[1]?.items[0],
      nextCursor: list?.pages[0]?.nextCursor,
      pageParams: list?.pageParams,
      threadReads: threads.map((item) => item?.messages[0]?.read),
      threadInvalidated,
      threadUnread: threads.map((item) => item?.thread.unreadCount),
      unreadIds: unread?.pages.flatMap((page) =>
        page.items.map((item) => item.id)
      ),
    }).toMatchObject({
      listMessage: { id: "message-b", read: true, version: 3 },
      nextCursor: "cursor-2",
      pageParams: [undefined, "cursor-2"],
      threadReads: [true, true],
      threadInvalidated: [false, false],
      threadUnread: [0, 0],
      unreadIds: ["message-a"],
    });
  });

  it("clears stale aggregate unread state after an empty thread-read result", () => {
    const queryClient = new QueryClient();
    const threadKey = [
      "mailbox",
      "thread",
      "session-1",
      "primary",
      "Folder",
      "inbox",
      "message-b",
      "thread-shared",
    ] as const;
    queryClient.setQueryData(threadKey, { ok: true, thread });

    reconcileMailboxThreadReadCaches(queryClient, "primary", "thread-shared");

    expect(queryClient.getQueryData(threadKey)).toMatchObject({
      thread: {
        messages: [{ id: "message-b", read: true }],
        thread: { id: "thread-shared", unreadCount: 0 },
      },
    });
  });

  it("removes a moved source item without inserting into an empty target", () => {
    const queryClient = new QueryClient();
    const sourceKey = [
      "mailbox",
      "messages",
      "session-1",
      "primary",
      "Folder",
      "inbox",
    ] as const;
    const targetKey = [
      "mailbox",
      "messages",
      "session-1",
      "primary",
      "Folder",
      "all-mail",
    ] as const;
    queryClient.setQueryData(sourceKey, {
      pageParams: [undefined],
      pages: [messages],
    });
    queryClient.setQueryData(targetKey, {
      pageParams: [undefined],
      pages: [{ items: [] }],
    });
    reconcileMailboxMessageActionCaches(queryClient, "primary", {
      folderId: "all-mail",
      id: "message-b",
      read: false,
      starred: false,
      version: 2,
    });

    expect({
      source: queryClient
        .getQueryData<{ pages: (typeof messages)[] }>(sourceKey)
        ?.pages.flatMap((page) => page.items.map((item) => item.id)),
      target: queryClient
        .getQueryData<{ pages: (typeof messages)[] }>(targetKey)
        ?.pages.flatMap((page) => page.items.map((item) => item.id)),
    }).toStrictEqual({ source: ["message-a"], target: [] });
  });
});
