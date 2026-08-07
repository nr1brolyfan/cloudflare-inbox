import {
  skipToken,
  useInfiniteQuery,
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  createFileRoute,
  Link,
  redirect,
  useNavigate,
} from "@tanstack/react-router";
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
  getMailboxNavigation,
  getMailboxOutboundDelivery,
  getMailboxDraft,
  getMailboxThread,
  actOnMailboxMessage,
  createMailboxDraft,
  createMailboxReplyDraft,
  reserveMailboxDraftAttachment,
  sendMailboxDraft,
  undoMailboxSend,
  updateMailboxDraft,
} from "#/apps/website/TanStackFunctions";
import {
  authClient,
  authSessionQueryKey,
  clearCachedAuthSession,
  currentSessionForQuery,
  handleMailboxReadDenial,
  mailboxReadDenialQueryKey,
} from "#/modules/account-security/adapters/browser/AuthClient";
import {
  clearPendingReplyCommand,
  persistPendingReplyCommand,
  readPendingReplyCommand,
  replyCommandsHaveSameTarget,
  retainReplyOperationForStatus,
} from "#/modules/mailbox/adapters/browser/ReplyDraftOperationStorage";
import {
  DraftEditor,
  draftSendErrorText,
} from "#/modules/mailbox/adapters/react/DraftEditor";
import { DraftList } from "#/modules/mailbox/adapters/react/DraftList";
import {
  mailboxMessageActionMutationKey,
  projectPendingMessageActions,
  projectPendingThreadActions,
  reconcileMailboxMessageActionCaches,
} from "#/modules/mailbox/adapters/react/MailboxQueryState";
import {
  decodeMailboxSearch,
  isSystemFolderId,
  MailboxSearch,
  mailboxRouteSearch,
  systemFolderPath,
} from "#/modules/mailbox/adapters/react/MailboxRouting";
import type { SystemFolderId } from "#/modules/mailbox/adapters/react/MailboxRouting";
import { MailboxShell } from "#/modules/mailbox/adapters/react/MailboxShell";
import type {
  MailboxMessageQueryState,
  MailboxViewSelection,
} from "#/modules/mailbox/adapters/react/MailboxViewLinks";
import { mailboxViewHref } from "#/modules/mailbox/adapters/react/MailboxViewLinks";
import type { MessageRowAction } from "#/modules/mailbox/adapters/react/MessageList";
import { MessageList } from "#/modules/mailbox/adapters/react/MessageList";
import type { OutboundDeliverySnapshot } from "#/modules/mailbox/adapters/react/OutboundDeliveryTracker";
import {
  OutboundDeliveryTracker,
  outboundDeliveryQueryKey,
} from "#/modules/mailbox/adapters/react/OutboundDeliveryTracker";
import {
  NoThreadSelected,
  ThreadView,
} from "#/modules/mailbox/adapters/react/ThreadView";
import {
  CreateMailboxDraftCommand,
  DraftEditorContent,
  DraftEditorDraft,
  UpdateMailboxDraftCommand,
} from "#/modules/mailbox/application/MailboxDraftEditing";
import { MailboxMessageActionCommand } from "#/modules/mailbox/application/MailboxMessageActions";
import {
  MailboxMessageView,
  OpenMailboxThreadInput,
} from "#/modules/mailbox/application/MailboxMessageReading";
import { SendMailboxDraftCommand } from "#/modules/mailbox/application/MailboxOutboundSending";
import { CreateMailboxReplyDraftCommand } from "#/modules/mailbox/application/MailboxReplyDraftCreation";
import {
  DraftAttachmentUploadResult,
  draftAttachmentMaxBytes,
  ReserveDraftAttachmentCommand,
} from "#/modules/mailbox/domain/MailboxDraftAttachment";
import type { MailboxNavigationResult } from "#/modules/organization/application/MailboxNavigation";
import {
  mailboxDraftListQueryOptions,
  mailboxMessageListQueryOptions,
  MailboxRequestError,
} from "#/routes/-mailbox-queries";

const InboxSearch = MailboxSearch;
const decodeInboxSearch = decodeMailboxSearch;

type MailboxNavigateOptions =
  | {
      readonly replace?: boolean;
      readonly search: Schema.Schema.Type<typeof InboxSearch>;
      readonly to: "/inbox";
    }
  | { readonly replace?: boolean; readonly to: "/" };

const navigateToMailbox = (
  navigate: ReturnType<typeof useNavigate>,
  search: Schema.Schema.Type<typeof InboxSearch>,
  replace = false
) => {
  const routeSearch = mailboxRouteSearch(search);
  if (search.draft !== undefined) {
    return navigate({
      params: { draftId: search.draft },
      replace,
      search: routeSearch,
      to: "/mail/drafts/$draftId",
    });
  }
  if (search.compose === "true") {
    return navigate({ replace, search: routeSearch, to: "/mail/compose" });
  }
  if (search.label !== undefined) {
    return navigate({
      params: { labelId: search.label },
      replace,
      search: routeSearch,
      to: "/mail/labels/$labelId",
    });
  }
  const folderId = search.folder ?? "inbox";
  return isSystemFolderId(folderId)
    ? navigate({
        replace,
        search: routeSearch,
        to: systemFolderPath(folderId as SystemFolderId),
      })
    : navigate({
        params: { folderId },
        replace,
        search: routeSearch,
        to: "/mail/folders/$folderId",
      });
};

const useMailboxNavigate = () => {
  const navigate = useNavigate();
  return (options: MailboxNavigateOptions) =>
    options.to === "/inbox"
      ? navigateToMailbox(navigate, options.search, options.replace)
      : navigate(options);
};
const decodeMailboxMessageView = Schema.decodeUnknownSync(MailboxMessageView);
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
const decodeCreateMailboxReplyDraft = Schema.decodeUnknownSync(
  CreateMailboxReplyDraftCommand
);
const decodeDraftEditorContent = Schema.decodeUnknownSync(DraftEditorContent);
const decodeDraftEditorDraft = Schema.decodeUnknownSync(DraftEditorDraft);
const decodeUpdateMailboxDraft = Schema.decodeUnknownSync(
  UpdateMailboxDraftCommand
);
const decodeReserveDraftAttachment = Schema.decodeUnknownSync(
  ReserveDraftAttachmentCommand
);
const decodeSendMailboxDraft = Schema.decodeUnknownSync(
  SendMailboxDraftCommand
);
const decodeDraftAttachmentUploadResult = Schema.decodeUnknownSync(
  DraftAttachmentUploadResult
);
const mailboxNavigationQueryKey = ["mailbox", "navigation"] as const;
const emptyDraftContent = decodeDraftEditorContent({
  bcc: [],
  cc: [],
  subject: "",
  to: [],
});

const inboxSearchFor = (
  selection: MailboxViewSelection,
  filters: MailboxMessageQueryState,
  open?: { readonly messageId: string; readonly threadId: string }
) =>
  decodeInboxSearch({
    ...selection,
    attachment: filters.hasAttachment ? "true" : undefined,
    delivery: filters.delivery,
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

const draftListFailure = (status: number) => {
  if (status === 403) {
    return {
      detail: "Your session does not include permission to edit drafts.",
      retryable: false,
      title: "Draft access denied",
    };
  }
  if (status === 400) {
    return {
      detail: "The draft page cursor is no longer valid.",
      retryable: true,
      title: "Draft query is invalid",
    };
  }
  return {
    detail: "The draft service is temporarily unavailable.",
    retryable: true,
    title: "Drafts could not be loaded",
  };
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
  beforeLoad: ({ search }) => {
    const routeSearch = mailboxRouteSearch(search);
    if (search.draft !== undefined) {
      throw redirect({
        params: { draftId: search.draft },
        replace: true,
        search: routeSearch,
        to: "/mail/drafts/$draftId",
      });
    }
    if (search.compose === "true") {
      throw redirect({
        replace: true,
        search: routeSearch,
        to: "/mail/compose",
      });
    }
    if (search.label !== undefined) {
      throw redirect({
        params: { labelId: search.label },
        replace: true,
        search: routeSearch,
        to: "/mail/labels/$labelId",
      });
    }
    const folderId = search.folder ?? "inbox";
    throw isSystemFolderId(folderId)
      ? redirect({
          replace: true,
          search: routeSearch,
          to: systemFolderPath(folderId as SystemFolderId),
        })
      : redirect({
          params: { folderId },
          replace: true,
          search: routeSearch,
          to: "/mail/folders/$folderId",
        });
  },
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
          {!denied && onRetry ? (
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
  const navigate = useMailboxNavigate();
  const queryClient = useQueryClient();
  const [replyFailure, setReplyFailure] = useState<{
    readonly command: Schema.Schema.Type<typeof CreateMailboxReplyDraftCommand>;
    readonly retainOperation: boolean;
  }>();
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
  const reply = useMutation({
    mutationFn: (
      command: Schema.Schema.Type<typeof CreateMailboxReplyDraftCommand>
    ) => {
      persistPendingReplyCommand(window.sessionStorage, command);
      return createMailboxReplyDraft({ data: command });
    },
    onError: (_error, command) =>
      setReplyFailure({ command, retainOperation: true }),
    onMutate: () => setReplyFailure(undefined),
    onSuccess: (result, command) => {
      if (!result.ok) {
        const retainOperation = retainReplyOperationForStatus(result.status);
        if (!retainOperation) {
          clearPendingReplyCommand(window.sessionStorage, command);
        }
        setReplyFailure({
          command,
          retainOperation,
        });
        if (result.status === 401) {
          void clearCachedAuthSession(queryClient);
        }
        return;
      }
      clearPendingReplyCommand(window.sessionStorage, command);
      setReplyFailure(undefined);
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["mailbox", "navigation"] }),
        queryClient.invalidateQueries({ queryKey: ["mailbox", "drafts"] }),
      ]);
      void navigate({
        to: "/inbox",
        search: decodeInboxSearch({
          ...selection,
          delivery: filters.delivery,
          draft: result.draft.id,
        }),
      });
    },
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
      onReply={(targetMessageId) => {
        const failed = replyFailure?.command;
        const target = decodeCreateMailboxReplyDraft({
          ...view,
          messageId: targetMessageId,
          operationId: crypto.randomUUID(),
          threadId,
        });
        const pending = readPendingReplyCommand(window.sessionStorage, target);
        reply.mutate(
          failed !== undefined &&
            replyCommandsHaveSameTarget(failed, target) &&
            replyFailure?.retainOperation === true
            ? failed
            : (pending ?? target)
        );
      }}
      replyError={
        replyFailure === undefined
          ? undefined
          : {
              messageId: replyFailure.command.messageId,
              retryable: replyFailure.retainOperation,
            }
      }
      replyingMessageId={
        reply.isPending ? reply.variables?.messageId : undefined
      }
      selection={selection}
    />
  );
}

function DraftListWorkspace({
  deliveryId,
  folderId,
  mailboxId,
  sessionId,
}: {
  readonly deliveryId?: string;
  readonly folderId: string;
  readonly mailboxId: string;
  readonly sessionId: string;
}) {
  const navigate = useMailboxNavigate();
  const queryClient = useQueryClient();
  const drafts = useInfiniteQuery(
    mailboxDraftListQueryOptions({ mailboxId, queryClient, sessionId })
  );

  if (drafts.isLoading) {
    return (
      <output className="flex min-h-80 flex-1 items-center justify-center text-[var(--sea-ink-soft)]">
        <LoaderCircle aria-label="Loading drafts" className="animate-spin" />
      </output>
    );
  }

  if (drafts.data === undefined) {
    const status =
      drafts.error instanceof MailboxRequestError ? drafts.error.status : 502;
    const failure = draftListFailure(status);
    return (
      <WorkspaceStatus
        title={failure.title}
        detail={failure.detail}
        onRetry={failure.retryable ? () => void drafts.refetch() : undefined}
      />
    );
  }

  const lastPage = drafts.data.pages.at(-1);
  return (
    <DraftList
      data={{
        items: drafts.data.pages.flatMap((page) => page.items),
        nextCursor: lastPage?.nextCursor,
      }}
      deliveryId={deliveryId}
      folderId={folderId}
      isLoadingMore={drafts.isFetchingNextPage}
      loadMoreFailed={drafts.isFetchNextPageError}
      onLoadMore={() => void drafts.fetchNextPage()}
      onOpenDraft={(draftId) =>
        void navigate({
          to: "/inbox",
          search: decodeInboxSearch({
            delivery: deliveryId,
            draft: draftId,
            folder: folderId,
          }),
        })
      }
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
  const navigate = useMailboxNavigate();
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
  const messages = useInfiniteQuery(
    mailboxMessageListQueryOptions({
      filters,
      mailboxId,
      queryClient,
      sessionId,
      view,
    })
  );
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
        void Promise.all([
          queryClient.invalidateQueries({ queryKey: ["mailbox", "messages"] }),
          queryClient.invalidateQueries({ queryKey: ["mailbox", "thread"] }),
          queryClient.invalidateQueries({
            queryKey: mailboxNavigationQueryKey,
          }),
        ]);
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
          queryClient.invalidateQueries({ queryKey: ["mailbox", "messages"] }),
          queryClient.invalidateQueries({ queryKey: ["mailbox", "thread"] }),
          queryClient.invalidateQueries({
            queryKey: ["mailbox", "navigation"],
          }),
        ]);
        return;
      }
      if (result.status !== 403) {
        void queryClient.invalidateQueries({
          queryKey: ["mailbox", "messages"],
        });
      }
    },
    onError: (_error, command) => {
      recordActionFailure(
        command,
        "The message action could not be completed.",
        true
      );
      void queryClient.invalidateQueries({ queryKey: ["mailbox", "messages"] });
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
    messages.error instanceof MailboxRequestError
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
        key={`${mailboxId}:${selection.folder ?? selection.label}:${threadId ?? "none"}:${messageId ?? "none"}`}
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
type DraftSendCommand = Schema.Schema.Type<typeof SendMailboxDraftCommand>;

interface PendingDraftAttachment {
  readonly file: File;
  readonly id: string;
  readonly operationId: string;
  readonly progress: number;
  readonly retryable: boolean;
  readonly reservationId?: string;
  readonly status: "reserving" | "uploading" | "failed";
  readonly error?: string;
}

const uploadReservedAttachment = (
  input: {
    readonly attachmentId: string;
    readonly draftId: string;
    readonly file: File;
    readonly mailboxId: string;
  },
  onProgress: (progress: number) => void
) =>
  // oxlint-disable-next-line promise/avoid-new -- XMLHttpRequest is required for browser upload progress events.
  new Promise<Schema.Schema.Type<typeof DraftAttachmentUploadResult>>(
    (resolve, reject) => {
      const request = new XMLHttpRequest();
      request.open(
        "PUT",
        `/api/mailboxes/${encodeURIComponent(input.mailboxId)}/drafts/${encodeURIComponent(input.draftId)}/attachments/${encodeURIComponent(input.attachmentId)}/content`
      );
      request.setRequestHeader("content-type", "application/octet-stream");
      request.upload.addEventListener("progress", (event) => {
        if (event.lengthComputable && event.total > 0) {
          onProgress(
            Math.min(100, Math.round((event.loaded / event.total) * 100))
          );
        }
      });
      request.addEventListener("load", () => {
        if (request.status < 200 || request.status >= 300) {
          reject(new Error(`upload:${request.status}`));
          return;
        }
        try {
          resolve(
            decodeDraftAttachmentUploadResult(JSON.parse(request.responseText))
          );
        } catch (error) {
          reject(error);
        }
      });
      request.addEventListener("error", () =>
        reject(new Error("upload:network"))
      );
      request.send(input.file);
    }
  );

const attachmentUploadFailure = (error: unknown) => {
  const status =
    error instanceof Error && /^(?:reserve|upload):\d+$/u.test(error.message)
      ? Number(error.message.split(":")[1])
      : undefined;
  if (status === 409) {
    return {
      message:
        "The upload reservation expired. Dismiss this file and add it again.",
      retryable: false,
      status,
    };
  }
  if (status === 401 || status === 403) {
    return {
      message:
        status === 401
          ? "Your session ended before this file was uploaded."
          : "You do not have permission to upload this file.",
      retryable: false,
      status,
    };
  }
  if (status === 400 || status === 404) {
    return {
      message: "This file cannot use the current upload reservation.",
      retryable: false,
      status,
    };
  }
  return {
    message: "Upload failed. Retry with the same secure reservation.",
    retryable: status === undefined || status >= 500,
    status,
  };
};

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
  onSent,
  sessionId,
}: {
  readonly draftId?: string;
  readonly filters: MailboxMessageQueryState;
  readonly mailboxId: string;
  readonly onClose: () => void;
  readonly onCreated: (draftId: string) => void;
  readonly onSent: (outbound: OutboundDeliverySnapshot) => void;
  readonly sessionId: string;
}) {
  const queryClient = useQueryClient();
  const [saved, setSaved] = useState(false);
  const [failure, setFailure] = useState<{
    readonly command: DraftSaveCommand;
    readonly message: string;
    readonly retryable: boolean;
  }>();
  const [sendFailure, setSendFailure] = useState<{
    readonly command: DraftSendCommand;
    readonly message: string;
    readonly retryable: boolean;
  }>();
  const [attachmentUploads, setAttachmentUploads] = useState<
    readonly PendingDraftAttachment[]
  >([]);
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
        ? updateMailboxDraft({
            data: Schema.encodeSync(UpdateMailboxDraftCommand)(command),
          })
        : createMailboxDraft({
            data: Schema.encodeSync(CreateMailboxDraftCommand)(command),
          }),
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
      void Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["mailbox", "navigation"],
        }),
        queryClient.invalidateQueries({ queryKey: ["mailbox", "drafts"] }),
      ]);
      if (!("draftId" in command)) {
        onCreated(result.draft.id);
        return;
      }
      queryClient.setQueryData(draftQueryKey, result);
    },
    retry: false,
  });
  const send = useMutation({
    mutationFn: (command: DraftSendCommand) =>
      sendMailboxDraft({ data: command }),
    onError: (_error, command) => {
      setSendFailure({
        command,
        message: "The send result could not be confirmed. Retry safely.",
        retryable: true,
      });
    },
    onSuccess: (result, command) => {
      if (!result.ok) {
        if (result.status === 401) {
          setSendFailure(undefined);
          void clearCachedAuthSession(queryClient);
          return;
        }
        setSendFailure({
          command,
          message: draftSendErrorText(result.status, result.error.message),
          retryable: result.status >= 500,
        });
        return;
      }
      setSendFailure(undefined);
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["mailbox", "drafts"] }),
        queryClient.invalidateQueries({ queryKey: ["mailbox", "messages"] }),
        queryClient.invalidateQueries({ queryKey: mailboxNavigationQueryKey }),
      ]);
      onSent(result.send);
    },
    retry: false,
  });
  const runAttachmentUpload = async (pending: PendingDraftAttachment) => {
    if (draftId === undefined) {
      return;
    }
    const { file, id, operationId } = pending;
    try {
      let { reservationId } = pending;
      if (reservationId === undefined) {
        const reservation = await reserveMailboxDraftAttachment({
          data: decodeReserveDraftAttachment({
            draftId,
            fileName: file.name,
            mailboxId,
            mimeType: file.type || "application/octet-stream",
            operationId,
            size: file.size,
          }),
        });
        if (!reservation.ok) {
          throw new Error(`reserve:${reservation.status}`);
        }
        reservationId = reservation.reservation.id;
        setAttachmentUploads((currentUploads) =>
          currentUploads.map((upload) =>
            upload.id === id
              ? {
                  ...upload,
                  progress: 0,
                  reservationId,
                  status: "uploading",
                }
              : upload
          )
        );
      } else {
        setAttachmentUploads((currentUploads) =>
          currentUploads.map((upload) =>
            upload.id === id
              ? {
                  ...upload,
                  error: undefined,
                  retryable: true,
                  status: "uploading",
                }
              : upload
          )
        );
      }
      await uploadReservedAttachment(
        {
          attachmentId: reservationId,
          draftId,
          file,
          mailboxId,
        },
        (progress) =>
          setAttachmentUploads((currentUploads) =>
            currentUploads.map((upload) =>
              upload.id === id ? { ...upload, progress } : upload
            )
          )
      );
      setAttachmentUploads((currentUploads) =>
        currentUploads.filter((upload) => upload.id !== id)
      );
      await draft.refetch();
      void Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["mailbox", "navigation"],
        }),
        queryClient.invalidateQueries({ queryKey: ["mailbox", "drafts"] }),
      ]);
    } catch (error) {
      const {
        message: uploadError,
        retryable: uploadRetryable,
        status: uploadStatus,
      } = attachmentUploadFailure(error);
      if (uploadStatus === 401) {
        void clearCachedAuthSession(queryClient);
      }
      setAttachmentUploads((currentUploads) =>
        currentUploads.map((upload) =>
          upload.id === id
            ? {
                ...upload,
                error: uploadError,
                retryable: uploadRetryable,
                status: "failed",
              }
            : upload
        )
      );
    }
  };
  const attachFiles = (files: readonly File[]) => {
    const pending = files.map(
      (file): PendingDraftAttachment => ({
        file,
        id: crypto.randomUUID(),
        operationId: crypto.randomUUID(),
        progress: 0,
        retryable: true,
        status: "reserving",
      })
    );
    const rejected = pending.filter(
      (upload) =>
        upload.file.size < 1 || upload.file.size > draftAttachmentMaxBytes
    );
    const accepted = pending.filter((upload) => !rejected.includes(upload));
    setAttachmentUploads([
      ...accepted,
      ...rejected.map((upload) => ({
        ...upload,
        error: "Files must be between 1 byte and 10 MB.",
        retryable: false,
        status: "failed" as const,
      })),
    ]);
    const uploadSequentially = async () => {
      for (const upload of accepted) {
        // Uploads stay sequential to bound Worker buffering and preserve quota ordering.
        // oxlint-disable-next-line eslint/no-await-in-loop
        await runAttachmentUpload(upload);
      }
    };
    void uploadSequentially();
  };

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
    setSendFailure(undefined);
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
  const submitSend = () => {
    if (current === undefined) {
      return;
    }
    setSendFailure(undefined);
    send.mutate(
      decodeSendMailboxDraft({
        draftId: current.id,
        expectedVersion: current.version,
        mailboxId,
        operationId: crypto.randomUUID(),
      })
    );
  };

  return (
    <DraftEditor
      key={current === undefined ? "new" : `${current.id}:${current.version}`}
      attachments={current?.attachments ?? []}
      attachmentUploads={attachmentUploads.map((upload) => ({
        error: upload.error,
        fileName: upload.file.name,
        id: upload.id,
        progress: upload.progress,
        retryable: upload.retryable,
        size: upload.file.size,
        status: upload.status,
      }))}
      error={sendFailure?.message ?? failure?.message}
      initial={current?.content ?? emptyDraftContent}
      isNew={current === undefined}
      isSaving={save.isPending}
      isSending={send.isPending}
      onAttachFiles={attachFiles}
      onClose={onClose}
      onRetry={
        sendFailure?.retryable === true
          ? () => send.mutate(sendFailure.command)
          : failure?.retryable === true
            ? () => save.mutate(failure.command)
            : undefined
      }
      onDismissAttachmentUpload={(id) =>
        setAttachmentUploads((uploads) =>
          uploads.filter((upload) => upload.id !== id)
        )
      }
      onRetryAttachmentUpload={(id) => {
        const upload = attachmentUploads.find((item) => item.id === id);
        if (upload !== undefined) {
          void runAttachmentUpload(upload);
        }
      }}
      onSave={submit}
      onSend={submitSend}
      saved={saved}
    />
  );
}

// oxlint-disable-next-line eslint/complexity -- The authenticated route selects navigation, workspace, and persistent delivery-tracker states.
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
  const navigate = useMailboxNavigate();
  const queryClient = useQueryClient();
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
    delivery: search.delivery,
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
  const outboundDeliveryId = search.delivery;
  const navigateToSelection = (nextSelection: MailboxViewSelection) =>
    void navigate({
      to: "/inbox",
      search: decodeInboxSearch({
        ...nextSelection,
        delivery: outboundDeliveryId,
      }),
    });
  const prefetchSelection = (nextSelection: MailboxViewSelection) => {
    const folder = folders.find((item) => item.id === nextSelection.folder);
    if (folder?.kind === "drafts") {
      void queryClient.prefetchInfiniteQuery(
        mailboxDraftListQueryOptions({
          mailboxId: mailbox.id,
          queryClient,
          sessionId,
        })
      );
      return;
    }

    const view = decodeMailboxMessageView(
      nextSelection.folder === undefined
        ? {
            _tag: "Label",
            labelId: nextSelection.label,
            mailboxId: mailbox.id,
          }
        : {
            _tag: "Folder",
            folderId: nextSelection.folder,
            mailboxId: mailbox.id,
          }
    );
    void queryClient.prefetchInfiniteQuery(
      mailboxMessageListQueryOptions({
        filters: {},
        mailboxId: mailbox.id,
        queryClient,
        sessionId,
        view,
      })
    );
  };
  const closeEditor = () =>
    void navigate({
      to: "/inbox",
      search: inboxSearchFor(selection, filters),
    });

  return (
    <>
      <MailboxShell
        folders={folders}
        labels={labels}
        mailboxAddress={mailbox.primaryAddress}
        mailboxName={mailbox.displayName}
        onNavigate={navigateToSelection}
        onPrefetch={prefetchSelection}
        outboundDeliveryId={outboundDeliveryId}
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
                    delivery: search.delivery,
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
                search: decodeInboxSearch({
                  ...selection,
                  delivery: search.delivery,
                  draft: draftId,
                }),
              })
            }
            onSent={(outbound) => {
              queryClient.setQueryData(
                outboundDeliveryQueryKey(
                  sessionId,
                  mailbox.id,
                  outbound.delivery.id
                ),
                outbound
              );
              void navigate({
                to: "/inbox",
                search: inboxSearchFor(selection, {
                  ...filters,
                  delivery: outbound.delivery.id,
                }),
              });
            }}
            sessionId={sessionId}
          />
        ) : selectedFolder?.kind === "drafts" ? (
          <DraftListWorkspace
            deliveryId={search.delivery}
            folderId={selectedFolder.id}
            mailboxId={mailbox.id}
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
      {outboundDeliveryId === undefined ? null : (
        <OutboundDeliveryTracker
          key={outboundDeliveryId}
          deliveryId={outboundDeliveryId}
          getStatus={() =>
            getMailboxOutboundDelivery({
              data: {
                mailboxId: mailbox.id,
                outboundDeliveryId,
              },
            })
          }
          mailboxId={mailbox.id}
          onDismiss={() =>
            void navigate({
              to: "/inbox",
              search: decodeInboxSearch({ ...search, delivery: undefined }),
            })
          }
          onMailboxChanged={() => {
            void queryClient.invalidateQueries({
              queryKey: ["mailbox", "messages"],
            });
            void queryClient.invalidateQueries({
              queryKey: mailboxNavigationQueryKey,
            });
          }}
          onUnauthorized={() => clearCachedAuthSession(queryClient)}
          sessionId={sessionId}
          undo={(command) => undoMailboxSend({ data: command })}
        />
      )}
    </>
  );
}

function InboxRoute() {
  return <MailboxApplication search={Route.useSearch()} />;
}

// The same authenticated mailbox stays mounted under /mail while child paths
// select a collection, draft, or compose workspace.
// oxlint-disable-next-line eslint/complexity -- The route exhaustively selects session, authorization, navigation, and mailbox states.
export function MailboxApplication({
  search,
}: {
  readonly search: Schema.Schema.Type<typeof InboxSearch>;
}) {
  const navigate = useMailboxNavigate();
  const queryClient = useQueryClient();
  const mailboxDenial = useQuery<{ readonly status: 403 }>({
    queryFn: skipToken,
    queryKey: mailboxReadDenialQueryKey,
  });
  const session = useQuery({
    queryKey: authSessionQueryKey,
    queryFn: ({ signal }) => currentSessionForQuery(signal),
    retry: 2,
    retryDelay: (attempt) => 250 * (attempt + 1),
    staleTime: 30_000,
  });
  const activeNavigationQueryKey = [
    ...mailboxNavigationQueryKey,
    session.data?.userId,
    session.data?.sessionId,
  ] as const;
  const navigation = useQuery({
    enabled:
      session.data !== null &&
      session.data !== undefined &&
      mailboxDenial.data?.status !== 403,
    queryFn: async () => {
      const previousNavigation = queryClient.getQueryData<{
        readonly ok: boolean;
      }>(activeNavigationQueryKey);
      const result = await getMailboxNavigation();
      await handleMailboxReadDenial(queryClient, result);
      if (
        !result.ok &&
        result.status !== 401 &&
        result.status !== 403 &&
        (result.status !== 404 || previousNavigation?.ok === true)
      ) {
        throw new MailboxRequestError(result.status);
      }
      return result;
    },
    queryKey: activeNavigationQueryKey,
    retry: 2,
    retryDelay: (attempt) => 250 * (attempt + 1),
    staleTime: 30_000,
  });
  const logout = useMutation({
    mutationFn: () => authClient.session.logout(),
    retry: false,
    onSuccess: async () => {
      await clearCachedAuthSession(queryClient);
      await navigate({ to: "/" });
    },
  });

  if (
    session.isLoading ||
    (session.isFetching && !session.data) ||
    (session.data &&
      (navigation.isLoading ||
        (navigation.isFetching && navigation.data?.ok !== true)))
  ) {
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

  if (navigation.data?.ok !== true) {
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
