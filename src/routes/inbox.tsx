import {
  skipToken,
  useInfiniteQuery,
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  ArrowLeft,
  CircleAlert,
  Inbox as InboxIcon,
  LoaderCircle,
  PenLine,
  RotateCcw,
} from "lucide-react";
import { useRef, useState } from "react";

import {
  authClient,
  authSessionQueryKey,
  clearCachedAuthSession,
  currentSessionForQuery,
  handleMailboxReadDenial,
  mailboxReadDenialQueryKey,
} from "../auth/client";
import { DraftEditor } from "../inbox/draft-editor";
import {
  mailboxMessageActionMutationKey,
  projectPendingMessageActions,
  projectPendingThreadActions,
  reconcileMailboxMessageActionCaches,
} from "../inbox/mailbox-query-state";
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
  DraftId,
  LabelId,
  MessageId,
  SearchQuery,
  ThreadId,
} from "../mailboxes/core";
import {
  CreateMailboxDraftCommand,
  DraftEditorContent,
  DraftEditorDraft,
  UpdateMailboxDraftCommand,
} from "../mailboxes/draft-editing";
import { MailboxMessageActionCommand } from "../mailboxes/message-actions";
import {
  MailboxMessageListInput,
  MailboxMessageView,
  OpenMailboxThreadInput,
} from "../mailboxes/message-reading";
import type { MailboxNavigationResult } from "../mailboxes/navigation";
import {
  getMailboxNavigation,
  getMailboxDraft,
  getMailboxThread,
  listMailboxMessages,
  actOnMailboxMessage,
  createMailboxDraft,
  updateMailboxDraft,
} from "../server/tanstack-functions";

const InboxSearch = Schema.Struct({
  attachment: Schema.optional(Schema.Literal("true")),
  compose: Schema.optional(Schema.Literal("true")),
  draft: Schema.optional(DraftId),
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
    if (search.compose !== undefined && search.draft !== undefined) {
      return "compose and draft cannot be selected together";
    }
    if (
      (search.compose !== undefined || search.draft !== undefined) &&
      (search.thread !== undefined || search.message !== undefined)
    ) {
      return "draft editor and conversation cannot be selected together";
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
const decodeMailboxMessageActionOption = Schema.decodeUnknownOption(
  MailboxMessageActionCommand
);
const decodeCreateMailboxDraft = Schema.decodeUnknownSync(
  CreateMailboxDraftCommand
);
const decodeDraftEditorContent = Schema.decodeUnknownSync(DraftEditorContent);
const decodeDraftEditorDraft = Schema.decodeUnknownSync(DraftEditorDraft);
const decodeUpdateMailboxDraft = Schema.decodeUnknownSync(
  UpdateMailboxDraftCommand
);
const mailboxNavigationQueryKey = ["mailbox", "navigation"] as const;
const emptyDraftContent = decodeDraftEditorContent({
  bcc: [],
  cc: [],
  subject: "",
  to: [],
});

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
  result:
    | {
        readonly error?: { readonly code?: string };
        readonly ok: boolean;
        readonly status?: number;
      }
    | undefined
) => {
  if (result?.ok !== false) {
    return;
  }
  if (result.status === 401) {
    return "Your session ended. Sign in again to change messages.";
  }
  if (result.error?.code === "request_rejected") {
    return "The message action request was rejected.";
  }
  if (result.status === 403) {
    return "You do not have permission to change this message.";
  }
  if (result.status === 404) {
    return "The message no longer exists. Refreshing the mailbox.";
  }
  return result.status === 409
    ? "The message changed. Refreshing its latest state."
    : "The message action could not be completed.";
};

const conversationFailure = (status: number) => {
  switch (status) {
    case 401: {
      return {
        detail: "Sign in again to continue reading this mailbox.",
        retryable: false,
        title: "Session ended",
      };
    }
    case 403: {
      return {
        detail: "Your session does not include access to this conversation.",
        retryable: false,
        title: "Conversation access denied",
      };
    }
    case 404: {
      return {
        detail: "This conversation may have been removed or moved.",
        retryable: false,
        title: "Conversation not found",
      };
    }
    default: {
      return {
        detail: "The conversation could not be loaded.",
        retryable: true,
        title: "Conversation unavailable",
      };
    }
  }
};

const messageListFailure = (status: number) => {
  switch (status) {
    case 403: {
      return {
        detail: "Your session does not include mailbox message read access.",
        retryable: false,
        title: "Message access denied",
      };
    }
    case 404: {
      return {
        detail: "This mailbox view may have been removed or changed.",
        retryable: false,
        title: "Messages not found",
      };
    }
    case 400: {
      return {
        detail: "Change the search or filters and try again.",
        retryable: true,
        title: "Message query is invalid",
      };
    }
    default: {
      return {
        detail: "The message service is temporarily unavailable.",
        retryable: true,
        title: "Messages could not be loaded",
      };
    }
  }
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
  context = "mailbox",
  onRetry,
  status,
}: {
  readonly context?: "mailbox" | "session";
  readonly onRetry?: () => void;
  readonly status: number;
}) {
  const sessionFailure = context === "session";
  const denied = status === 403;
  const missing = status === 404;
  const title = sessionFailure
    ? "We could not verify your session"
    : denied
      ? "You cannot open this mailbox"
      : missing
        ? "No mailbox is ready yet"
        : "We could not load your mailbox";
  const detail = sessionFailure
    ? "The session service is unavailable. Retry before signing in again."
    : denied
      ? "Your session is valid, but it does not include mailbox read access."
      : missing
        ? "Return home to create or activate your primary mailbox."
        : "The mailbox service returned an invalid or unavailable response.";

  return (
    <main className="flex min-h-dvh items-center justify-center px-5 py-10">
      <section
        role="alert"
        aria-live="polite"
        className="island-shell w-full max-w-lg rounded-[2rem] p-8 text-center sm:p-10"
      >
        <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-[var(--sand)] text-[var(--palm)]">
          <InboxIcon size={26} />
        </span>
        <p className="island-kicker mt-7">
          {sessionFailure ? "Session unavailable" : "Mailbox unavailable"}
        </p>
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
    <section
      role="alert"
      aria-live="polite"
      className="flex min-h-80 flex-1 items-center justify-center bg-white/48 px-6 text-center"
    >
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
  pendingActions,
  selection,
  sessionId,
  threadId,
}: {
  readonly filters: MailboxMessageQueryState;
  readonly mailboxId: string;
  readonly messageId?: string;
  readonly onClose: () => void;
  readonly pendingActions: readonly Schema.Schema.Type<
    typeof MailboxMessageActionCommand
  >[];
  readonly selection: MailboxViewSelection;
  readonly sessionId: string;
  readonly threadId?: string;
}) {
  const queryClient = useQueryClient();
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
        : async () => {
            const result = await getMailboxThread({ data: threadInput });
            await handleMailboxReadDenial(queryClient, result);
            return result;
          },
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
      <output className="flex min-h-80 flex-1 items-center justify-center text-[var(--sea-ink-soft)]">
        <LoaderCircle
          aria-label="Loading conversation"
          className="animate-spin"
        />
      </output>
    );
  }
  if (thread.error || !thread.data?.ok) {
    const status = thread.data?.ok === false ? thread.data.status : 502;
    const failure = conversationFailure(status);
    return (
      <WorkspaceStatus
        backHref={mailboxViewHref(selection, undefined, undefined, filters)}
        onBack={onClose}
        title={failure.title}
        detail={failure.detail}
        onRetry={failure.retryable ? () => void thread.refetch() : undefined}
      />
    );
  }

  return (
    <ThreadView
      data={projectPendingThreadActions(thread.data.thread, pendingActions)}
      filters={filters}
      mailboxId={mailboxId}
      onClose={onClose}
      onPreviewAccessFailure={(status) => {
        if (status === 401) {
          void clearCachedAuthSession(queryClient);
        } else {
          void handleMailboxReadDenial(queryClient, { ok: false, status });
        }
      }}
      selection={selection}
    />
  );
}

function MailboxWorkspace({
  archiveFolderId,
  filters,
  mailboxId,
  messageId,
  selection,
  sessionId,
  trashFolderId,
  threadId,
}: {
  readonly archiveFolderId?: string;
  readonly filters: MailboxMessageQueryState;
  readonly mailboxId: string;
  readonly messageId?: string;
  readonly selection: MailboxViewSelection;
  readonly sessionId: string;
  readonly trashFolderId?: string;
  readonly threadId?: string;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pendingMessageLocks = useRef(new Set<string>());
  const [actionFailures, setActionFailures] = useState<
    readonly {
      readonly command: Schema.Schema.Type<typeof MailboxMessageActionCommand>;
      readonly retryable: boolean;
      readonly text: string;
    }[]
  >([]);
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
      await handleMailboxReadDenial(queryClient, result);
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
  const actionMutationKey = [
    ...mailboxMessageActionMutationKey,
    sessionId,
    mailboxId,
  ] as const;
  const pendingActions = useMutationState<
    Schema.Schema.Type<typeof MailboxMessageActionCommand> | undefined
  >({
    filters: { mutationKey: actionMutationKey, status: "pending" },
    select: (mutation) =>
      Option.getOrUndefined(
        decodeMailboxMessageActionOption(mutation.state.variables)
      ),
  }).filter(
    (
      command
    ): command is Schema.Schema.Type<typeof MailboxMessageActionCommand> =>
      command !== undefined
  );
  const pendingMessageIds = new Set(
    pendingActions.map((command) => command.messageId)
  );
  const clearActionFailure = (failedMessageId: string) =>
    setActionFailures((current) =>
      current.filter((failure) => failure.command.messageId !== failedMessageId)
    );
  const recordActionFailure = (
    command: Schema.Schema.Type<typeof MailboxMessageActionCommand>,
    text: string,
    retryable: boolean
  ) =>
    setActionFailures((current) => [
      ...current.filter(
        (failure) => failure.command.messageId !== command.messageId
      ),
      { command, retryable, text },
    ]);
  const messageAction = useMutation({
    mutationKey: actionMutationKey,
    mutationFn: (
      command: Schema.Schema.Type<typeof MailboxMessageActionCommand>
    ) => actOnMailboxMessage({ data: command }),
    onSuccess: (result, command) => {
      if (!result.ok && result.status === 401) {
        clearActionFailure(command.messageId);
        void clearCachedAuthSession(queryClient);
        return;
      }
      if (result.ok) {
        clearActionFailure(command.messageId);
        reconcileMailboxMessageActionCaches(
          queryClient,
          command,
          result.action
        );
        void queryClient.invalidateQueries({ queryKey: ["mailbox"] });
        return;
      }
      recordActionFailure(
        command,
        messageActionErrorText(result) ??
          "The message action could not be completed.",
        result.status === 500 || result.status === 502
      );
      if (result.status === 404 || result.status === 409) {
        void Promise.all([
          queryClient.resetQueries({ queryKey: ["mailbox", "messages"] }),
          queryClient.resetQueries({ queryKey: ["mailbox", "thread"] }),
          queryClient.invalidateQueries({
            queryKey: ["mailbox", "navigation"],
          }),
        ]);
        return;
      }
      if (result.status !== 403) {
        void queryClient.invalidateQueries({ queryKey: ["mailbox"] });
      }
    },
    onError: (_error, command) => {
      recordActionFailure(
        command,
        "The message action could not be completed.",
        true
      );
      void queryClient.invalidateQueries({ queryKey: ["mailbox"] });
    },
    onSettled: (_result, _error, command) => {
      pendingMessageLocks.current.delete(command.messageId);
    },
    retry: false,
  });

  if (messages.isLoading) {
    return (
      <output className="flex min-h-80 flex-1 items-center justify-center text-[var(--sea-ink-soft)]">
        <LoaderCircle aria-label="Loading messages" className="animate-spin" />
      </output>
    );
  }

  const status =
    messages.error instanceof MailboxMessagesRequestError
      ? messages.error.status
      : undefined;
  const blockingError =
    messages.data === undefined || (messages.error !== null && status === 404);
  if (messages.data === undefined || blockingError) {
    const errorStatus = status ?? 502;
    const failure = messageListFailure(errorStatus);
    return (
      <WorkspaceStatus
        title={failure.title}
        detail={failure.detail}
        onRetry={failure.retryable ? () => void messages.refetch() : undefined}
      />
    );
  }

  const { pages } = messages.data;
  const lastPage = pages.at(-1);
  const data = projectPendingMessageActions(
    {
      items: pages.flatMap((page) => page.items),
      nextCursor: lastPage?.nextCursor,
    },
    pendingActions,
    selection,
    filters,
    { archiveFolderId, trashFolderId }
  );
  const submitMessageAction = (
    command: Schema.Schema.Type<typeof MailboxMessageActionCommand>
  ) => {
    if (
      pendingMessageLocks.current.has(command.messageId) ||
      pendingMessageIds.has(command.messageId)
    ) {
      return;
    }
    messageAction.reset();
    clearActionFailure(command.messageId);
    pendingMessageLocks.current.add(command.messageId);
    messageAction.mutate(command);
  };
  const executeMessageAction = (
    action: MessageRowAction,
    message: (typeof data.items)[number]
  ) => submitMessageAction(messageActionCommand(action, mailboxId, message));

  return (
    <div className="grid h-full min-h-0 lg:grid-cols-[minmax(19rem,24rem)_minmax(0,1fr)]">
      <MessageList
        key={JSON.stringify(filters)}
        actionErrors={actionFailures.map((failure) => ({
          handleRetry: failure.retryable
            ? () => submitMessageAction(failure.command)
            : undefined,
          messageId: failure.command.messageId,
          text: failure.text,
        }))}
        archiveFolderId={archiveFolderId}
        data={data}
        filters={filters}
        isLoadingMore={messages.isFetchingNextPage}
        isRefreshing={messages.isFetching && !messages.isFetchingNextPage}
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
        onRetryRefresh={() => void messages.refetch()}
        pendingMessageIds={pendingMessageIds}
        selectedThreadId={threadId}
        selection={selection}
        refreshFailed={
          messages.data !== undefined &&
          messages.error !== null &&
          !messages.isFetchNextPageError
        }
        trashFolderId={trashFolderId}
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
        pendingActions={pendingActions}
        selection={selection}
        sessionId={sessionId}
        threadId={threadId}
      />
    </div>
  );
}

type DraftSaveCommand =
  | Schema.Schema.Type<typeof CreateMailboxDraftCommand>
  | Schema.Schema.Type<typeof UpdateMailboxDraftCommand>;

const draftSaveErrorText = (status: number) => {
  if (status === 400) {
    return "Check the draft fields and try again.";
  }
  if (status === 401) {
    return "Your session ended. Sign in again to save this draft.";
  }
  if (status === 403) {
    return "You do not have permission to edit drafts in this mailbox.";
  }
  if (status === 404) {
    return "This draft no longer exists.";
  }
  return status === 409
    ? "This draft changed elsewhere. Close and reopen it before saving again."
    : "The draft could not be saved. Your local content is still here.";
};

// oxlint-disable-next-line eslint/complexity -- One component owns load, exact-command retry, and CAS save state.
function DraftWorkspace({
  draftId,
  filters,
  mailboxId,
  onClose,
  onCreated,
  sessionId,
}: {
  readonly draftId?: string;
  readonly filters: MailboxMessageQueryState;
  readonly mailboxId: string;
  readonly onClose: () => void;
  readonly onCreated: (draftId: string) => void;
  readonly sessionId: string;
}) {
  const queryClient = useQueryClient();
  const [saved, setSaved] = useState(false);
  const [failure, setFailure] = useState<{
    readonly command: DraftSaveCommand;
    readonly message: string;
    readonly retryable: boolean;
  }>();
  const draftQueryKey = [
    "mailbox",
    "draft",
    sessionId,
    mailboxId,
    draftId,
  ] as const;
  const draft = useQuery({
    queryFn:
      draftId === undefined
        ? skipToken
        : async () => {
            const result = await getMailboxDraft({
              data: { draftId, mailboxId },
            });
            if (!result.ok && result.status === 401) {
              await clearCachedAuthSession(queryClient);
            }
            return result;
          },
    queryKey: draftQueryKey,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const save = useMutation({
    mutationFn: (command: DraftSaveCommand) =>
      "draftId" in command
        ? updateMailboxDraft({ data: command })
        : createMailboxDraft({ data: command }),
    onError: (_error, command) => {
      setSaved(false);
      setFailure({
        command,
        message:
          "The draft could not be saved. Your local content is still here.",
        retryable: true,
      });
    },
    onSuccess: (result, command) => {
      if (!result.ok) {
        setSaved(false);
        setFailure({
          command,
          message: draftSaveErrorText(result.status),
          retryable: result.status === 500 || result.status === 502,
        });
        if (result.status === 401) {
          void clearCachedAuthSession(queryClient);
        }
        return;
      }
      setFailure(undefined);
      setSaved(true);
      void queryClient.invalidateQueries({
        queryKey: ["mailbox", "navigation"],
      });
      if (!("draftId" in command)) {
        onCreated(result.draft.id);
        return;
      }
      queryClient.setQueryData(draftQueryKey, result);
    },
    retry: false,
  });

  if (draftId !== undefined && draft.isLoading) {
    return (
      <output className="flex h-full min-h-80 items-center justify-center text-[var(--sea-ink-soft)]">
        <LoaderCircle aria-label="Loading draft" className="animate-spin" />
      </output>
    );
  }
  if (draftId !== undefined && (draft.error || !draft.data?.ok)) {
    const status = draft.data?.ok === false ? draft.data.status : 502;
    return (
      <WorkspaceStatus
        title={status === 404 ? "Draft not found" : "Draft unavailable"}
        detail={
          status === 403
            ? "Your session does not include access to this draft."
            : status === 404
              ? "This draft may have been removed."
              : "The draft could not be loaded."
        }
        onBack={onClose}
        backHref={mailboxViewHref({}, undefined, undefined, filters)}
        onRetry={
          status === 500 || status === 502
            ? () => void draft.refetch()
            : undefined
        }
      />
    );
  }

  const current = draft.data?.ok
    ? decodeDraftEditorDraft(draft.data.draft)
    : undefined;
  const submit = (content: Schema.Schema.Type<typeof DraftEditorContent>) => {
    setSaved(false);
    setFailure(undefined);
    const common = {
      content,
      mailboxId,
      operationId: crypto.randomUUID(),
    };
    const command =
      current === undefined
        ? decodeCreateMailboxDraft(common)
        : decodeUpdateMailboxDraft({
            ...common,
            draftId: current.id,
            expectedVersion: current.version,
          });
    save.mutate(command);
  };

  return (
    <DraftEditor
      key={current?.id ?? "new"}
      error={failure?.message}
      initial={current?.content ?? emptyDraftContent}
      isNew={current === undefined}
      isSaving={save.isPending}
      onClose={onClose}
      onRetry={
        failure?.retryable === true
          ? () => save.mutate(failure.command)
          : undefined
      }
      onSave={submit}
      saved={saved}
    />
  );
}

function AuthenticatedInbox({
  data,
  isSigningOut,
  onSignOut,
  signOutError,
  search,
  sessionId,
  userId,
}: {
  readonly data: Schema.Codec.Encoded<typeof MailboxNavigationResult>;
  readonly isSigningOut: boolean;
  readonly onSignOut: () => void;
  readonly signOutError?: string;
  readonly search: Schema.Schema.Type<typeof InboxSearch>;
  readonly sessionId: string;
  readonly userId: string;
}) {
  const navigate = useNavigate();
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
  const archiveFolderId = folders.find(
    (folder) => folder.kind === "archive"
  )?.id;
  const trashFolderId = folders.find((folder) => folder.kind === "trash")?.id;
  const draftEditorOpen =
    search.compose === "true" || search.draft !== undefined;
  const closeEditor = () =>
    void navigate({
      to: "/inbox",
      search: inboxSearchFor(selection, filters),
    });

  return (
    <MailboxShell
      folders={folders}
      labels={labels}
      mailboxName={mailbox.displayName}
      headerAction={
        draftEditorOpen ? undefined : (
          <button
            type="button"
            aria-label="Compose new draft"
            onClick={() =>
              void navigate({
                to: "/inbox",
                search: decodeInboxSearch({
                  ...selection,
                  compose: "true",
                }),
              })
            }
            className="inline-flex items-center gap-2 rounded-xl bg-[var(--sea-ink)] px-3 py-2.5 text-xs font-extrabold text-white shadow-[0_9px_22px_rgba(23,58,64,0.16)] sm:px-4"
          >
            <PenLine size={15} />{" "}
            <span className="hidden sm:inline">Compose</span>
          </button>
        )
      }
      principalLabel={userId}
      selectedFolderId={selectedFolder?.id}
      selectedLabelId={selectedLabel?.id}
      viewTitle={
        search.compose === "true"
          ? "Compose"
          : search.draft === undefined
            ? (selectedLabel?.name ?? selectedFolder?.name ?? "Inbox")
            : "Edit draft"
      }
      isSigningOut={isSigningOut}
      onSignOut={onSignOut}
      signOutError={signOutError}
    >
      {draftEditorOpen ? (
        <DraftWorkspace
          key={search.draft ?? "compose"}
          draftId={search.draft}
          filters={filters}
          mailboxId={mailbox.id}
          onClose={closeEditor}
          onCreated={(draftId) =>
            void navigate({
              to: "/inbox",
              search: decodeInboxSearch({ ...selection, draft: draftId }),
            })
          }
          sessionId={sessionId}
        />
      ) : (
        <MailboxWorkspace
          archiveFolderId={archiveFolderId}
          filters={filters}
          mailboxId={mailbox.id}
          messageId={search.message}
          selection={selection}
          sessionId={sessionId}
          threadId={search.thread}
          trashFolderId={trashFolderId}
        />
      )}
    </MailboxShell>
  );
}

function InboxRoute() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const queryClient = useQueryClient();
  const mailboxDenial = useQuery<{ readonly status: 403 }>({
    queryFn: skipToken,
    queryKey: mailboxReadDenialQueryKey,
  });
  const session = useQuery({
    queryKey: authSessionQueryKey,
    queryFn: ({ signal }) => currentSessionForQuery(signal),
    retry: false,
  });
  const navigation = useQuery({
    enabled:
      session.data !== null &&
      session.data !== undefined &&
      mailboxDenial.data?.status !== 403,
    queryFn: async () => {
      const result = await getMailboxNavigation();
      await handleMailboxReadDenial(queryClient, result);
      return result;
    },
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
      <output className="flex min-h-dvh items-center justify-center text-[var(--sea-ink-soft)]">
        <LoaderCircle aria-label="Loading mailbox" className="animate-spin" />
      </output>
    );
  }

  if (session.error) {
    return (
      <MailboxUnavailable
        context="session"
        status={502}
        onRetry={() => void session.refetch()}
      />
    );
  }

  if (!session.data) {
    return <SignInRequired />;
  }

  if (mailboxDenial.data?.status === 403) {
    return <MailboxUnavailable status={403} />;
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
      signOutError={
        logout.error === null ? undefined : "Sign out failed. Try again."
      }
      search={search}
      sessionId={session.data.sessionId}
      userId={session.data.userId}
    />
  );
}
