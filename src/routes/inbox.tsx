import {
  skipToken,
  useInfiniteQuery,
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
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
import { useEffect, useEffectEvent, useRef, useState } from "react";

import {
  getMailboxNavigation,
  getMailboxOutboundDelivery,
  getMailboxDraft,
  getMailboxThread,
  actOnMailboxMessages,
  createMailboxDraft,
  createMailboxReplyDraft,
  reserveMailboxDraftAttachment,
  sendMailboxDraft,
  setMailboxThreadRead,
  undoMailboxSend,
  updateMailboxContactPreferences,
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
  clearDraftEditorFields,
  clearPendingDraftCreate,
  draftEditorFieldsEqual,
  persistDraftEditorFields,
  persistPendingDraftCreate,
  readDraftEditorFields,
  readPendingDraftCreate,
} from "#/modules/mailbox/adapters/browser/DraftSessionStorage";
import type { DraftEditorFields } from "#/modules/mailbox/adapters/browser/DraftSessionStorage";
import {
  clearPendingReplyCommand,
  persistPendingReplyCommand,
  readPendingReplyCommand,
  replyCommandsHaveSameTarget,
  retainReplyOperationForStatus,
} from "#/modules/mailbox/adapters/browser/ReplyDraftOperationStorage";
import {
  DraftEditor,
  draftEditorFieldsFromContent,
  draftSendErrorText,
} from "#/modules/mailbox/adapters/react/DraftEditor";
import type { DraftEditorSnapshot } from "#/modules/mailbox/adapters/react/DraftEditor";
import { DraftList } from "#/modules/mailbox/adapters/react/DraftList";
import {
  mailboxMessageActionMutationKey,
  mailboxThreadReadMutationKey,
  projectPendingMessageActions,
  projectPendingThreadActions,
  reconcileMailboxMessageActionCaches,
  reconcileMailboxThreadReadCaches,
} from "#/modules/mailbox/adapters/react/MailboxQueryState";
import { MailboxRealtime } from "#/modules/mailbox/adapters/react/MailboxRealtime";
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
import type {
  MessageListItemData,
  MessageRowAction,
} from "#/modules/mailbox/adapters/react/MessageList";
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
import {
  MailboxMessageBatchActionCommand,
  SetMailboxThreadReadCommand,
} from "#/modules/mailbox/application/MailboxMessageActions";
import type { MailboxMessageBatchActionItem } from "#/modules/mailbox/application/MailboxMessageActions";
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
  MailboxContactPreference,
  UpdateMailboxContactPreferenceCommand,
} from "#/modules/organization/application/UserMailboxContactPreferences";
import {
  mailboxContactPreferenceQueryOptions,
  mailboxContactSearchQueryOptions,
  mailboxDraftListQueryOptions,
  mailboxMessageListQueryOptions,
  MailboxRequestError,
} from "#/routes/-mailbox-queries";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

const InboxSearch = MailboxSearch;
const decodeInboxSearch = decodeMailboxSearch;
type MailboxNavigationData = Schema.Codec.Encoded<
  typeof MailboxNavigationResult
>;

type MailboxNavigateOptions =
  | {
      readonly replace?: boolean;
      readonly search: Schema.Schema.Type<typeof InboxSearch>;
      readonly to: "/inbox";
    }
  | { readonly replace?: boolean; readonly to: "/" }
  | { readonly replace?: boolean; readonly to: "/mail/settings" };

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
const decodeMailboxMessageBatchAction = Schema.decodeUnknownSync(
  MailboxMessageBatchActionCommand
);
const decodeSetMailboxThreadRead = Schema.decodeUnknownSync(
  SetMailboxThreadReadCommand
);
const decodeContactPreferenceUpdate = Schema.decodeUnknownSync(
  UpdateMailboxContactPreferenceCommand
);
const decodeContactPreference = Schema.decodeUnknownSync(
  MailboxContactPreference
);

const prefetchMailboxSelection = ({
  folders,
  mailboxId,
  queryClient,
  selection,
  sessionId,
}: {
  readonly folders: MailboxNavigationData["folders"];
  readonly mailboxId: string;
  readonly queryClient: QueryClient;
  readonly selection: MailboxViewSelection;
  readonly sessionId: string;
}) => {
  const folder = folders.find((item) => item.id === selection.folder);
  if (folder?.kind === "drafts") {
    return queryClient.prefetchInfiniteQuery(
      mailboxDraftListQueryOptions({ mailboxId, queryClient, sessionId })
    );
  }

  const view = decodeMailboxMessageView(
    selection.folder === undefined
      ? { _tag: "Label", labelId: selection.label, mailboxId }
      : { _tag: "Folder", folderId: selection.folder, mailboxId }
  );
  return queryClient.prefetchInfiniteQuery(
    mailboxMessageListQueryOptions({
      filters: {},
      mailboxId,
      queryClient,
      sessionId,
      view,
    })
  );
};
const decodeOpenMailboxThread = Schema.decodeUnknownSync(
  OpenMailboxThreadInput
);
const decodeMailboxMessageBatchActionOption = Schema.decodeUnknownOption(
  MailboxMessageBatchActionCommand
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

const messageBatchActionCommand = (
  action: MessageRowAction,
  mailboxId: string,
  messages: readonly MessageListItemData[]
) => {
  const actions = messages.map((message) => {
    const common = {
      expectedVersion: message.version,
      messageId: message.id,
      operationId: crypto.randomUUID(),
    };
    return action === "read"
      ? { ...common, _tag: "SetRead" as const, read: !message.read }
      : action === "star"
        ? { ...common, _tag: "SetStarred" as const, starred: !message.starred }
        : { ...common, _tag: action === "archive" ? "Archive" : "Trash" };
  });
  return decodeMailboxMessageBatchAction({
    actions,
    batchOperationId: crypto.randomUUID(),
    mailboxId,
  });
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
      <Alert
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
            <Button
              type="button"
              variant="ghost"
              onClick={onRetry}
              className="inline-flex h-auto items-center gap-2 rounded-xl bg-[var(--sea-ink)] px-5 py-3 text-sm font-bold text-[var(--bg-base)]"
            >
              <RotateCcw size={17} /> Try again
            </Button>
          ) : null}
          <Link
            to="/"
            className="inline-flex items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--control-bg)] px-5 py-3 text-sm font-bold text-[var(--sea-ink)] no-underline hover:bg-[var(--surface-strong)] hover:text-[var(--sea-ink)]"
          >
            <ArrowLeft size={17} /> Return home
          </Link>
        </div>
      </Alert>
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
          className="mt-7 inline-flex items-center gap-2 rounded-xl bg-[var(--sea-ink)] px-5 py-3 text-sm font-bold text-[var(--bg-base)] no-underline hover:text-[var(--bg-base)]"
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
    <Alert
      aria-live="polite"
      className="flex min-h-80 flex-1 items-center justify-center rounded-none border-0 bg-[var(--workspace-bg)] px-6 py-0 text-center text-[var(--sea-ink)]"
    >
      <div className="island-shell max-w-sm rounded-2xl px-7 py-6">
        <span className="mx-auto flex size-11 items-center justify-center rounded-xl bg-[var(--sand)] text-[var(--palm)]">
          <CircleAlert size={24} />
        </span>
        <p className="mt-4 text-sm font-extrabold">{title}</p>
        <p className="mt-1 text-xs leading-5 text-[var(--sea-ink-soft)]">
          {detail}
        </p>
        {onRetry ? (
          <Button
            type="button"
            variant="ghost"
            onClick={onRetry}
            className="mt-5 inline-flex h-auto items-center gap-2 rounded-xl bg-[var(--sea-ink)] px-4 py-2.5 text-xs font-extrabold text-[var(--bg-base)] hover:bg-[var(--palm)]"
          >
            <RotateCcw size={14} /> Try again
          </Button>
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
    </Alert>
  );
}

function ConversationPane({
  filters,
  mailboxId,
  messageId,
  onClose,
  onUnreadThreadOpened,
  pendingActions,
  pendingThreadIds,
  selection,
  sessionId,
  threadId,
}: {
  readonly filters: MailboxMessageQueryState;
  readonly mailboxId: string;
  readonly messageId?: string;
  readonly onClose: () => void;
  readonly onUnreadThreadOpened: (threadId: string) => void;
  readonly pendingActions: readonly Schema.Schema.Type<
    typeof MailboxMessageBatchActionItem
  >[];
  readonly pendingThreadIds: ReadonlySet<string>;
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
            if (!result.ok) {
              throw new MailboxRequestError(result.status);
            }
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
  const markOpenedThreadRead = useEffectEvent(onUnreadThreadOpened);
  const openedThread = thread.data?.thread.thread;
  useEffect(() => {
    if (
      !thread.isFetching &&
      openedThread !== undefined &&
      openedThread.id === threadId &&
      openedThread.unreadCount > 0
    ) {
      markOpenedThreadRead(openedThread.id);
    }
  }, [openedThread, thread.isFetching, threadId]);
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
  const threadErrorStatus =
    thread.error instanceof MailboxRequestError
      ? thread.error.status
      : undefined;
  if (
    thread.data === undefined ||
    (thread.error !== null && threadErrorStatus === 404)
  ) {
    const status = threadErrorStatus ?? 502;
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
      data={projectPendingThreadActions(
        thread.data.thread,
        pendingActions,
        pendingThreadIds
      )}
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

  if (!drafts.isLoading && drafts.data === undefined) {
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

  const pages = drafts.data?.pages ?? [];
  const lastPage = pages.at(-1);
  return (
    <DraftList
      data={{
        items: pages.flatMap((page) => page.items),
        nextCursor: lastPage?.nextCursor,
      }}
      deliveryId={deliveryId}
      folderId={folderId}
      isInitialLoading={drafts.isLoading}
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
  readActionsEnabled,
  selection,
  sessionId,
  trashFolderId,
  threadId,
}: {
  readonly archiveFolderId?: string;
  readonly filters: MailboxMessageQueryState;
  readonly mailboxId: string;
  readonly messageId?: string;
  readonly readActionsEnabled: boolean;
  readonly selection: MailboxViewSelection;
  readonly sessionId: string;
  readonly trashFolderId?: string;
  readonly threadId?: string;
}) {
  const navigate = useMailboxNavigate();
  const queryClient = useQueryClient();
  const pendingMessageLocks = useRef(new Set<string>());
  const pendingThreadLocks = useRef(new Set<string>());
  const [actionFailures, setActionFailures] = useState<
    readonly {
      readonly command?: Schema.Schema.Type<
        typeof MailboxMessageBatchActionCommand
      >;
      readonly id: string;
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
  const pendingBatches = useMutationState<
    Schema.Schema.Type<typeof MailboxMessageBatchActionCommand> | undefined
  >({
    filters: { mutationKey: actionMutationKey, status: "pending" },
    select: (mutation) =>
      Option.getOrUndefined(
        decodeMailboxMessageBatchActionOption(mutation.state.variables)
      ),
  }).filter(
    (
      command
    ): command is Schema.Schema.Type<typeof MailboxMessageBatchActionCommand> =>
      command !== undefined
  );
  const pendingActions = pendingBatches.flatMap((command) => command.actions);
  const pendingMessageIds = new Set(
    pendingActions.map((action) => action.messageId)
  );
  const threadReadMutationKey = [
    ...mailboxThreadReadMutationKey,
    sessionId,
    mailboxId,
  ] as const;
  const pendingThreadReads = useMutationState<
    Schema.Schema.Type<typeof SetMailboxThreadReadCommand> | undefined
  >({
    filters: { mutationKey: threadReadMutationKey, status: "pending" },
    select: (mutation) => {
      const decoded = Schema.decodeUnknownOption(SetMailboxThreadReadCommand)(
        mutation.state.variables
      );
      return Option.getOrUndefined(decoded);
    },
  }).filter(
    (
      command
    ): command is Schema.Schema.Type<typeof SetMailboxThreadReadCommand> =>
      command !== undefined
  );
  const pendingThreadIds = new Set(
    pendingThreadReads.map((command) => command.threadId)
  );
  const [threadReadFailure, setThreadReadFailure] = useState<{
    readonly command: Schema.Schema.Type<typeof SetMailboxThreadReadCommand>;
    readonly retryable: boolean;
    readonly text: string;
  }>();
  const clearActionFailures = (ids: ReadonlySet<string>) =>
    setActionFailures((current) =>
      current.filter((failure) => !ids.has(failure.id))
    );
  const recordActionFailure = (
    id: string,
    text: string,
    retryable: boolean,
    command?: Schema.Schema.Type<typeof MailboxMessageBatchActionCommand>
  ) =>
    setActionFailures((current) => [
      ...current.filter((failure) => failure.id !== id),
      { command, id, retryable, text },
    ]);
  const messageAction = useMutation({
    mutationKey: actionMutationKey,
    mutationFn: (
      command: Schema.Schema.Type<typeof MailboxMessageBatchActionCommand>
    ) => actOnMailboxMessages({ data: command }),
    onSuccess: (result, command) => {
      const commandIds = new Set([
        command.batchOperationId,
        ...command.actions.map((action) => action.messageId),
      ]);
      if (!result.ok && result.status === 401) {
        clearActionFailures(commandIds);
        void clearCachedAuthSession(queryClient);
        return;
      }
      if (result.ok) {
        clearActionFailures(commandIds);
        for (const item of result.batch.results) {
          if (item._tag === "Succeeded") {
            reconcileMailboxMessageActionCaches(
              queryClient,
              mailboxId,
              item.action
            );
          } else {
            recordActionFailure(
              item.messageId,
              item.reason === "conflict"
                ? "The message changed before the action was applied."
                : item.reason === "forbidden"
                  ? "You no longer have permission to change this message."
                  : item.reason === "not-found"
                    ? "The message could not be found."
                    : "The message action was invalid.",
              false
            );
          }
        }
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
        command.batchOperationId,
        messageActionErrorText(result) ??
          "The message action could not be completed.",
        result.status === 500 || result.status === 502,
        command
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
        command.batchOperationId,
        "The message action could not be completed.",
        true,
        command
      );
      void queryClient.invalidateQueries({ queryKey: ["mailbox", "messages"] });
    },
    onSettled: (_result, _error, command) => {
      for (const action of command.actions) {
        pendingMessageLocks.current.delete(action.messageId);
      }
    },
    retry: false,
  });
  const threadRead = useMutation({
    mutationKey: threadReadMutationKey,
    mutationFn: (
      command: Schema.Schema.Type<typeof SetMailboxThreadReadCommand>
    ) => setMailboxThreadRead({ data: command }),
    onMutate: () => setThreadReadFailure(undefined),
    onSuccess: async (result, command) => {
      if (!result.ok && result.status === 401) {
        await clearCachedAuthSession(queryClient);
        return;
      }
      if (result.ok) {
        for (const changed of result.result.changed) {
          reconcileMailboxMessageActionCaches(queryClient, mailboxId, changed);
        }
        reconcileMailboxThreadReadCaches(
          queryClient,
          mailboxId,
          result.result.threadId
        );
      } else {
        setThreadReadFailure({
          command,
          retryable: result.status === 500 || result.status === 502,
          text:
            messageActionErrorText(result) ??
            "The conversation could not be marked as read.",
        });
      }
      void queryClient.invalidateQueries({
        queryKey: mailboxNavigationQueryKey,
      });
    },
    onError: async (_error, command) => {
      setThreadReadFailure({
        command,
        retryable: true,
        text: "The conversation could not be marked as read.",
      });
      await queryClient.invalidateQueries({
        queryKey: ["mailbox", "messages"],
      });
    },
    onSettled: (_result, _error, command) => {
      pendingThreadLocks.current.delete(command.threadId);
    },
    retry: false,
  });
  const submitThreadRead = (
    nextThreadId: string,
    command = decodeSetMailboxThreadRead({
      mailboxId,
      operationId: crypto.randomUUID(),
      threadId: nextThreadId,
    })
  ) => {
    if (pendingThreadLocks.current.has(nextThreadId)) {
      return;
    }
    pendingThreadLocks.current.add(nextThreadId);
    threadRead.mutate(command);
  };
  const status =
    messages.error instanceof MailboxRequestError
      ? messages.error.status
      : undefined;
  const blockingError =
    (!messages.isLoading && messages.data === undefined) ||
    (messages.error !== null && status === 404);
  if (blockingError) {
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

  const pages = messages.data?.pages ?? [];
  const lastPage = pages.at(-1);
  const data = projectPendingMessageActions(
    {
      items: pages.flatMap((page) => page.items),
      nextCursor: lastPage?.nextCursor,
    },
    pendingActions,
    selection,
    filters,
    { archiveFolderId, trashFolderId },
    pendingThreadIds
  );
  const submitMessageActionBatch = (
    command: Schema.Schema.Type<typeof MailboxMessageBatchActionCommand>
  ) => {
    if (
      command.actions.some(
        (action) =>
          pendingMessageLocks.current.has(action.messageId) ||
          pendingMessageIds.has(action.messageId)
      )
    ) {
      return;
    }
    messageAction.reset();
    clearActionFailures(
      new Set([
        command.batchOperationId,
        ...command.actions.map((action) => action.messageId),
      ])
    );
    for (const action of command.actions) {
      pendingMessageLocks.current.add(action.messageId);
    }
    messageAction.mutate(command);
  };
  const executeMessageAction = (
    action: MessageRowAction,
    message: (typeof data.items)[number]
  ) =>
    submitMessageActionBatch(
      messageBatchActionCommand(action, mailboxId, [message])
    );
  const executeMessageBatchAction = (
    action: MessageRowAction,
    selectedMessages: readonly MessageListItemData[]
  ) => {
    for (let index = 0; index < selectedMessages.length; index += 100) {
      submitMessageActionBatch(
        messageBatchActionCommand(
          action,
          mailboxId,
          selectedMessages.slice(index, index + 100)
        )
      );
    }
  };

  return (
    <div className="grid h-full min-h-0 min-w-0 overflow-hidden lg:grid-cols-[minmax(20rem,38%)_minmax(0,1fr)] xl:grid-cols-[minmax(22rem,28rem)_minmax(0,1fr)]">
      <MessageList
        key={JSON.stringify([selection, filters])}
        actionErrors={[
          ...actionFailures.map((failure) => {
            const retryCommand = failure.command;
            return {
              handleRetry:
                failure.retryable && retryCommand !== undefined
                  ? () => submitMessageActionBatch(retryCommand)
                  : undefined,
              messageId: failure.id,
              text: failure.text,
            };
          }),
          ...(threadReadFailure === undefined ||
          threadReadFailure.command.threadId !== threadId
            ? []
            : [
                {
                  handleRetry: threadReadFailure.retryable
                    ? () =>
                        submitThreadRead(
                          threadReadFailure.command.threadId,
                          threadReadFailure.command
                        )
                    : undefined,
                  messageId: threadReadFailure.command.threadId,
                  text: threadReadFailure.text,
                },
              ]),
        ]}
        archiveFolderId={archiveFolderId}
        data={data}
        filters={filters}
        isInitialLoading={messages.isLoading}
        isLoadingMore={messages.isFetchingNextPage}
        isRefreshing={
          messages.data !== undefined &&
          messages.isFetching &&
          !messages.isFetchingNextPage
        }
        loadMoreFailed={messages.isFetchNextPageError}
        onLoadMore={() => void messages.fetchNextPage()}
        onMessageBatchAction={executeMessageBatchAction}
        onMessageAction={executeMessageAction}
        onOpenMessage={(nextThreadId, nextMessageId) => {
          void navigate({
            to: "/inbox",
            search: inboxSearchFor(selection, filters, {
              messageId: nextMessageId,
              threadId: nextThreadId,
            }),
          });
        }}
        onQueryChange={(state) =>
          void navigate({
            to: "/inbox",
            search: inboxSearchFor(selection, state),
          })
        }
        pendingMessageIds={pendingMessageIds}
        pendingThreadIds={pendingThreadIds}
        readActionsEnabled={readActionsEnabled}
        selectedThreadId={threadId}
        selection={selection}
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
        onUnreadThreadOpened={submitThreadRead}
        pendingActions={pendingActions}
        pendingThreadIds={pendingThreadIds}
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
interface DraftSaveFailure {
  readonly command: DraftSaveCommand;
  readonly message: string;
  readonly retryable: boolean;
  readonly snapshot: DraftEditorSnapshot;
}

interface PendingDraftAttachment {
  readonly file: File;
  readonly id: string;
  readonly operationId: string;
  readonly progress: number;
  readonly retryable: boolean;
  readonly reservationId?: string;
  readonly status: "reserving" | "uploading" | "failed";
  readonly error?: string;
  readonly snapshot: DraftEditorSnapshot;
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
  if (error instanceof Error && error.message === "upload:draft-conflict") {
    return {
      message:
        "This draft changed elsewhere while the file uploaded. Reopen it before editing further.",
      retryable: false,
      status: 409,
    };
  }
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
  const composeSession = draftId ?? "compose";
  const [recoveredCreate] = useState(() =>
    typeof window === "undefined" || draftId !== undefined
      ? undefined
      : readPendingDraftCreate(window.sessionStorage, mailboxId)
  );
  const [recoveredFields] = useState(() =>
    typeof window === "undefined"
      ? undefined
      : (readDraftEditorFields(
          window.sessionStorage,
          mailboxId,
          composeSession
        ) ??
        (recoveredCreate === undefined
          ? undefined
          : draftEditorFieldsFromContent(recoveredCreate.content)))
  );
  const pendingCreate = useRef(recoveredCreate ?? null);
  const [saveStatus, setSaveStatus] = useState<
    "error" | "idle" | "saved" | "saving" | "unsaved"
  >(
    recoveredFields === undefined
      ? draftId === undefined
        ? "idle"
        : "saved"
      : "unsaved"
  );
  const [failure, setFailure] = useState<DraftSaveFailure>();
  const [sendFailure, setSendFailure] = useState<{
    readonly command: DraftSendCommand;
    readonly message: string;
    readonly retryable: boolean;
  }>();
  const [attachmentUploads, setAttachmentUploads] = useState<
    readonly PendingDraftAttachment[]
  >([]);
  const [isSending, setIsSending] = useState(false);
  const [displayDraft, setDisplayDraft] =
    useState<Schema.Schema.Type<typeof DraftEditorDraft>>();
  const serverDraft = useRef<Schema.Schema.Type<
    typeof DraftEditorDraft
  > | null>(null);
  const latestFields = useRef<DraftEditorFields | null>(null);
  const pendingSave = useRef<DraftEditorSnapshot | null>(null);
  const saveInFlight = useRef<Promise<boolean> | null>(null);
  const failureRef = useRef<DraftSaveFailure | null>(null);
  const sendIntent = useRef(false);
  const dirty = useRef(recoveredFields !== undefined);
  const sessionWriteTimer = useRef<number | null>(null);
  const composeSessionRef = useRef(composeSession);
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
  const storeDraftResult = (
    result: { readonly ok: true; readonly draft: unknown },
    id: string
  ) =>
    queryClient.setQueryData(
      ["mailbox", "draft", sessionId, mailboxId, id],
      result
    );
  const clearRecoveredFields = () => {
    if (typeof window !== "undefined") {
      if (sessionWriteTimer.current !== null) {
        window.clearTimeout(sessionWriteTimer.current);
        sessionWriteTimer.current = null;
      }
      clearDraftEditorFields(
        window.sessionStorage,
        mailboxId,
        composeSessionRef.current
      );
    }
  };
  const scheduleRecoveredFields = (fields: DraftEditorFields) => {
    if (typeof window === "undefined") {
      return;
    }
    if (sessionWriteTimer.current !== null) {
      window.clearTimeout(sessionWriteTimer.current);
    }
    sessionWriteTimer.current = window.setTimeout(() => {
      persistDraftEditorFields(
        window.sessionStorage,
        mailboxId,
        composeSessionRef.current,
        fields
      );
      sessionWriteTimer.current = null;
    }, 150);
  };
  useEffect(
    () => () => {
      if (typeof window === "undefined") {
        return;
      }
      if (sessionWriteTimer.current !== null) {
        window.clearTimeout(sessionWriteTimer.current);
      }
      if (dirty.current && latestFields.current !== null) {
        persistDraftEditorFields(
          window.sessionStorage,
          mailboxId,
          composeSessionRef.current,
          latestFields.current
        );
      }
    },
    [mailboxId]
  );
  const recordFailure = (
    command: DraftSaveCommand,
    snapshot: DraftEditorSnapshot,
    message: string,
    retryable: boolean
  ) => {
    const next = { command, message, retryable, snapshot };
    failureRef.current = next;
    setFailure(next);
    setSaveStatus("error");
    return false;
  };
  // oxlint-disable-next-line eslint/complexity -- Save distinguishes exact retry, definitive failure, and create-session migration.
  const performSave = async (
    snapshot: DraftEditorSnapshot,
    retryCommand?: DraftSaveCommand
  ) => {
    const persisted = serverDraft.current;
    const common = {
      content: snapshot.content,
      mailboxId,
      operationId: crypto.randomUUID(),
    };
    const command =
      retryCommand ??
      (persisted === null
        ? decodeCreateMailboxDraft(common)
        : decodeUpdateMailboxDraft({
            ...common,
            draftId: persisted.id,
            expectedVersion: persisted.version,
          }));
    if (!("draftId" in command) && typeof window !== "undefined") {
      pendingCreate.current = command;
      persistPendingDraftCreate(window.sessionStorage, command);
    }
    setSaveStatus("saving");
    let result;
    try {
      result =
        "draftId" in command
          ? await updateMailboxDraft({
              data: Schema.encodeSync(UpdateMailboxDraftCommand)(command),
            })
          : await createMailboxDraft({
              data: Schema.encodeSync(CreateMailboxDraftCommand)(command),
            });
    } catch {
      return recordFailure(
        command,
        snapshot,
        "The draft could not be saved. Your local content is still here.",
        true
      );
    }
    if (!result.ok) {
      if (result.status === 401) {
        void clearCachedAuthSession(queryClient);
      }
      if (
        !("draftId" in command) &&
        result.status !== 500 &&
        result.status !== 502 &&
        typeof window !== "undefined"
      ) {
        pendingCreate.current = null;
        clearPendingDraftCreate(window.sessionStorage, mailboxId);
      }
      return recordFailure(
        command,
        snapshot,
        draftSaveErrorText(result.status),
        result.status === 500 || result.status === 502
      );
    }
    const savedDraft = decodeDraftEditorDraft(result.draft);
    serverDraft.current = savedDraft;
    setDisplayDraft(savedDraft);
    failureRef.current = null;
    setFailure(undefined);
    storeDraftResult(result, savedDraft.id);
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: ["mailbox", "navigation"] }),
      queryClient.invalidateQueries({ queryKey: ["mailbox", "drafts"] }),
    ]);
    if (
      latestFields.current !== null &&
      draftEditorFieldsEqual(latestFields.current, snapshot.fields)
    ) {
      dirty.current = false;
      clearRecoveredFields();
      setSaveStatus("saved");
    } else {
      dirty.current = true;
      setSaveStatus("unsaved");
    }
    if (!("draftId" in command)) {
      pendingCreate.current = null;
      if (typeof window !== "undefined") {
        clearPendingDraftCreate(window.sessionStorage, mailboxId);
        if (
          latestFields.current !== null &&
          !draftEditorFieldsEqual(latestFields.current, snapshot.fields)
        ) {
          if (sessionWriteTimer.current !== null) {
            window.clearTimeout(sessionWriteTimer.current);
            sessionWriteTimer.current = null;
          }
          clearDraftEditorFields(window.sessionStorage, mailboxId, "compose");
          persistDraftEditorFields(
            window.sessionStorage,
            mailboxId,
            savedDraft.id,
            latestFields.current
          );
        }
      }
      composeSessionRef.current = savedDraft.id;
      onCreated(savedDraft.id);
    }
    return true;
  };
  const drainSaves = () => {
    if (saveInFlight.current !== null) {
      return saveInFlight.current;
    }
    const run = async () => {
      while (pendingSave.current !== null && failureRef.current === null) {
        const uncertainCreate = pendingCreate.current;
        if (serverDraft.current === null && uncertainCreate !== null) {
          const recoveredSnapshot = {
            content: uncertainCreate.content,
            fields: draftEditorFieldsFromContent(uncertainCreate.content),
          };
          // Resolve an uncertain create before updating to newer coalesced fields.
          // oxlint-disable-next-line no-await-in-loop
          if (!(await performSave(recoveredSnapshot, uncertainCreate))) {
            return false;
          }
          continue;
        }
        const snapshot = pendingSave.current;
        pendingSave.current = null;
        // Saves are intentionally serialized so every CAS uses the version returned above.
        // oxlint-disable-next-line no-await-in-loop
        if (!(await performSave(snapshot))) {
          return false;
        }
      }
      return failureRef.current === null;
    };
    const operation = (async () => {
      try {
        return await run();
      } finally {
        saveInFlight.current = null;
      }
    })();
    saveInFlight.current = operation;
    return operation;
  };
  const queueSave = (snapshot: DraftEditorSnapshot) => {
    latestFields.current = snapshot.fields;
    const persistedFields =
      serverDraft.current === null
        ? draftEditorFieldsFromContent(emptyDraftContent)
        : draftEditorFieldsFromContent(serverDraft.current.content);
    if (
      saveInFlight.current === null &&
      draftEditorFieldsEqual(snapshot.fields, persistedFields)
    ) {
      pendingSave.current = null;
      dirty.current = false;
      clearRecoveredFields();
      setSaveStatus(serverDraft.current === null ? "idle" : "saved");
      return;
    }
    pendingSave.current = snapshot;
    if (failureRef.current === null) {
      void drainSaves();
    }
  };
  const retrySave = async () => {
    const failed = failureRef.current;
    if (failed === null || !failed.retryable) {
      return false;
    }
    failureRef.current = null;
    setFailure(undefined);
    const operation = performSave(failed.snapshot, failed.command);
    saveInFlight.current = operation;
    let retried: boolean;
    try {
      retried = await operation;
    } finally {
      saveInFlight.current = null;
    }
    return retried ? drainSaves() : false;
  };
  const flushSave = async (snapshot: DraftEditorSnapshot) => {
    latestFields.current = snapshot.fields;
    const persisted = serverDraft.current;
    if (
      persisted !== null &&
      saveInFlight.current === null &&
      pendingSave.current === null &&
      failureRef.current === null &&
      draftEditorFieldsEqual(
        snapshot.fields,
        draftEditorFieldsFromContent(persisted.content)
      )
    ) {
      dirty.current = false;
      clearRecoveredFields();
      setSaveStatus("saved");
      return persisted;
    }
    pendingSave.current = snapshot;
    if (failureRef.current?.retryable === true && !(await retrySave())) {
      return null;
    }
    if (failureRef.current !== null || !(await drainSaves())) {
      return null;
    }
    return serverDraft.current;
  };
  const performSend = async (command: DraftSendCommand) => {
    setIsSending(true);
    let result;
    try {
      result = await sendMailboxDraft({ data: command });
    } catch {
      setSendFailure({
        command,
        message: "The send result could not be confirmed. Retry safely.",
        retryable: true,
      });
      setIsSending(false);
      sendIntent.current = false;
      return;
    }
    if (!result.ok) {
      if (result.status === 401) {
        void clearCachedAuthSession(queryClient);
      }
      setSendFailure({
        command,
        message: draftSendErrorText(result.status, result.error.message),
        retryable: result.status >= 500,
      });
      setIsSending(false);
      sendIntent.current = false;
      return;
    }
    dirty.current = false;
    clearRecoveredFields();
    setSendFailure(undefined);
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: ["mailbox", "drafts"] }),
      queryClient.invalidateQueries({ queryKey: ["mailbox", "messages"] }),
      queryClient.invalidateQueries({ queryKey: mailboxNavigationQueryKey }),
    ]);
    onSent(result.send);
  };
  const submitSend = async (snapshot: DraftEditorSnapshot) => {
    if (sendIntent.current) {
      return;
    }
    sendIntent.current = true;
    setSendFailure(undefined);
    setIsSending(true);
    const persisted = await flushSave(snapshot);
    if (persisted === null) {
      setIsSending(false);
      sendIntent.current = false;
      return;
    }
    await performSend(
      decodeSendMailboxDraft({
        draftId: persisted.id,
        expectedVersion: persisted.version,
        mailboxId,
        operationId: crypto.randomUUID(),
      })
    );
  };
  const runAttachmentUpload = async (pending: PendingDraftAttachment) => {
    const persisted = serverDraft.current;
    if (persisted === null) {
      return;
    }
    const persistedDraftId = persisted.id;
    const { file, id, operationId } = pending;
    try {
      let { reservationId } = pending;
      if (reservationId === undefined) {
        const reservation = await reserveMailboxDraftAttachment({
          data: decodeReserveDraftAttachment({
            draftId: persistedDraftId,
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
          draftId: persistedDraftId,
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
      const refreshed = await getMailboxDraft({
        data: { draftId: persistedDraftId, mailboxId },
      });
      if (!refreshed.ok) {
        throw new Error(`upload:${refreshed.status}`);
      }
      const afterUpload = decodeDraftEditorDraft(refreshed.draft);
      if (
        latestFields.current !== null &&
        !draftEditorFieldsEqual(
          latestFields.current,
          draftEditorFieldsFromContent(afterUpload.content)
        )
      ) {
        throw new Error("upload:draft-conflict");
      }
      serverDraft.current = afterUpload;
      setDisplayDraft(afterUpload);
      storeDraftResult(refreshed, persistedDraftId);
      setAttachmentUploads((currentUploads) =>
        currentUploads.filter((upload) => upload.id !== id)
      );
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
  const attachFiles = async (
    files: readonly File[],
    snapshot: DraftEditorSnapshot
  ) => {
    const pending = files.map(
      (file): PendingDraftAttachment => ({
        file,
        id: crypto.randomUUID(),
        operationId: crypto.randomUUID(),
        progress: 0,
        retryable: true,
        snapshot,
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
    if ((await flushSave(snapshot)) === null) {
      setAttachmentUploads((uploads) =>
        uploads.map((upload) =>
          accepted.includes(upload)
            ? {
                ...upload,
                error:
                  "Save the draft successfully before retrying this upload.",
                retryable: true,
                status: "failed",
              }
            : upload
        )
      );
      return;
    }
    const uploadSequentially = async () => {
      for (const upload of accepted) {
        // Uploads stay sequential to bound Worker buffering and preserve quota ordering.
        // oxlint-disable-next-line eslint/no-await-in-loop
        await runAttachmentUpload(upload);
      }
    };
    await uploadSequentially();
  };
  const current = draft.data?.ok
    ? decodeDraftEditorDraft(draft.data.draft)
    : undefined;
  useEffect(() => {
    if (
      current !== undefined &&
      (serverDraft.current === null ||
        current.version > serverDraft.current.version)
    ) {
      serverDraft.current = current;
      setDisplayDraft(current);
      latestFields.current ??=
        recoveredFields ?? draftEditorFieldsFromContent(current.content);
    }
  }, [current, recoveredFields]);

  if (draftId !== undefined && draft.isLoading && displayDraft === undefined) {
    return (
      <output className="flex h-full min-h-80 items-center justify-center text-[var(--sea-ink-soft)]">
        <LoaderCircle aria-label="Loading draft" className="animate-spin" />
      </output>
    );
  }
  if (
    draftId !== undefined &&
    displayDraft === undefined &&
    (draft.error || !draft.data?.ok)
  ) {
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

  const initialContent =
    displayDraft?.content ?? current?.content ?? emptyDraftContent;
  const close = async (snapshot: DraftEditorSnapshot) => {
    if (!dirty.current) {
      onClose();
      return;
    }
    if ((await flushSave(snapshot)) !== null) {
      onClose();
    }
  };

  return (
    <DraftEditor
      attachments={displayDraft?.attachments ?? current?.attachments ?? []}
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
      initial={initialContent}
      initialFields={recoveredFields}
      isNew={displayDraft === undefined && current === undefined}
      isSendUncertain={sendFailure?.retryable === true}
      isSaving={saveStatus === "saving"}
      isSending={isSending}
      loadRecipientSuggestions={(query) =>
        queryClient.fetchQuery(
          mailboxContactSearchQueryOptions({
            mailboxId,
            query,
            queryClient,
            sessionId,
          })
        )
      }
      onAttachFiles={attachFiles}
      onAutosave={queueSave}
      onChange={(fields) => {
        latestFields.current = fields;
        const persistedFields =
          serverDraft.current === null
            ? draftEditorFieldsFromContent(emptyDraftContent)
            : draftEditorFieldsFromContent(serverDraft.current.content);
        dirty.current =
          saveInFlight.current !== null ||
          !draftEditorFieldsEqual(fields, persistedFields);
        if (dirty.current) {
          setSaveStatus("unsaved");
          scheduleRecoveredFields(fields);
        } else {
          clearRecoveredFields();
          setSaveStatus(serverDraft.current === null ? "idle" : "saved");
        }
      }}
      onClose={(snapshot) => void close(snapshot)}
      onRetry={
        sendFailure?.retryable === true
          ? () => {
              if (!sendIntent.current) {
                sendIntent.current = true;
                void performSend(sendFailure.command);
              }
            }
          : failure?.retryable === true
            ? () => void retrySave()
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
          void (async () => {
            const persisted = await flushSave(upload.snapshot);
            if (persisted !== null) {
              await runAttachmentUpload(upload);
            }
          })();
        }
      }}
      onSend={(snapshot) => void submitSend(snapshot)}
      saveStatus={saveStatus}
    />
  );
}

function MailboxSettingsWorkspace({
  mailboxId,
  sessionId,
}: {
  readonly mailboxId: string;
  readonly sessionId: string;
}) {
  const queryClient = useQueryClient();
  const preferenceOptions = mailboxContactPreferenceQueryOptions({
    mailboxId,
    queryClient,
    sessionId,
  });
  const preference = useQuery(preferenceOptions);
  const update = useMutation({
    mutationFn: async (visibility: "all-participants" | "safe") => {
      if (preference.data === undefined) {
        throw new Error("Contact preferences are not loaded");
      }
      const result = await updateMailboxContactPreferences({
        data: decodeContactPreferenceUpdate({
          expectedVersion: preference.data.version,
          mailboxId,
          visibility,
        }),
      });
      await handleMailboxReadDenial(queryClient, result);
      if (!result.ok) {
        throw new MailboxRequestError(result.status);
      }
      return decodeContactPreference(result.preference);
    },
    onSuccess: async (saved) => {
      queryClient.setQueryData(preferenceOptions.queryKey, saved);
      await queryClient.invalidateQueries({
        queryKey: ["mailbox", "contacts", sessionId, mailboxId],
      });
    },
    retry: false,
  });

  if (preference.isLoading) {
    return (
      <output className="flex h-full items-center justify-center text-[var(--sea-ink-soft)]">
        <LoaderCircle
          aria-label="Loading mailbox settings"
          className="animate-spin"
        />
      </output>
    );
  }
  if (preference.error || preference.data === undefined) {
    return (
      <div className="mx-auto flex h-full max-w-3xl items-center px-5 sm:px-8">
        <Alert className="w-full rounded-2xl border border-red-200 bg-red-50 p-5 text-red-900">
          <p className="font-extrabold">Could not load mailbox settings.</p>
          <Button
            type="button"
            variant="outline"
            onClick={() => void preference.refetch()}
            className="mt-4 rounded-xl"
          >
            Try again
          </Button>
        </Alert>
      </div>
    );
  }

  const includeParticipants = preference.data.visibility === "all-participants";
  return (
    <div className="h-full overflow-y-auto bg-[var(--workspace-bg)] px-4 py-6 sm:px-8 sm:py-9 lg:px-12">
      <div className="mx-auto max-w-3xl">
        <div className="mb-7 max-w-2xl">
          <p className="island-kicker">Mailbox preferences</p>
          <h2 className="display-title mt-2 text-2xl font-bold sm:text-3xl">
            Choose who appears while you write
          </h2>
          <p className="mt-3 text-sm leading-6 text-[var(--sea-ink-soft)]">
            Suggestions are private to your account and this mailbox.
          </p>
        </div>

        <section
          aria-labelledby="recipient-suggestions-heading"
          className="overflow-hidden rounded-3xl border border-[var(--line)] bg-[var(--surface-strong)] shadow-[0_20px_60px_rgba(23,58,64,0.09)]"
        >
          <div className="border-b border-[var(--line)] px-5 py-5 sm:px-7">
            <p className="text-[0.64rem] font-extrabold tracking-[0.16em] text-[var(--palm)] uppercase">
              Contacts
            </p>
            <h3
              id="recipient-suggestions-heading"
              className="display-title mt-1.5 text-xl font-bold"
            >
              Recipient suggestions
            </h3>
          </div>
          <div className="flex items-start justify-between gap-5 px-5 py-6 sm:px-7 sm:py-7">
            <div className="max-w-xl">
              <p className="text-sm font-extrabold">
                Include other conversation participants
              </p>
              <p className="mt-2 text-sm leading-6 text-[var(--sea-ink-soft)]">
                Suggest people found in To and Cc on incoming messages. Only
                participants seen after you enable this option are included.
              </p>
              <p className="mt-3 text-xs font-bold text-[var(--sea-ink-soft)]">
                People you have emailed, senders and Reply-To addresses are
                always suggested.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={includeParticipants}
              aria-label="Include other conversation participants"
              disabled={update.isPending}
              onClick={() =>
                update.mutate(includeParticipants ? "safe" : "all-participants")
              }
              className={`relative mt-0.5 h-7 w-12 shrink-0 rounded-full border transition-colors disabled:cursor-wait disabled:opacity-55 ${
                includeParticipants
                  ? "border-[var(--palm)] bg-[var(--palm)]"
                  : "border-[var(--line)] bg-[var(--control-bg)]"
              }`}
            >
              <span
                aria-hidden="true"
                className={`absolute top-0.5 size-5 rounded-full bg-white shadow-sm transition-transform ${
                  includeParticipants ? "translate-x-5" : "translate-x-0.5"
                }`}
              />
            </button>
          </div>
          {update.error === null ? null : (
            <Alert className="mx-5 mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 sm:mx-7">
              Settings changed elsewhere or could not be saved. Reload and try
              again.
            </Alert>
          )}
          {update.isSuccess ? (
            <output className="border-t border-[var(--line)] px-5 py-3 text-xs font-bold text-[var(--palm)] sm:px-7">
              Preference saved
            </output>
          ) : null}
        </section>
      </div>
    </div>
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
  settingsMode,
  userId,
}: {
  readonly data: Schema.Codec.Encoded<typeof MailboxNavigationResult>;
  readonly isSigningOut: boolean;
  readonly onSignOut: () => void;
  readonly signOutError?: string;
  readonly search: Schema.Schema.Type<typeof InboxSearch>;
  readonly sessionId: string;
  readonly settingsMode: boolean;
  readonly userId: string;
}) {
  const navigate = useMailboxNavigate();
  const queryClient = useQueryClient();
  const [createdComposeDraftId, setCreatedComposeDraftId] = useState<string>();
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
  const sentView = selectedFolder?.kind === "sent";
  const clearSentReadFilter = useEffectEvent(() => {
    void navigate({
      replace: true,
      search: decodeInboxSearch({ ...search, read: undefined }),
      to: "/inbox",
    });
  });
  useEffect(() => {
    if (sentView && search.read !== undefined) {
      clearSentReadFilter();
    }
  }, [search.read, sentView]);
  useEffect(() => {
    for (const folder of folders) {
      if (folder.kind !== "custom") {
        void prefetchMailboxSelection({
          folders,
          mailboxId: mailbox.id,
          queryClient,
          selection: { folder: folder.id },
          sessionId,
        });
      }
    }
  }, [folders, mailbox.id, queryClient, sessionId]);

  if (selection === undefined) {
    return <MailboxUnavailable status={404} />;
  }
  const filters: MailboxMessageQueryState = {
    delivery: search.delivery,
    hasAttachment: search.attachment === "true" || undefined,
    query: search.q,
    read: sentView ? undefined : search.read,
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
  const prefetchSelection = (nextSelection: MailboxViewSelection) =>
    void prefetchMailboxSelection({
      folders,
      mailboxId: mailbox.id,
      queryClient,
      selection: nextSelection,
      sessionId,
    });
  const closeEditor = () =>
    void navigate({
      to: "/inbox",
      search: inboxSearchFor(selection, filters),
    });

  return (
    <>
      <MailboxRealtime
        mailboxId={mailbox.id}
        sessionId={sessionId}
        userId={userId}
      />
      <MailboxShell
        folders={folders}
        labels={labels}
        mailboxAddress={mailbox.primaryAddress}
        mailboxName={mailbox.displayName}
        onNavigate={navigateToSelection}
        onPrefetch={prefetchSelection}
        onSettingsNavigate={() => void navigate({ to: "/mail/settings" })}
        outboundDeliveryId={outboundDeliveryId}
        headerAction={
          settingsMode || draftEditorOpen ? undefined : (
            <Button
              type="button"
              aria-label="Compose new draft"
              variant="ghost"
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
              className="inline-flex h-auto items-center gap-2 rounded-xl bg-[var(--sea-ink)] px-2 py-2.5 text-xs font-extrabold text-[var(--bg-base)] shadow-[0_9px_22px_rgba(23,58,64,0.16)] min-[360px]:px-3 sm:px-4"
            >
              <PenLine size={15} />{" "}
              <span className="hidden sm:inline">Compose</span>
            </Button>
          )
        }
        principalLabel={userId}
        selectedFolderId={settingsMode ? undefined : selectedFolder?.id}
        selectedLabelId={settingsMode ? undefined : selectedLabel?.id}
        settingsSelected={settingsMode}
        viewTitle={
          settingsMode
            ? "Settings"
            : search.compose === "true"
              ? "Compose"
              : search.draft === undefined
                ? (selectedLabel?.name ?? selectedFolder?.name ?? "Inbox")
                : "Edit draft"
        }
        isSigningOut={isSigningOut}
        onSignOut={onSignOut}
        signOutError={signOutError}
      >
        {settingsMode ? (
          <MailboxSettingsWorkspace
            mailboxId={mailbox.id}
            sessionId={sessionId}
          />
        ) : draftEditorOpen ? (
          <DraftWorkspace
            key={`${mailbox.id}:${
              search.draft !== undefined &&
              search.draft === createdComposeDraftId
                ? "compose"
                : (search.draft ?? "compose")
            }`}
            draftId={search.draft}
            filters={filters}
            mailboxId={mailbox.id}
            onClose={closeEditor}
            onCreated={(draftId) => {
              setCreatedComposeDraftId(draftId);
              void navigate({
                to: "/inbox",
                search: decodeInboxSearch({
                  ...selection,
                  delivery: search.delivery,
                  draft: draftId,
                }),
              });
            }}
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
            readActionsEnabled={!sentView}
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
  return <MailboxApplication search={Route.useSearch()} settingsMode={false} />;
}

// The same authenticated mailbox stays mounted under /mail while child paths
// select a collection, draft, or compose workspace.
// oxlint-disable-next-line eslint/complexity -- The route exhaustively selects session, authorization, navigation, and mailbox states.
export function MailboxApplication({
  search,
  settingsMode = false,
}: {
  readonly search: Schema.Schema.Type<typeof InboxSearch>;
  readonly settingsMode?: boolean;
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
      settingsMode={settingsMode}
      userId={session.data.userId}
    />
  );
}
