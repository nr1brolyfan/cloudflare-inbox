import type {
  InfiniteData,
  QueryClient,
  QueryKey,
} from "@tanstack/react-query";
import type * as Schema from "effect/Schema";

import type { MailboxMessageBatchActionItem } from "#/modules/mailbox/application/MailboxMessageActions";
import type {
  MailboxMessageListResult,
  MailboxThreadResult,
} from "#/modules/mailbox/application/MailboxMessageReading";

import type {
  MailboxMessageQueryState,
  MailboxViewSelection,
} from "./MailboxViewLinks";

type MessageActionCommand = Schema.Schema.Type<
  typeof MailboxMessageBatchActionItem
>;
type MessageListData = Schema.Codec.Encoded<typeof MailboxMessageListResult>;
type ThreadData = Schema.Codec.Encoded<typeof MailboxThreadResult>;
interface MessageActionResult {
  readonly folderId: string;
  readonly id: string;
  readonly read: boolean;
  readonly starred: boolean;
  readonly version: number;
}

export const mailboxMessageActionMutationKey = [
  "mailbox",
  "message-action",
] as const;
export const mailboxThreadReadMutationKey = ["mailbox", "thread-read"] as const;

const matchesVisibleFilters = (
  message: MessageListData["items"][number],
  selection: MailboxViewSelection,
  filters: MailboxMessageQueryState
) =>
  (selection.folder === undefined || message.folderId === selection.folder) &&
  (filters.read === undefined || message.read === (filters.read === "read")) &&
  (filters.starred !== true || message.starred);

export const projectPendingMessageActions = (
  data: MessageListData,
  commands: readonly MessageActionCommand[],
  selection: MailboxViewSelection,
  filters: MailboxMessageQueryState,
  targets: {
    readonly archiveFolderId?: string;
    readonly trashFolderId?: string;
  },
  pendingThreadIds: ReadonlySet<string> = new Set()
): MessageListData => {
  const commandByMessage = new Map<string, MessageActionCommand>(
    commands.map((command) => [command.messageId, command])
  );
  return {
    ...data,
    items: data.items.flatMap((message) => {
      const command = commandByMessage.get(message.id);
      const actionProjected =
        command === undefined
          ? message
          : command._tag === "SetRead"
            ? { ...message, read: command.read }
            : command._tag === "SetStarred"
              ? { ...message, starred: command.starred }
              : {
                  ...message,
                  folderId:
                    command._tag === "Archive"
                      ? (targets.archiveFolderId ?? message.folderId)
                      : (targets.trashFolderId ?? message.folderId),
                };
      const projected = pendingThreadIds.has(message.threadId)
        ? { ...actionProjected, read: true }
        : actionProjected;
      return matchesVisibleFilters(projected, selection, filters)
        ? [projected]
        : [];
    }),
  };
};

export const projectPendingThreadActions = (
  data: ThreadData,
  commands: readonly MessageActionCommand[],
  pendingThreadIds: ReadonlySet<string> = new Set()
): ThreadData => {
  const readByMessage = new Map<string, boolean>(
    commands.flatMap((command) =>
      command._tag === "SetRead"
        ? ([[command.messageId, command.read]] as const)
        : []
    )
  );
  const threadReadPending = pendingThreadIds.has(data.thread.id);
  let unreadCount = threadReadPending ? 0 : data.thread.unreadCount;
  let changed = unreadCount !== data.thread.unreadCount;
  const messages = data.messages.map((message) => {
    if (threadReadPending) {
      if (message.read) {
        return message;
      }
      changed = true;
      return { ...message, read: true };
    }
    const read = readByMessage.get(message.id);
    if (read === undefined || read === message.read) {
      return message;
    }
    changed = true;
    unreadCount += read ? -1 : 1;
    return { ...message, read };
  });
  return changed
    ? {
        ...data,
        messages,
        thread: { ...data.thread, unreadCount },
      }
    : data;
};

const actionMatchesMessageQuery = (
  queryKey: QueryKey,
  result: MessageActionResult
) => {
  const { 4: viewTag, 5: viewId, 7: read, 8: starred } = queryKey;
  return (
    (viewTag !== "Folder" || viewId === result.folderId) &&
    (read !== "read" || result.read) &&
    (read !== "unread" || !result.read) &&
    (starred !== true || result.starred)
  );
};

const reconcileMessagePages = (
  queryKey: QueryKey,
  data: InfiniteData<MessageListData>,
  result: MessageActionResult
): InfiniteData<MessageListData> => ({
  ...data,
  pages: data.pages.map((page) => ({
    ...page,
    items: page.items.flatMap((message) => {
      if (message.id !== result.id) {
        return [message];
      }
      return actionMatchesMessageQuery(queryKey, result)
        ? [
            {
              ...message,
              folderId: result.folderId,
              read: result.read,
              starred: result.starred,
              version: result.version,
            },
          ]
        : [];
    }),
  })),
});

const reconcileThread = (
  data: ThreadData,
  result: MessageActionResult
): ThreadData => {
  let { unreadCount } = data.thread;
  let changed = false;
  const messages = data.messages.map((message) => {
    if (message.id !== result.id || message.read === result.read) {
      return message;
    }
    changed = true;
    unreadCount += result.read ? -1 : 1;
    return { ...message, read: result.read };
  });
  return changed
    ? {
        ...data,
        messages,
        thread: { ...data.thread, unreadCount },
      }
    : data;
};

/** Reconciles only existing cache entries; invalidation fills destination views. */
export const reconcileMailboxMessageActionCaches = (
  queryClient: QueryClient,
  mailboxId: string,
  result: MessageActionResult
) => {
  const messageQueries = queryClient.getQueriesData<
    InfiniteData<MessageListData>
  >({ queryKey: ["mailbox", "messages"] });
  for (const [queryKey, data] of messageQueries) {
    if (data !== undefined && queryKey[3] === mailboxId) {
      queryClient.setQueryData(
        queryKey,
        reconcileMessagePages(queryKey, data, result)
      );
    }
  }

  const threadQueries = queryClient.getQueriesData<{
    readonly ok: boolean;
    readonly thread?: ThreadData;
  }>({ queryKey: ["mailbox", "thread"] });
  for (const [queryKey, data] of threadQueries) {
    if (
      data?.ok === true &&
      data.thread !== undefined &&
      queryKey[3] === mailboxId
    ) {
      queryClient.setQueryData(queryKey, {
        ...data,
        thread: reconcileThread(data.thread, result),
      });
    }
  }
};

/** Applies the aggregate guarantee returned by a successful thread-read command. */
export const reconcileMailboxThreadReadCaches = (
  queryClient: QueryClient,
  mailboxId: string,
  threadId: string
) => {
  const threadQueries = queryClient.getQueriesData<{
    readonly ok: boolean;
    readonly thread?: ThreadData;
  }>({ queryKey: ["mailbox", "thread"] });
  for (const [queryKey, data] of threadQueries) {
    if (
      data?.ok === true &&
      data.thread !== undefined &&
      queryKey[3] === mailboxId &&
      data.thread.thread.id === threadId
    ) {
      queryClient.setQueryData(queryKey, {
        ...data,
        thread: {
          ...data.thread,
          messages: data.thread.messages.map((message) =>
            message.read ? message : { ...message, read: true }
          ),
          thread: { ...data.thread.thread, unreadCount: 0 },
        },
      });
    }
  }
};
