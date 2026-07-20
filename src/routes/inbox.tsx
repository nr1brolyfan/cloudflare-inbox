import {
  skipToken,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import {
  ArrowLeft,
  CircleAlert,
  Inbox as InboxIcon,
  LoaderCircle,
  RotateCcw,
} from "lucide-react";

import {
  authClient,
  authSessionQueryKey,
  clearCachedAuthSession,
  currentSessionForQuery,
} from "../auth/client";
import { MailboxShell } from "../inbox/mailbox-shell";
import type {
  MailboxMessageQueryState,
  MailboxViewSelection,
} from "../inbox/mailbox-view-links";
import { mailboxViewHref } from "../inbox/mailbox-view-links";
import type { MessageRowAction } from "../inbox/message-list";
import { MessageList } from "../inbox/message-list";
import { NoThreadSelected, ThreadView } from "../inbox/thread-view";
import {
  FolderId,
  LabelId,
  MessageId,
  SearchQuery,
  ThreadId,
} from "../mailboxes/core";
import { MailboxMessageActionCommand } from "../mailboxes/message-actions";
import {
  MailboxMessageListInput,
  MailboxMessageView,
  OpenMailboxThreadInput,
} from "../mailboxes/message-reading";
import type { MailboxNavigationResult } from "../mailboxes/navigation";
import {
  getMailboxNavigation,
  getMailboxThread,
  listMailboxMessages,
  actOnMailboxMessage,
} from "../server/tanstack-functions";

const InboxSearch = Schema.Struct({
  attachment: Schema.optional(Schema.Literal("true")),
  folder: Schema.optional(FolderId),
  label: Schema.optional(LabelId),
  message: Schema.optional(MessageId),
  q: Schema.optional(SearchQuery),
  read: Schema.optional(Schema.Literals(["read", "unread"])),
  starred: Schema.optional(Schema.Literal("true")),
  thread: Schema.optional(ThreadId),
}).check(
  Schema.makeFilter((search) => {
    if (search.folder !== undefined && search.label !== undefined) {
      return "folder and label cannot be selected together";
    }
    return (search.thread === undefined) === (search.message === undefined)
      ? undefined
      : "thread and message must be selected together";
  })
);
const decodeInboxSearch = Schema.decodeUnknownSync(InboxSearch);
const decodeMailboxMessageView = Schema.decodeUnknownSync(MailboxMessageView);
const decodeMailboxMessageListInput = Schema.decodeUnknownSync(
  MailboxMessageListInput
);
const decodeMailboxMessageAction = Schema.decodeUnknownSync(
  MailboxMessageActionCommand
);
const decodeOpenMailboxThread = Schema.decodeUnknownSync(
  OpenMailboxThreadInput
);
const mailboxNavigationQueryKey = ["mailbox", "navigation"] as const;

class MailboxMessagesRequestError extends Error {
  readonly status: number;

  constructor(status: number) {
    super("Mailbox messages request failed");
    this.name = "MailboxMessagesRequestError";
    this.status = status;
  }
}

const inboxSearchFor = (
  selection: MailboxViewSelection,
  filters: MailboxMessageQueryState,
  open?: { readonly messageId: string; readonly threadId: string }
) =>
  decodeInboxSearch({
    ...selection,
    attachment: filters.hasAttachment ? "true" : undefined,
    message: open?.messageId,
    q: filters.query,
    read: filters.read,
    starred: filters.starred ? "true" : undefined,
    thread: open?.threadId,
  });

const messageActionCommand = (
  action: MessageRowAction,
  mailboxId: string,
  message: {
    readonly id: string;
    readonly read: boolean;
    readonly starred: boolean;
    readonly version: number;
  }
) => {
  const common = {
    expectedVersion: message.version,
    mailboxId,
    messageId: message.id,
    operationId: crypto.randomUUID(),
  };
  switch (action) {
    case "read": {
      return decodeMailboxMessageAction({
        ...common,
        _tag: "SetRead",
        read: !message.read,
      });
    }
    case "star": {
      return decodeMailboxMessageAction({
        ...common,
        _tag: "SetStarred",
        starred: !message.starred,
      });
    }
    case "archive": {
      return decodeMailboxMessageAction({ ...common, _tag: "Archive" });
    }
    case "trash": {
      return decodeMailboxMessageAction({ ...common, _tag: "Trash" });
    }
    default: {
      return decodeMailboxMessageAction({ ...common, _tag: "Trash" });
    }
  }
};

const messageActionErrorText = (
  failed: boolean,
  result: { readonly ok: boolean; readonly status?: number } | undefined
) => {
  if (failed) {
    return "The message action could not be completed.";
  }
  if (result?.ok !== false) {
    return;
  }
  if (result.status === 403) {
    return "You do not have permission to change this message.";
  }
  return result.status === 409
    ? "The message changed. Its latest state has been loaded."
    : "The message action could not be completed.";
};

const resolveNavigationSelection = (
  folders: readonly {
    readonly id: string;
    readonly kind: string;
    readonly name: string;
  }[],
  labels: readonly { readonly id: string; readonly name: string }[],
  search: Schema.Schema.Type<typeof InboxSearch>
) => {
  const selectedLabel = labels.find((label) => label.id === search.label);
  const selectedFolder = selectedLabel
    ? undefined
    : (folders.find((folder) => folder.id === search.folder) ??
      folders.find((folder) => folder.kind === "inbox"));

  return { selectedFolder, selectedLabel };
};

export const Route = createFileRoute("/inbox")({
  component: InboxRoute,
  validateSearch: decodeInboxSearch,
});

function MailboxUnavailable({
  onRetry,
  status,
}: {
  readonly onRetry?: () => void;
  readonly status: number;
}) {
  const denied = status === 403;
  const missing = status === 404;
  const title = denied
    ? "You cannot open this mailbox"
    : missing
      ? "No mailbox is ready yet"
      : "We could not load your mailbox";
  const detail = denied
    ? "Your session is valid, but it does not include mailbox read access."
    : missing
      ? "Return home to create or activate your primary mailbox."
      : "The mailbox service returned an invalid or unavailable response.";

  return (
    <main className="flex min-h-dvh items-center justify-center px-5 py-10">
      <section className="island-shell w-full max-w-lg rounded-[2rem] p-8 text-center sm:p-10">
        <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-[var(--sand)] text-[var(--palm)]">
          <InboxIcon size={26} />
        </span>
        <p className="island-kicker mt-7">Mailbox unavailable</p>
        <h1 className="display-title mt-2 text-3xl font-bold">{title}</h1>
        <p className="mt-3 text-sm leading-6 text-[var(--sea-ink-soft)]">
          {detail}
        </p>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          {!denied && !missing && onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-2 rounded-xl bg-[var(--sea-ink)] px-5 py-3 text-sm font-bold text-white"
            >
              <RotateCcw size={17} /> Try again
            </button>
          ) : null}
          <Link
            to="/"
            className="inline-flex items-center gap-2 rounded-xl border border-[var(--line)] bg-white/70 px-5 py-3 text-sm font-bold text-[var(--sea-ink)] no-underline hover:bg-white hover:text-[var(--sea-ink)]"
          >
            <ArrowLeft size={17} /> Return home
          </Link>
        </div>
      </section>
    </main>
  );
}

function SignInRequired() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-5 py-10">
      <section className="island-shell w-full max-w-md rounded-[2rem] p-8 text-center sm:p-10">
        <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-[var(--sand)] text-[var(--palm)]">
          <InboxIcon size={26} />
        </span>
        <p className="island-kicker mt-7">Private workspace</p>
        <h1 className="display-title mt-2 text-3xl font-bold">
          Sign in to open your inbox
        </h1>
        <p className="mt-3 text-sm leading-6 text-[var(--sea-ink-soft)]">
          Your mailbox is available only after the current session is verified.
        </p>
        <Link
          to="/"
          className="mt-7 inline-flex items-center gap-2 rounded-xl bg-[var(--sea-ink)] px-5 py-3 text-sm font-bold text-white no-underline hover:text-white"
        >
          <ArrowLeft size={17} /> Return to sign in
        </Link>
      </section>
    </main>
  );
}

function WorkspaceStatus({
  backHref,
  detail,
  onBack,
  onRetry,
  title,
}: {
  readonly backHref?: string;
  readonly detail: string;
  readonly onBack?: () => void;
  readonly onRetry?: () => void;
  readonly title: string;
}) {
  return (
    <section className="flex min-h-80 flex-1 items-center justify-center bg-white/48 px-6 text-center">
      <div className="max-w-sm">
        <CircleAlert
          className="mx-auto text-[var(--sea-ink-soft)] opacity-35"
          size={34}
        />
        <p className="mt-4 text-sm font-extrabold">{title}</p>
        <p className="mt-1 text-xs leading-5 text-[var(--sea-ink-soft)]">
          {detail}
        </p>
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="mt-5 inline-flex items-center gap-2 rounded-xl border border-[var(--line)] bg-white px-4 py-2.5 text-xs font-extrabold"
          >
            <RotateCcw size={14} /> Try again
          </button>
        ) : null}
        {backHref ? (
          <a
            href={backHref}
            onClick={(event) => {
              if (
                onBack !== undefined &&
                event.button === 0 &&
                !event.altKey &&
                !event.ctrlKey &&
                !event.metaKey &&
                !event.shiftKey
              ) {
                event.preventDefault();
                onBack();
              }
            }}
            className="mt-3 inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-extrabold lg:hidden"
          >
            <ArrowLeft size={14} /> Back to messages
          </a>
        ) : null}
      </div>
    </section>
  );
}

function ConversationPane({
  filters,
  mailboxId,
  messageId,
  onClose,
  selection,
  sessionId,
  threadId,
}: {
  readonly filters: MailboxMessageQueryState;
  readonly mailboxId: string;
  readonly messageId?: string;
  readonly onClose: () => void;
  readonly selection: MailboxViewSelection;
  readonly sessionId: string;
  readonly threadId?: string;
}) {
  const view = decodeMailboxMessageView(
    selection.folder === undefined
      ? { _tag: "Label", labelId: selection.label, mailboxId }
      : { _tag: "Folder", folderId: selection.folder, mailboxId }
  );
  const threadInput =
    threadId === undefined || messageId === undefined
      ? undefined
      : decodeOpenMailboxThread({ ...view, messageId, threadId });
  const thread = useQuery({
    queryFn:
      threadInput === undefined
        ? skipToken
        : () => getMailboxThread({ data: threadInput }),
    queryKey: [
      "mailbox",
      "thread",
      sessionId,
      mailboxId,
      view._tag,
      view._tag === "Folder" ? view.folderId : view.labelId,
      messageId,
      threadId,
    ],
    retry: false,
  });

  if (threadId === undefined) {
    return <NoThreadSelected />;
  }
  if (thread.isLoading) {
    return (
      <div className="flex min-h-80 flex-1 items-center justify-center text-[var(--sea-ink-soft)]">
        <LoaderCircle
          aria-label="Loading conversation"
          className="animate-spin"
        />
      </div>
    );
  }
  if (thread.error || !thread.data?.ok) {
    const missing = thread.data?.ok === false && thread.data.status === 404;
    return (
      <WorkspaceStatus
        backHref={mailboxViewHref(selection, undefined, undefined, filters)}
        onBack={onClose}
        title={missing ? "Conversation not found" : "Conversation unavailable"}
        detail={
          missing
            ? "This conversation may have been removed or moved."
            : "The conversation could not be loaded."
        }
        onRetry={missing ? undefined : () => void thread.refetch()}
      />
    );
  }

  return (
    <ThreadView
      data={thread.data.thread}
      filters={filters}
      onClose={onClose}
      selection={selection}
    />
  );
}

function MailboxWorkspace({
  filters,
  mailboxId,
  messageId,
  selection,
  sessionId,
  threadId,
}: {
  readonly filters: MailboxMessageQueryState;
  readonly mailboxId: string;
  readonly messageId?: string;
  readonly selection: MailboxViewSelection;
  readonly sessionId: string;
  readonly threadId?: string;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const view = decodeMailboxMessageView(
    selection.folder === undefined
      ? { _tag: "Label", labelId: selection.label, mailboxId }
      : { _tag: "Folder", folderId: selection.folder, mailboxId }
  );
  const messages = useInfiniteQuery({
    queryFn: async ({ pageParam }) => {
      const result = await listMailboxMessages({
        data: decodeMailboxMessageListInput({
          ...view,
          cursor: pageParam,
          hasAttachment: filters.hasAttachment,
          query: filters.query,
          read:
            filters.read === undefined ? undefined : filters.read === "read",
          starred: filters.starred,
        }),
      });
      if (!result.ok) {
        throw new MailboxMessagesRequestError(result.status);
      }
      return result.messages;
    },
    queryKey: [
      "mailbox",
      "messages",
      sessionId,
      mailboxId,
      view._tag,
      view._tag === "Folder" ? view.folderId : view.labelId,
      filters.query,
      filters.read,
      filters.starred,
      filters.hasAttachment,
    ],
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    retry: false,
  });
  const messageAction = useMutation({
    mutationFn: (
      command: Schema.Schema.Type<typeof MailboxMessageActionCommand>
    ) => actOnMailboxMessage({ data: command }),
    onSuccess: async (result) => {
      if (!result.ok && result.status === 401) {
        await clearCachedAuthSession(queryClient);
        return;
      }
      if (result.ok) {
        await queryClient.invalidateQueries({ queryKey: ["mailbox"] });
        return;
      }
      if (result.status !== 403) {
        await queryClient.invalidateQueries({ queryKey: ["mailbox"] });
      }
    },
    onError: async () => {
      await queryClient.invalidateQueries({ queryKey: ["mailbox"] });
    },
    retry: false,
  });

  if (messages.isLoading) {
    return (
      <div className="flex min-h-80 flex-1 items-center justify-center text-[var(--sea-ink-soft)]">
        <LoaderCircle aria-label="Loading messages" className="animate-spin" />
      </div>
    );
  }

  const status =
    messages.error instanceof MailboxMessagesRequestError
      ? messages.error.status
      : undefined;
  if (messages.data === undefined || status === 401 || status === 403) {
    const errorStatus = status ?? 502;
    const denied = errorStatus === 403;
    const invalid = errorStatus === 400;
    return (
      <WorkspaceStatus
        title={
          denied
            ? "Message access denied"
            : invalid
              ? "Message query is invalid"
              : "Messages could not be loaded"
        }
        detail={
          denied
            ? "Your session does not include mailbox message read access."
            : invalid
              ? "Change the search or filters and try again."
              : "The message service is temporarily unavailable."
        }
        onRetry={denied ? undefined : () => void messages.refetch()}
      />
    );
  }

  const { pages } = messages.data;
  const lastPage = pages.at(-1);
  const data = {
    items: pages.flatMap((page) => page.items),
    nextCursor: lastPage?.nextCursor,
  };
  const actionError = messageActionErrorText(
    messageAction.error !== null,
    messageAction.data
  );
  const executeMessageAction = (
    action: MessageRowAction,
    message: (typeof data.items)[number]
  ) => {
    messageAction.reset();
    messageAction.mutate(messageActionCommand(action, mailboxId, message));
  };

  return (
    <div className="grid h-full min-h-0 lg:grid-cols-[minmax(19rem,24rem)_minmax(0,1fr)]">
      <MessageList
        key={JSON.stringify(filters)}
        actionError={actionError}
        data={data}
        filters={filters}
        isLoadingMore={messages.isFetchingNextPage}
        loadMoreFailed={messages.isFetchNextPageError}
        onLoadMore={() => void messages.fetchNextPage()}
        onMessageAction={executeMessageAction}
        onOpenMessage={(nextThreadId, nextMessageId) =>
          void navigate({
            to: "/inbox",
            search: inboxSearchFor(selection, filters, {
              messageId: nextMessageId,
              threadId: nextThreadId,
            }),
          })
        }
        onQueryChange={(state) =>
          void navigate({
            to: "/inbox",
            search: inboxSearchFor(selection, state),
          })
        }
        onRetryAction={
          messageAction.error !== null && messageAction.variables !== undefined
            ? () => messageAction.mutate(messageAction.variables)
            : undefined
        }
        pendingMessageId={
          messageAction.isPending
            ? messageAction.variables?.messageId
            : undefined
        }
        selectedThreadId={threadId}
        selection={selection}
      />
      <ConversationPane
        filters={filters}
        mailboxId={mailboxId}
        messageId={messageId}
        onClose={() =>
          void navigate({
            to: "/inbox",
            search: inboxSearchFor(selection, filters),
          })
        }
        selection={selection}
        sessionId={sessionId}
        threadId={threadId}
      />
    </div>
  );
}

function AuthenticatedInbox({
  data,
  isSigningOut,
  onSignOut,
  search,
  sessionId,
  userId,
}: {
  readonly data: Schema.Codec.Encoded<typeof MailboxNavigationResult>;
  readonly isSigningOut: boolean;
  readonly onSignOut: () => void;
  readonly search: Schema.Schema.Type<typeof InboxSearch>;
  readonly sessionId: string;
  readonly userId: string;
}) {
  const { folders, labels, mailbox } = data;
  const { selectedFolder, selectedLabel } = resolveNavigationSelection(
    folders,
    labels,
    search
  );
  const selection: MailboxViewSelection | undefined =
    selectedLabel === undefined
      ? selectedFolder === undefined
        ? undefined
        : { folder: selectedFolder.id }
      : { label: selectedLabel.id };

  if (selection === undefined) {
    return <MailboxUnavailable status={404} />;
  }
  const filters: MailboxMessageQueryState = {
    hasAttachment: search.attachment === "true" || undefined,
    query: search.q,
    read: search.read,
    starred: search.starred === "true" || undefined,
  };

  return (
    <MailboxShell
      folders={folders}
      labels={labels}
      mailboxName={mailbox.displayName}
      principalLabel={userId}
      selectedFolderId={selectedFolder?.id}
      selectedLabelId={selectedLabel?.id}
      viewTitle={selectedLabel?.name ?? selectedFolder?.name ?? "Inbox"}
      isSigningOut={isSigningOut}
      onSignOut={onSignOut}
    >
      <MailboxWorkspace
        filters={filters}
        mailboxId={mailbox.id}
        messageId={search.message}
        selection={selection}
        sessionId={sessionId}
        threadId={search.thread}
      />
    </MailboxShell>
  );
}

function InboxRoute() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const queryClient = useQueryClient();
  const session = useQuery({
    queryKey: authSessionQueryKey,
    queryFn: ({ signal }) => currentSessionForQuery(signal),
    retry: false,
  });
  const navigation = useQuery({
    enabled: session.data !== null && session.data !== undefined,
    queryFn: () => getMailboxNavigation(),
    queryKey: [
      ...mailboxNavigationQueryKey,
      session.data?.userId,
      session.data?.sessionId,
    ],
    retry: false,
  });
  const logout = useMutation({
    mutationFn: () => authClient.session.logout(),
    retry: false,
    onSuccess: async () => {
      await clearCachedAuthSession(queryClient);
      await navigate({ to: "/" });
    },
  });

  if (session.isLoading || (session.data && navigation.isLoading)) {
    return (
      <main className="flex min-h-dvh items-center justify-center text-[var(--sea-ink-soft)]">
        <LoaderCircle aria-label="Loading mailbox" className="animate-spin" />
      </main>
    );
  }

  if (!session.data) {
    return <SignInRequired />;
  }

  if (navigation.error || !navigation.data?.ok) {
    const status = navigation.data?.ok === false ? navigation.data.status : 502;
    return (
      <MailboxUnavailable
        status={status}
        onRetry={() => void navigation.refetch()}
      />
    );
  }

  return (
    <AuthenticatedInbox
      data={navigation.data.navigation}
      isSigningOut={logout.isPending}
      onSignOut={() => logout.mutate()}
      search={search}
      sessionId={session.data.sessionId}
      userId={session.data.userId}
    />
  );
}
