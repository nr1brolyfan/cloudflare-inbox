import type * as Schema from "effect/Schema";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Inbox,
  LoaderCircle,
  Paperclip,
  Search,
  Star,
  X,
} from "lucide-react";
import { useState } from "react";

import { hasSearchableMessageTerm } from "../mailboxes/core";
import type { MailboxMessageListResult } from "../mailboxes/message-reading";
import type {
  MailboxMessageQueryState,
  MailboxViewSelection,
} from "./mailbox-view-links";
import { mailboxViewHref } from "./mailbox-view-links";

type MessageListData = Schema.Codec.Encoded<typeof MailboxMessageListResult>;

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
            onClick={() => onQueryChange({})}
            className="flex size-8 items-center justify-center rounded-lg text-[var(--sea-ink-soft)] hover:bg-white"
          >
            <X size={14} />
          </button>
        ) : null}
      </div>
    </form>
  );
}

export function MessageList({
  data,
  filters,
  isLoadingMore,
  loadMoreFailed,
  onLoadMore,
  onOpenMessage,
  onQueryChange,
  selectedThreadId,
  selection,
}: {
  readonly data: MessageListData;
  readonly filters: MailboxMessageQueryState;
  readonly isLoadingMore: boolean;
  readonly loadMoreFailed: boolean;
  readonly onLoadMore: () => void;
  readonly onOpenMessage: (threadId: string, messageId: string) => void;
  readonly onQueryChange: (state: MailboxMessageQueryState) => void;
  readonly selectedThreadId?: string;
  readonly selection: MailboxViewSelection;
}) {
  const hasActiveFilters = hasActiveMailboxFilters(filters);

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
        </div>
        <MessageSearchControls
          filters={filters}
          onQueryChange={onQueryChange}
        />
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
                <a
                  key={message.id}
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
                  className={`block rounded-2xl border px-4 py-3.5 no-underline sm:px-5 ${
                    selected
                      ? "border-[var(--lagoon)] bg-white text-[var(--sea-ink)] shadow-[0_9px_24px_rgba(23,58,64,0.09)] hover:text-[var(--sea-ink)]"
                      : "border-transparent text-[var(--sea-ink)] hover:border-[var(--line)] hover:bg-white/68 hover:text-[var(--sea-ink)]"
                  }`}
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
