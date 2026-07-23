import type * as Schema from "effect/Schema";
import {
  Archive,
  ArrowDownLeft,
  ArrowUpRight,
  Inbox,
  LoaderCircle,
  Mail,
  MailOpen,
  Paperclip,
  Search,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { useState } from "react";

import type { MailboxMessageListResult } from "#/modules/mailbox/application/MailboxMessageReading";
import { hasSearchableMessageTerm } from "#/modules/mailbox/domain/Mailbox";

import type {
  MailboxMessageQueryState,
  MailboxViewSelection,
} from "./MailboxViewLinks";
import { mailboxViewHref } from "./MailboxViewLinks";

type MessageListData = Schema.Codec.Encoded<typeof MailboxMessageListResult>;
export type MessageListItemData = MessageListData["items"][number];
export type MessageRowAction = "archive" | "read" | "star" | "trash";
const noPendingMessageIds: ReadonlySet<string> = new Set();

const messageDate = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

const addressName = (address: {
  readonly address: string;
  readonly displayName?: string;
}) => address.displayName ?? address.address;

const hasActiveMailboxFilters = (filters: MailboxMessageQueryState) =>
  filters.query !== undefined ||
  filters.read !== undefined ||
  filters.starred === true ||
  filters.hasAttachment === true;

function MessageSearchControls({
  filters,
  onQueryChange,
}: {
  readonly filters: MailboxMessageQueryState;
  readonly onQueryChange: (state: MailboxMessageQueryState) => void;
}) {
  const [query, setQuery] = useState(filters.query ?? "");
  const [read, setRead] = useState<"" | "read" | "unread">(filters.read ?? "");
  const [starred, setStarred] = useState(filters.starred ?? false);
  const [hasAttachment, setHasAttachment] = useState(
    filters.hasAttachment ?? false
  );
  const [searchError, setSearchError] = useState(false);

  return (
    <form
      className="mt-3 space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        const trimmedQuery = query.trim();
        if (trimmedQuery === "" || hasSearchableMessageTerm(trimmedQuery)) {
          setSearchError(false);
          onQueryChange({
            delivery: filters.delivery,
            hasAttachment: hasAttachment || undefined,
            query: trimmedQuery === "" ? undefined : trimmedQuery,
            read: read === "" ? undefined : read,
            starred: starred || undefined,
          });
        } else {
          setSearchError(true);
        }
      }}
    >
      <label className="flex items-center gap-2 rounded-xl border border-[var(--line)] bg-white/72 px-3 py-2 text-[var(--sea-ink-soft)] focus-within:border-[var(--lagoon-deep)] focus-within:bg-white">
        <Search size={15} />
        <span className="sr-only">Search messages</span>
        <input
          type="search"
          maxLength={500}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setSearchError(false);
          }}
          aria-invalid={searchError}
          aria-describedby={searchError ? "message-search-error" : undefined}
          placeholder="Search this view"
          className="min-w-0 flex-1 border-0 bg-transparent text-sm text-[var(--sea-ink)] outline-none placeholder:text-[var(--sea-ink-soft)]/55"
        />
      </label>
      {searchError ? (
        <p
          id="message-search-error"
          role="alert"
          className="px-1 text-[0.68rem] font-bold text-red-700"
        >
          Enter at least one letter or number.
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Read status"
          value={read}
          onChange={(event) => {
            const { value } = event.currentTarget;
            setRead(value === "read" || value === "unread" ? value : "");
          }}
          className="h-8 rounded-lg border border-[var(--line)] bg-white/72 px-2 text-[0.7rem] font-bold text-[var(--sea-ink)]"
        >
          <option value="">Any status</option>
          <option value="unread">Unread</option>
          <option value="read">Read</option>
        </select>
        <button
          type="button"
          aria-pressed={starred}
          onClick={() => setStarred((current) => !current)}
          className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[0.7rem] font-bold ${
            starred
              ? "border-[var(--lagoon)] bg-[var(--sand)] text-[var(--palm)]"
              : "border-[var(--line)] bg-white/72 text-[var(--sea-ink-soft)]"
          }`}
        >
          <Star size={13} fill={starred ? "currentColor" : "none"} /> Starred
        </button>
        <button
          type="button"
          aria-pressed={hasAttachment}
          onClick={() => setHasAttachment((current) => !current)}
          className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[0.7rem] font-bold ${
            hasAttachment
              ? "border-[var(--lagoon)] bg-[var(--sand)] text-[var(--palm)]"
              : "border-[var(--line)] bg-white/72 text-[var(--sea-ink-soft)]"
          }`}
        >
          <Paperclip size={13} /> Files
        </button>
        <button
          type="submit"
          className="ml-auto h-8 rounded-lg bg-[var(--sea-ink)] px-3 text-[0.7rem] font-extrabold text-white"
        >
          Apply
        </button>
        {hasActiveMailboxFilters(filters) ? (
          <button
            type="button"
            aria-label="Clear search and filters"
            onClick={() => onQueryChange({ delivery: filters.delivery })}
            className="flex size-8 items-center justify-center rounded-lg text-[var(--sea-ink-soft)] hover:bg-white"
          >
            <X size={14} />
          </button>
        ) : null}
      </div>
    </form>
  );
}

function MessageActionButtons({
  archiveFolderId,
  message,
  onAction,
  pending,
  trashFolderId,
}: {
  readonly archiveFolderId?: string;
  readonly message: MessageListItemData;
  readonly onAction: (
    action: MessageRowAction,
    message: MessageListItemData
  ) => void;
  readonly pending: boolean;
  readonly trashFolderId?: string;
}) {
  return (
    <div className="flex items-center justify-end gap-1 border-t border-[var(--line)]/70 px-3 py-1.5">
      {pending ? (
        <LoaderCircle
          aria-label="Updating message"
          className="mr-auto animate-spin text-[var(--sea-ink-soft)]"
          size={14}
        />
      ) : null}
      <button
        type="button"
        disabled={pending}
        onClick={() => onAction("read", message)}
        aria-label={message.read ? "Mark unread" : "Mark read"}
        className="flex size-8 items-center justify-center rounded-lg text-[var(--sea-ink-soft)] hover:bg-[var(--foam)] hover:text-[var(--sea-ink)] disabled:opacity-40"
      >
        {message.read ? <Mail size={14} /> : <MailOpen size={14} />}
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => onAction("star", message)}
        aria-label={message.starred ? "Remove star" : "Add star"}
        className="flex size-8 items-center justify-center rounded-lg text-[var(--sea-ink-soft)] hover:bg-[var(--foam)] hover:text-[var(--palm)] disabled:opacity-40"
      >
        <Star size={14} fill={message.starred ? "currentColor" : "none"} />
      </button>
      <button
        type="button"
        disabled={pending || message.folderId === archiveFolderId}
        onClick={() => onAction("archive", message)}
        aria-label="Archive message"
        className="flex size-8 items-center justify-center rounded-lg text-[var(--sea-ink-soft)] hover:bg-[var(--foam)] hover:text-[var(--sea-ink)] disabled:opacity-30"
      >
        <Archive size={14} />
      </button>
      <button
        type="button"
        disabled={pending || message.folderId === trashFolderId}
        onClick={() => onAction("trash", message)}
        aria-label="Move message to trash"
        className="flex size-8 items-center justify-center rounded-lg text-[var(--sea-ink-soft)] hover:bg-red-50 hover:text-red-700 disabled:opacity-30"
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

export function MessageList({
  actionError,
  actionErrors,
  archiveFolderId,
  data,
  filters,
  isLoadingMore,
  isRefreshing = false,
  loadMoreFailed,
  onLoadMore,
  onMessageAction,
  onOpenMessage,
  onQueryChange,
  onRetryAction,
  onRetryRefresh,
  pendingMessageIds = noPendingMessageIds,
  refreshFailed = false,
  selectedThreadId,
  selection,
  trashFolderId,
}: {
  readonly actionError?: string;
  readonly actionErrors?: readonly {
    readonly handleRetry?: () => void;
    readonly messageId: string;
    readonly text: string;
  }[];
  readonly archiveFolderId?: string;
  readonly data: MessageListData;
  readonly filters: MailboxMessageQueryState;
  readonly isLoadingMore: boolean;
  readonly isRefreshing?: boolean;
  readonly loadMoreFailed: boolean;
  readonly onLoadMore: () => void;
  readonly onMessageAction: (
    action: MessageRowAction,
    message: MessageListItemData
  ) => void;
  readonly onOpenMessage: (threadId: string, messageId: string) => void;
  readonly onQueryChange: (state: MailboxMessageQueryState) => void;
  readonly onRetryAction?: () => void;
  readonly onRetryRefresh?: () => void;
  readonly pendingMessageIds?: ReadonlySet<string>;
  readonly refreshFailed?: boolean;
  readonly selectedThreadId?: string;
  readonly selection: MailboxViewSelection;
  readonly trashFolderId?: string;
}) {
  const hasActiveFilters = hasActiveMailboxFilters(filters);
  const displayedActionErrors =
    actionErrors ??
    (actionError === undefined
      ? []
      : [
          {
            handleRetry: onRetryAction,
            messageId: "action",
            text: actionError,
          },
        ]);

  return (
    <section
      aria-label="Messages"
      className={`min-h-0 border-[var(--line)] bg-white/42 lg:border-r ${selectedThreadId === undefined ? "flex" : "hidden lg:flex"} flex-col`}
    >
      <div className="shrink-0 border-b border-[var(--line)] p-3 sm:p-4">
        <div className="flex items-center justify-between px-1">
          <p className="text-xs font-extrabold tracking-[0.12em] text-[var(--sea-ink-soft)] uppercase">
            Messages
          </p>
          <span className="rounded-full bg-[var(--sand)] px-2.5 py-1 text-[0.65rem] font-extrabold text-[var(--palm)]">
            {data.items.length}
          </span>
          {isRefreshing ? (
            <LoaderCircle
              aria-label="Refreshing messages"
              className="animate-spin text-[var(--sea-ink-soft)]"
              size={14}
            />
          ) : null}
        </div>
        <MessageSearchControls
          filters={filters}
          onQueryChange={onQueryChange}
        />
        {displayedActionErrors.map((failure) => (
          <div
            key={failure.messageId}
            role="alert"
            className="mt-3 flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-[0.68rem] font-bold text-red-700"
          >
            <span className="flex-1">{failure.text}</span>
            {failure.handleRetry === undefined ? null : (
              <button
                type="button"
                onClick={failure.handleRetry}
                className="rounded-md bg-white px-2 py-1 text-red-800"
              >
                Try again
              </button>
            )}
          </div>
        ))}
        {refreshFailed ? (
          <div
            role="alert"
            className="mt-3 flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-[0.68rem] font-bold text-amber-900"
          >
            <span className="flex-1">
              Messages could not be refreshed. Showing saved results.
            </span>
            {onRetryRefresh === undefined ? null : (
              <button
                type="button"
                onClick={onRetryRefresh}
                className="rounded-md bg-white px-2 py-1"
              >
                Try again
              </button>
            )}
          </div>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2 sm:p-3">
        {data.items.length === 0 ? (
          <div className="flex min-h-72 items-center justify-center px-6 text-center text-[var(--sea-ink-soft)]">
            <div>
              <Inbox className="mx-auto opacity-30" size={34} />
              <p className="mt-4 text-sm font-extrabold">
                {hasActiveFilters ? "No matching messages" : "No messages here"}
              </p>
              <p className="mt-1 text-xs leading-5">
                {hasActiveFilters
                  ? "Try a different search or remove a filter."
                  : "This folder or label is currently empty."}
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-1">
            {data.items.map((message) => {
              const selected = message.threadId === selectedThreadId;
              const correspondent =
                message.direction === "inbound"
                  ? message.sender === undefined
                    ? "Unknown sender"
                    : addressName(message.sender)
                  : `To ${message.recipients[0] === undefined ? "undisclosed recipients" : addressName(message.recipients[0])}`;

              return (
                <article
                  key={message.id}
                  className={`overflow-hidden rounded-2xl border ${
                    selected
                      ? "border-[var(--lagoon)] bg-white text-[var(--sea-ink)] shadow-[0_9px_24px_rgba(23,58,64,0.09)] hover:text-[var(--sea-ink)]"
                      : "border-transparent text-[var(--sea-ink)] hover:border-[var(--line)] hover:bg-white/68 hover:text-[var(--sea-ink)]"
                  }`}
                >
                  <a
                    href={mailboxViewHref(
                      selection,
                      message.threadId,
                      message.id,
                      filters
                    )}
                    aria-label={`${correspondent}: ${message.subject || "No subject"}`}
                    aria-current={selected ? "page" : undefined}
                    onClick={(event) => {
                      if (
                        event.button === 0 &&
                        !event.altKey &&
                        !event.ctrlKey &&
                        !event.metaKey &&
                        !event.shiftKey
                      ) {
                        event.preventDefault();
                        onOpenMessage(message.threadId, message.id);
                      }
                    }}
                    className="block px-4 py-3.5 text-inherit no-underline hover:text-inherit sm:px-5"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`size-2 shrink-0 rounded-full ${message.read ? "bg-transparent" : "bg-[var(--lagoon-deep)]"}`}
                      />
                      <span
                        className={`min-w-0 flex-1 truncate text-sm ${message.read ? "font-bold" : "font-extrabold"}`}
                      >
                        {correspondent}
                      </span>
                      <span className="shrink-0 text-[0.65rem] font-bold text-[var(--sea-ink-soft)]">
                        {messageDate.format(new Date(message.activityAt))}
                      </span>
                    </div>
                    <div className="mt-2 pl-4">
                      <div className="flex items-center gap-2">
                        {message.direction === "inbound" ? (
                          <ArrowDownLeft
                            aria-label="Received"
                            size={13}
                            className="shrink-0 text-[var(--palm)]"
                          />
                        ) : (
                          <ArrowUpRight
                            aria-label="Sent"
                            size={13}
                            className="shrink-0 text-[var(--lagoon-deep)]"
                          />
                        )}
                        <p
                          className={`truncate text-sm ${message.read ? "font-semibold" : "font-extrabold"}`}
                        >
                          {message.subject || "(No subject)"}
                        </p>
                        {message.hasAttachments ? (
                          <Paperclip
                            aria-label="Has attachments"
                            className="ml-auto shrink-0 text-[var(--sea-ink-soft)]"
                            size={14}
                          />
                        ) : null}
                      </div>
                      <p className="mt-1 truncate text-xs leading-5 text-[var(--sea-ink-soft)]">
                        {message.snippet || "No text preview"}
                      </p>
                    </div>
                  </a>
                  <MessageActionButtons
                    archiveFolderId={archiveFolderId}
                    message={message}
                    onAction={onMessageAction}
                    pending={pendingMessageIds.has(message.id)}
                    trashFolderId={trashFolderId}
                  />
                </article>
              );
            })}
          </div>
        )}
      </div>

      {data.nextCursor === undefined ? null : (
        <div className="border-t border-[var(--line)] p-3 text-center">
          {loadMoreFailed ? (
            <p className="mb-2 text-[0.68rem] font-bold text-red-700">
              More messages could not be loaded.
            </p>
          ) : null}
          <button
            type="button"
            disabled={isLoadingMore}
            onClick={onLoadMore}
            className="inline-flex items-center gap-2 rounded-xl border border-[var(--line)] bg-white/72 px-4 py-2 text-[0.7rem] font-extrabold text-[var(--sea-ink)] disabled:opacity-55"
          >
            {isLoadingMore ? (
              <LoaderCircle className="animate-spin" size={14} />
            ) : null}
            {loadMoreFailed ? "Try again" : "Load more"}
          </button>
        </div>
      )}
    </section>
  );
}
