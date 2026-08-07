import { Select } from "@base-ui/react/select";
import type * as Schema from "effect/Schema";
import {
  Archive,
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  ChevronDown,
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
import { useEffect, useEffectEvent, useRef, useState } from "react";

import type { MailboxMessageListResult } from "#/modules/mailbox/application/MailboxMessageReading";
import { hasSearchableMessageTerm } from "#/modules/mailbox/domain/Mailbox";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import type {
  MailboxMessageQueryState,
  MailboxViewSelection,
} from "./MailboxViewLinks";
import { mailboxViewHref } from "./MailboxViewLinks";

type MessageListData = Schema.Codec.Encoded<typeof MailboxMessageListResult>;
export type MessageListItemData = MessageListData["items"][number];
export type MessageRowAction = "archive" | "read" | "star" | "trash";
const noPendingMessageIds: ReadonlySet<string> = new Set();
const readFilterItems = [
  { label: "Any status", value: "any" },
  { label: "Unread", value: "unread" },
  { label: "Read", value: "read" },
] as const;
type ReadFilterValue = (typeof readFilterItems)[number]["value"];

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
  const [read, setRead] = useState<ReadFilterValue>(filters.read ?? "any");
  const [starred, setStarred] = useState(filters.starred ?? false);
  const [hasAttachment, setHasAttachment] = useState(
    filters.hasAttachment ?? false
  );
  const [searchError, setSearchError] = useState(false);

  const submitFilters = useEffectEvent(() => {
    const trimmedQuery = query.trim();
    if (trimmedQuery !== "" && !hasSearchableMessageTerm(trimmedQuery)) {
      setSearchError(true);
      return;
    }
    setSearchError(false);
    const nextFilters = {
      delivery: filters.delivery,
      hasAttachment: hasAttachment || undefined,
      query: trimmedQuery === "" ? undefined : trimmedQuery,
      read: read === "any" ? undefined : read,
      starred: starred || undefined,
    };
    if (
      nextFilters.query === filters.query &&
      nextFilters.read === filters.read &&
      nextFilters.starred === filters.starred &&
      nextFilters.hasAttachment === filters.hasAttachment
    ) {
      return;
    }
    onQueryChange(nextFilters);
  });

  useEffect(() => {
    const timeout = window.setTimeout(submitFilters, 350);
    return () => window.clearTimeout(timeout);
  }, [hasAttachment, query, read, starred]);

  return (
    <form
      className="mt-3 space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
      }}
    >
      <label
        htmlFor="message-search"
        className="flex items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--control-bg)] px-3 py-2 text-[var(--sea-ink-soft)] focus-within:border-[var(--lagoon-deep)] focus-within:bg-[var(--surface-strong)]"
      >
        <Search size={15} />
        <span className="sr-only">Search messages</span>
        <Input
          id="message-search"
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
          className="h-auto min-w-0 flex-1 rounded-none border-0 bg-transparent px-0 py-0 text-sm text-[var(--sea-ink)] transition-none outline-none placeholder:text-[var(--sea-ink-soft)]/55 focus-visible:ring-0 dark:bg-transparent"
        />
      </label>
      {searchError ? (
        <Alert
          id="message-search-error"
          className="block w-auto rounded-none border-0 bg-transparent px-1 py-0 text-[0.68rem] font-bold text-[var(--danger-fg)]"
        >
          Enter at least one letter or number.
        </Alert>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Select.Root
          items={readFilterItems}
          value={read}
          onValueChange={(value) => setRead(value ?? "any")}
        >
          <Select.Trigger
            aria-label="Read status"
            className="group flex h-8 min-w-27 items-center justify-between gap-2 rounded-lg border border-[var(--line)] bg-[var(--control-bg)] px-2.5 text-[0.7rem] font-bold text-[var(--sea-ink-soft)] transition-colors outline-none hover:bg-[var(--surface-strong)] hover:text-[var(--sea-ink)] focus-visible:border-[var(--lagoon-deep)] focus-visible:ring-2 focus-visible:ring-[var(--lagoon)]/20 data-popup-open:border-[var(--lagoon)] data-popup-open:bg-[var(--surface-strong)] data-popup-open:text-[var(--sea-ink)]"
          >
            <Select.Value />
            <Select.Icon className="text-[var(--sea-ink-soft)] transition-transform duration-150 group-data-popup-open:rotate-180">
              <ChevronDown size={13} strokeWidth={2.5} />
            </Select.Icon>
          </Select.Trigger>
          <Select.Portal>
            <Select.Positioner
              alignItemWithTrigger={false}
              sideOffset={6}
              className="z-50 outline-none"
            >
              <Select.Popup className="w-36 origin-[var(--transform-origin)] rounded-xl border border-[var(--line)] bg-[var(--surface-strong)] p-1.5 text-[var(--sea-ink)] shadow-[0_14px_35px_rgba(0,0,0,0.22)] transition-[transform,opacity] duration-150 outline-none data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
                <Select.List>
                  {readFilterItems.map((item) => (
                    <Select.Item
                      key={item.value}
                      value={item.value}
                      className="grid h-9 cursor-default grid-cols-[1rem_1fr] items-center gap-2 rounded-lg px-2 text-xs font-bold text-[var(--sea-ink-soft)] outline-none select-none data-highlighted:bg-[var(--sand)] data-highlighted:text-[var(--palm)] data-selected:text-[var(--sea-ink)]"
                    >
                      <Select.ItemIndicator className="text-[var(--lagoon-deep)]">
                        <Check size={14} strokeWidth={2.5} />
                      </Select.ItemIndicator>
                      <Select.ItemText>{item.label}</Select.ItemText>
                    </Select.Item>
                  ))}
                </Select.List>
              </Select.Popup>
            </Select.Positioner>
          </Select.Portal>
        </Select.Root>
        <Button
          type="button"
          variant="ghost"
          aria-pressed={starred}
          onClick={() => setStarred((current) => !current)}
          className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[0.7rem] font-bold ${
            starred
              ? "border-[var(--lagoon)] bg-[var(--sand)] text-[var(--palm)]"
              : "border-[var(--line)] bg-[var(--control-bg)] text-[var(--sea-ink-soft)]"
          }`}
        >
          <Star size={13} fill={starred ? "currentColor" : "none"} /> Starred
        </Button>
        <Button
          type="button"
          variant="ghost"
          aria-pressed={hasAttachment}
          onClick={() => setHasAttachment((current) => !current)}
          className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[0.7rem] font-bold ${
            hasAttachment
              ? "border-[var(--lagoon)] bg-[var(--sand)] text-[var(--palm)]"
              : "border-[var(--line)] bg-[var(--control-bg)] text-[var(--sea-ink-soft)]"
          }`}
        >
          <Paperclip size={13} /> Files
        </Button>
        {hasActiveMailboxFilters(filters) ? (
          <Button
            type="button"
            variant="ghost"
            aria-label="Clear search and filters"
            onClick={() => onQueryChange({ delivery: filters.delivery })}
            className="flex size-8 items-center justify-center rounded-lg text-[var(--sea-ink-soft)] hover:bg-[var(--surface-strong)]"
          >
            <X size={14} />
          </Button>
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
      <Button
        type="button"
        variant="ghost"
        disabled={pending}
        onClick={() => onAction("read", message)}
        aria-label={message.read ? "Mark unread" : "Mark read"}
        className="flex size-8 items-center justify-center rounded-lg text-[var(--sea-ink-soft)] hover:bg-[var(--foam)] hover:text-[var(--sea-ink)] disabled:opacity-40"
      >
        {message.read ? <Mail size={14} /> : <MailOpen size={14} />}
      </Button>
      <Button
        type="button"
        variant="ghost"
        disabled={pending}
        onClick={() => onAction("star", message)}
        aria-label={message.starred ? "Remove star" : "Add star"}
        className="flex size-8 items-center justify-center rounded-lg text-[var(--sea-ink-soft)] hover:bg-[var(--foam)] hover:text-[var(--palm)] disabled:opacity-40"
      >
        <Star size={14} fill={message.starred ? "currentColor" : "none"} />
      </Button>
      <Button
        type="button"
        variant="ghost"
        disabled={pending || message.folderId === archiveFolderId}
        onClick={() => onAction("archive", message)}
        aria-label="Archive message"
        className="flex size-8 items-center justify-center rounded-lg text-[var(--sea-ink-soft)] hover:bg-[var(--foam)] hover:text-[var(--sea-ink)] disabled:opacity-30"
      >
        <Archive size={14} />
      </Button>
      <Button
        type="button"
        variant="ghost"
        disabled={pending || message.folderId === trashFolderId}
        onClick={() => onAction("trash", message)}
        aria-label="Move message to trash"
        className="flex size-8 items-center justify-center rounded-lg text-[var(--sea-ink-soft)] hover:bg-[var(--danger-bg)] hover:text-[var(--danger-fg)] disabled:opacity-30"
      >
        <Trash2 size={14} />
      </Button>
    </div>
  );
}

const useInfiniteMessageScroll = ({
  hasNextPage,
  isLoadingMore,
  loadMoreFailed,
  onLoadMore,
}: {
  readonly hasNextPage: boolean;
  readonly isLoadingMore: boolean;
  readonly loadMoreFailed: boolean;
  readonly onLoadMore: () => void;
}) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const requestNextPage = useEffectEvent(onLoadMore);

  useEffect(() => {
    const target = loadMoreRef.current;
    const root = scrollContainerRef.current;
    if (
      target === null ||
      root === null ||
      !hasNextPage ||
      isLoadingMore ||
      loadMoreFailed ||
      typeof IntersectionObserver === "undefined"
    ) {
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting === true) {
          observer.disconnect();
          requestNextPage();
        }
      },
      { root, rootMargin: "240px 0px" }
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasNextPage, isLoadingMore, loadMoreFailed]);

  return { loadMoreRef, scrollContainerRef };
};

// oxlint-disable-next-line eslint/complexity -- The list renders independent loading, error, filtering, action, and pagination states.
export function MessageList({
  actionError,
  actionErrors,
  archiveFolderId,
  data,
  filters,
  isInitialLoading = false,
  isLoadingMore,
  isRefreshing = false,
  loadMoreFailed,
  onLoadMore,
  onMessageAction,
  onOpenMessage,
  onQueryChange,
  onRetryAction,
  pendingMessageIds = noPendingMessageIds,
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
  readonly isInitialLoading?: boolean;
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
  readonly pendingMessageIds?: ReadonlySet<string>;
  readonly selectedThreadId?: string;
  readonly selection: MailboxViewSelection;
  readonly trashFolderId?: string;
}) {
  const hasActiveFilters = hasActiveMailboxFilters(filters);
  const { loadMoreRef, scrollContainerRef } = useInfiniteMessageScroll({
    hasNextPage: data.nextCursor !== undefined,
    isLoadingMore,
    loadMoreFailed,
    onLoadMore,
  });
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
      className={`min-h-0 border-[var(--line)] bg-[var(--workspace-bg)] lg:border-r ${selectedThreadId === undefined ? "flex" : "hidden lg:flex"} flex-col`}
    >
      <div className="shrink-0 border-b border-[var(--line)] p-3 sm:p-4">
        <div className="flex items-center justify-between px-1">
          <p className="text-xs font-extrabold tracking-[0.12em] text-[var(--sea-ink-soft)] uppercase">
            Messages
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <output className="inline-flex size-3.5 shrink-0 items-center justify-center">
              {isRefreshing ? (
                <>
                  <LoaderCircle
                    aria-hidden="true"
                    className="animate-spin text-[var(--sea-ink-soft)]"
                    size={14}
                  />
                  <span className="sr-only">Refreshing messages</span>
                </>
              ) : null}
            </output>
            <span
              aria-label={
                isInitialLoading
                  ? "Loading message count"
                  : `${data.items.length} messages`
              }
              className="rounded-full bg-[var(--sand)] px-2.5 py-1 text-[0.65rem] font-extrabold text-[var(--palm)]"
            >
              {isInitialLoading ? "--" : data.items.length}
            </span>
          </div>
        </div>
        <MessageSearchControls
          key={`${filters.query ?? ""}:${filters.read ?? ""}:${filters.starred === true}:${filters.hasAttachment === true}`}
          filters={filters}
          onQueryChange={onQueryChange}
        />
        {displayedActionErrors.map((failure) => (
          <Alert
            key={failure.messageId}
            className="mt-3 flex items-center gap-2 rounded-lg border border-[var(--danger-border)] bg-[var(--danger-bg)] px-3 py-2 text-[0.68rem] font-bold text-[var(--danger-fg)]"
          >
            <span className="flex-1">{failure.text}</span>
            {failure.handleRetry === undefined ? null : (
              <Button
                type="button"
                variant="ghost"
                onClick={failure.handleRetry}
                className="h-auto rounded-md bg-[var(--surface-strong)] px-2 py-1 text-[var(--danger-fg)]"
              >
                Try again
              </Button>
            )}
          </Alert>
        ))}
      </div>

      <div
        ref={scrollContainerRef}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2 sm:p-3"
      >
        {isInitialLoading ? (
          <output aria-label="Loading messages" className="block space-y-2 p-1">
            {[0, 1, 2, 3, 4].map((row) => (
              <span
                key={row}
                className="block animate-pulse rounded-2xl border border-[var(--line)]/55 px-4 py-4 sm:px-5"
              >
                <span className="flex items-center gap-3">
                  <span className="size-2 rounded-full bg-[var(--line)]" />
                  <span className="h-3 w-2/5 rounded-full bg-[var(--line)]" />
                  <span className="ml-auto h-2.5 w-12 rounded-full bg-[var(--line)]/70" />
                </span>
                <span className="mt-3 ml-5 block h-3 w-3/5 rounded-full bg-[var(--line)]/85" />
                <span className="mt-2 ml-5 block h-2.5 w-4/5 rounded-full bg-[var(--line)]/55" />
              </span>
            ))}
          </output>
        ) : data.items.length === 0 ? (
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
                  className={`mail-list-item overflow-hidden rounded-2xl border ${
                    selected
                      ? "border-[var(--lagoon)] bg-[var(--surface-strong)] text-[var(--sea-ink)] shadow-[0_9px_24px_rgba(23,58,64,0.09)] hover:text-[var(--sea-ink)]"
                      : "border-transparent text-[var(--sea-ink)] hover:border-[var(--line)] hover:bg-[var(--control-bg)] hover:text-[var(--sea-ink)]"
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
                        <span className="flex min-w-0 items-baseline gap-1">
                          <span
                            className={`truncate text-sm ${message.read ? "font-semibold" : "font-extrabold"}`}
                          >
                            {message.subject || "(No subject)"}
                          </span>
                          {(message.threadMessageCount ?? 1) > 1 ? (
                            <span
                              aria-label={`${message.threadMessageCount ?? 1} messages in conversation`}
                              className="shrink-0 text-sm font-extrabold text-[var(--sea-ink-soft)]"
                            >
                              ({message.threadMessageCount ?? 1})
                            </span>
                          ) : null}
                        </span>
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
        {data.nextCursor === undefined ? null : (
          <div
            ref={loadMoreRef}
            className="flex min-h-16 items-center justify-center"
          >
            {isLoadingMore ? (
              <LoaderCircle
                aria-label="Loading more messages"
                className="animate-spin text-[var(--sea-ink-soft)]"
                size={16}
              />
            ) : null}
          </div>
        )}
      </div>

      {data.nextCursor === undefined ? null : (
        <div className="border-t border-[var(--line)] p-3 text-center">
          {loadMoreFailed ? (
            <p className="mb-2 text-[0.68rem] font-bold text-[var(--danger-fg)]">
              More messages could not be loaded.
            </p>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            disabled={isLoadingMore}
            onClick={onLoadMore}
            className="inline-flex h-auto items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--control-bg)] px-4 py-2 text-[0.7rem] font-extrabold text-[var(--sea-ink)] disabled:opacity-55"
          >
            {isLoadingMore ? (
              <LoaderCircle className="animate-spin" size={14} />
            ) : null}
            {loadMoreFailed ? "Try again" : "Load more"}
          </Button>
        </div>
      )}
    </section>
  );
}
