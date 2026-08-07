import { Checkbox } from "@base-ui/react/checkbox";
import { ContextMenu } from "@base-ui/react/context-menu";
import { Menu } from "@base-ui/react/menu";
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
  Minus,
  MoreHorizontal,
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
const menuItemClass =
  "flex h-9 cursor-default items-center gap-2 rounded-lg px-2.5 text-xs font-bold text-[var(--sea-ink-soft)] outline-none select-none data-disabled:opacity-35 data-highlighted:bg-[var(--sand)] data-highlighted:text-[var(--sea-ink)]";
const menuPopupClass =
  "min-w-48 origin-[var(--transform-origin)] rounded-xl border border-[var(--line)] bg-[var(--popover)] p-1.5 text-[var(--sea-ink)] shadow-[0_14px_35px_rgba(0,0,0,0.28)] transition-[transform,opacity] duration-150 outline-none data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0";
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
  readActionsEnabled,
}: {
  readonly filters: MailboxMessageQueryState;
  readonly onQueryChange: (state: MailboxMessageQueryState) => void;
  readonly readActionsEnabled: boolean;
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
      read: readActionsEnabled && read !== "any" ? read : undefined,
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
        {readActionsEnabled ? (
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
        ) : null}
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

function MessageCheckbox({
  checked,
  disabled = false,
  indeterminate = false,
  label,
  onCheckedChange,
}: {
  readonly checked: boolean;
  readonly disabled?: boolean;
  readonly indeterminate?: boolean;
  readonly label: string;
  readonly onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <Checkbox.Root
      aria-label={label}
      checked={checked}
      disabled={disabled}
      indeterminate={indeterminate}
      onCheckedChange={onCheckedChange}
      className="group/checkbox flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-[var(--lagoon)]/35 data-disabled:cursor-default data-disabled:opacity-35"
    >
      <Checkbox.Indicator
        keepMounted
        className="flex size-4 items-center justify-center rounded-[0.3rem] border border-[var(--line)] bg-[var(--control-bg)] text-transparent transition-colors group-data-checked/checkbox:border-[var(--lagoon-deep)] group-data-checked/checkbox:bg-[var(--lagoon-deep)] group-data-checked/checkbox:text-[var(--surface)] group-data-indeterminate/checkbox:border-[var(--lagoon-deep)] group-data-indeterminate/checkbox:bg-[var(--lagoon-deep)] group-data-indeterminate/checkbox:text-[var(--surface)]"
      >
        {indeterminate ? (
          <Minus aria-hidden="true" size={11} strokeWidth={3} />
        ) : (
          <Check aria-hidden="true" size={11} strokeWidth={3} />
        )}
      </Checkbox.Indicator>
    </Checkbox.Root>
  );
}

function MessageMenuItems({
  archiveFolderId,
  message,
  onAction,
  onOpen,
  pending,
  readActionsEnabled,
  trashFolderId,
  type,
}: {
  readonly archiveFolderId?: string;
  readonly message: MessageListItemData;
  readonly onAction: (
    action: MessageRowAction,
    message: MessageListItemData
  ) => void;
  readonly onOpen: () => void;
  readonly pending: boolean;
  readonly readActionsEnabled: boolean;
  readonly trashFolderId?: string;
  readonly type: "context" | "menu";
}) {
  const Item = type === "context" ? ContextMenu.Item : Menu.Item;
  const Separator = type === "context" ? ContextMenu.Separator : Menu.Separator;
  return (
    <>
      <Item className={menuItemClass} onClick={onOpen}>
        <MailOpen size={14} />
        Open message
      </Item>
      <Separator className="my-1 h-px bg-[var(--line)]" />
      {readActionsEnabled ? (
        <Item
          className={menuItemClass}
          disabled={pending}
          onClick={() => onAction("read", message)}
        >
          {message.read ? <Mail size={14} /> : <MailOpen size={14} />}
          {message.read ? "Mark unread" : "Mark read"}
        </Item>
      ) : null}
      <Item
        className={menuItemClass}
        disabled={pending}
        onClick={() => onAction("star", message)}
      >
        <Star size={14} fill={message.starred ? "currentColor" : "none"} />
        {message.starred ? "Remove star" : "Add star"}
      </Item>
      <Separator className="my-1 h-px bg-[var(--line)]" />
      <Item
        className={menuItemClass}
        disabled={pending || message.folderId === archiveFolderId}
        onClick={() => onAction("archive", message)}
      >
        <Archive size={14} />
        Archive
      </Item>
      <Item
        className={`${menuItemClass} data-highlighted:bg-[var(--danger-bg)] data-highlighted:text-[var(--danger-fg)]`}
        disabled={pending || message.folderId === trashFolderId}
        onClick={() => onAction("trash", message)}
      >
        <Trash2 size={14} />
        Move to trash
      </Item>
    </>
  );
}

function MessageOverflowMenu({
  archiveFolderId,
  message,
  onAction,
  onOpen,
  pending,
  readActionsEnabled,
  trashFolderId,
}: {
  readonly archiveFolderId?: string;
  readonly message: MessageListItemData;
  readonly onAction: (
    action: MessageRowAction,
    message: MessageListItemData
  ) => void;
  readonly onOpen: () => void;
  readonly pending: boolean;
  readonly readActionsEnabled: boolean;
  readonly trashFolderId?: string;
}) {
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label="Message actions"
        className="flex size-8 shrink-0 items-center justify-center rounded-lg text-[var(--sea-ink-soft)] outline-none hover:bg-[var(--foam)] hover:text-[var(--sea-ink)] focus-visible:ring-2 focus-visible:ring-[var(--lagoon)]/35 data-popup-open:bg-[var(--foam)] data-popup-open:text-[var(--sea-ink)]"
      >
        <MoreHorizontal size={15} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner
          align="end"
          sideOffset={6}
          className="z-50 outline-none"
        >
          <Menu.Popup className={menuPopupClass}>
            <MessageMenuItems
              archiveFolderId={archiveFolderId}
              message={message}
              onAction={onAction}
              onOpen={onOpen}
              pending={pending}
              readActionsEnabled={readActionsEnabled}
              trashFolderId={trashFolderId}
              type="menu"
            />
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
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
  onMessageBatchAction,
  onMessageAction,
  onOpenMessage,
  onQueryChange,
  onRetryAction,
  pendingMessageIds = noPendingMessageIds,
  pendingThreadIds = noPendingMessageIds,
  readActionsEnabled = true,
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
  readonly onMessageBatchAction: (
    action: MessageRowAction,
    messages: readonly MessageListItemData[]
  ) => void;
  readonly onMessageAction: (
    action: MessageRowAction,
    message: MessageListItemData
  ) => void;
  readonly onOpenMessage: (threadId: string, messageId: string) => void;
  readonly onQueryChange: (state: MailboxMessageQueryState) => void;
  readonly onRetryAction?: () => void;
  readonly pendingMessageIds?: ReadonlySet<string>;
  readonly pendingThreadIds?: ReadonlySet<string>;
  readonly readActionsEnabled?: boolean;
  readonly selectedThreadId?: string;
  readonly selection: MailboxViewSelection;
  readonly trashFolderId?: string;
}) {
  const [selectedMessageIds, setSelectedMessageIds] = useState<Set<string>>(
    () => new Set()
  );
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
  const selectedMessages = data.items.filter((message) =>
    selectedMessageIds.has(message.id)
  );
  const selectedCount = selectedMessages.length;
  const allLoadedSelected =
    data.items.length > 0 && selectedCount === data.items.length;
  const someLoadedSelected = selectedCount > 0 && !allLoadedSelected;

  const toggleMessageSelection = (messageId: string, checked: boolean) => {
    setSelectedMessageIds((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(messageId);
      } else {
        next.delete(messageId);
      }
      return next;
    });
  };
  const toggleAllLoaded = (checked: boolean) =>
    setSelectedMessageIds(
      checked ? new Set(data.items.map((message) => message.id)) : new Set()
    );
  const executeBulkAction = (action: MessageRowAction) => {
    const allInTargetState =
      action === "read"
        ? selectedMessages.every((message) => message.read)
        : action === "star"
          ? selectedMessages.every((message) => message.starred)
          : false;
    const actionableMessages = selectedMessages.filter((message) => {
      const pending = pendingMessageIds.has(message.id);
      const alreadyInFolder =
        (action === "archive" && message.folderId === archiveFolderId) ||
        (action === "trash" && message.folderId === trashFolderId);
      const needsToggle =
        action === "read"
          ? message.read === allInTargetState
          : action === "star"
            ? message.starred === allInTargetState
            : true;
      return !pending && !alreadyInFolder && needsToggle;
    });
    if (actionableMessages.length > 0) {
      onMessageBatchAction(action, actionableMessages);
    }
  };
  const allSelectedRead =
    selectedCount > 0 && selectedMessages.every((message) => message.read);
  const allSelectedStarred =
    selectedCount > 0 && selectedMessages.every((message) => message.starred);

  return (
    <section
      aria-label="Messages"
      className={`min-h-0 min-w-0 overflow-hidden border-[var(--line)] bg-[var(--workspace-bg)] lg:border-r ${selectedThreadId === undefined ? "flex" : "hidden lg:flex"} flex-col`}
    >
      <div className="shrink-0 border-b border-[var(--line)] p-3 sm:p-4">
        <div className="flex min-h-8 items-center gap-1">
          <MessageCheckbox
            checked={allLoadedSelected}
            disabled={data.items.length === 0}
            indeterminate={someLoadedSelected}
            label={
              allLoadedSelected
                ? "Clear message selection"
                : "Select all loaded messages"
            }
            onCheckedChange={toggleAllLoaded}
          />
          {selectedCount > 0 ? (
            <>
              <p className="mr-auto truncate text-xs font-extrabold text-[var(--sea-ink)]">
                {selectedCount} selected
              </p>
              <div
                aria-label="Bulk message actions"
                className="flex shrink-0 items-center gap-0.5"
                role="toolbar"
              >
                {readActionsEnabled ? (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => executeBulkAction("read")}
                    aria-label={
                      allSelectedRead
                        ? "Mark selected unread"
                        : "Mark selected read"
                    }
                    title={
                      allSelectedRead
                        ? "Mark selected unread"
                        : "Mark selected read"
                    }
                    className="flex size-8 items-center justify-center rounded-lg text-[var(--sea-ink-soft)] hover:bg-[var(--foam)] hover:text-[var(--sea-ink)]"
                  >
                    {allSelectedRead ? (
                      <Mail size={14} />
                    ) : (
                      <MailOpen size={14} />
                    )}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => executeBulkAction("star")}
                  aria-label={
                    allSelectedStarred
                      ? "Remove star from selected"
                      : "Add star to selected"
                  }
                  title={
                    allSelectedStarred
                      ? "Remove star from selected"
                      : "Add star to selected"
                  }
                  className="flex size-8 items-center justify-center rounded-lg text-[var(--sea-ink-soft)] hover:bg-[var(--foam)] hover:text-[var(--palm)]"
                >
                  <Star
                    size={14}
                    fill={allSelectedStarred ? "currentColor" : "none"}
                  />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => executeBulkAction("archive")}
                  aria-label="Archive selected"
                  title="Archive selected"
                  className="flex size-8 items-center justify-center rounded-lg text-[var(--sea-ink-soft)] hover:bg-[var(--foam)] hover:text-[var(--sea-ink)]"
                >
                  <Archive size={14} />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => executeBulkAction("trash")}
                  aria-label="Move selected to trash"
                  title="Move selected to trash"
                  className="flex size-8 items-center justify-center rounded-lg text-[var(--sea-ink-soft)] hover:bg-[var(--danger-bg)] hover:text-[var(--danger-fg)]"
                >
                  <Trash2 size={14} />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setSelectedMessageIds(new Set())}
                  aria-label="Clear message selection"
                  title="Clear selection"
                  className="flex size-8 items-center justify-center rounded-lg text-[var(--sea-ink-soft)] hover:bg-[var(--foam)] hover:text-[var(--sea-ink)]"
                >
                  <X size={14} />
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-xs font-extrabold tracking-[0.12em] text-[var(--sea-ink-soft)] uppercase">
                Messages
              </p>
              <div className="ml-auto flex shrink-0 items-center gap-2">
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
            </>
          )}
        </div>
        <MessageSearchControls
          key={`${filters.query ?? ""}:${filters.read ?? ""}:${filters.starred === true}:${filters.hasAttachment === true}`}
          filters={filters}
          onQueryChange={onQueryChange}
          readActionsEnabled={readActionsEnabled}
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
            {/* oxlint-disable-next-line eslint/complexity -- A row renders independent message states and controls. */}
            {data.items.map((message) => {
              const selected = message.threadId === selectedThreadId;
              const checked = selectedMessageIds.has(message.id);
              const pending =
                pendingMessageIds.has(message.id) ||
                pendingThreadIds.has(message.threadId);
              const correspondent =
                message.direction === "inbound"
                  ? message.sender === undefined
                    ? "Unknown sender"
                    : addressName(message.sender)
                  : `To ${message.recipients[0] === undefined ? "undisclosed recipients" : addressName(message.recipients[0])}`;

              return (
                <ContextMenu.Root key={message.id}>
                  <ContextMenu.Trigger
                    render={
                      <article
                        className={`group mail-list-item min-w-0 overflow-hidden rounded-2xl border ${
                          selected || checked
                            ? "border-[var(--lagoon)] bg-[var(--surface-strong)] text-[var(--sea-ink)] shadow-[0_9px_24px_rgba(23,58,64,0.09)] hover:text-[var(--sea-ink)]"
                            : "border-transparent text-[var(--sea-ink)] hover:border-[var(--line)] hover:bg-[var(--control-bg)] hover:text-[var(--sea-ink)]"
                        }`}
                      />
                    }
                  >
                    <div className="flex min-w-0 items-start gap-0.5 px-2 py-2 sm:px-3">
                      <MessageCheckbox
                        checked={checked}
                        disabled={pending}
                        label={`Select ${correspondent}: ${message.subject || "No subject"}`}
                        onCheckedChange={(nextChecked) =>
                          toggleMessageSelection(message.id, nextChecked)
                        }
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={pending}
                        onClick={() => onMessageAction("star", message)}
                        aria-label={
                          message.starred ? "Remove star" : "Add star"
                        }
                        title={message.starred ? "Remove star" : "Add star"}
                        className="flex size-8 shrink-0 items-center justify-center rounded-lg text-[var(--sea-ink-soft)] hover:bg-[var(--foam)] hover:text-[var(--palm)] disabled:opacity-35"
                      >
                        <Star
                          size={14}
                          fill={message.starred ? "currentColor" : "none"}
                        />
                      </Button>
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
                        className="min-w-0 flex-1 py-1 text-inherit no-underline outline-none hover:text-inherit focus-visible:text-[var(--lagoon-deep)]"
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
                          <span className="shrink-0 text-[0.65rem] font-bold text-[var(--sea-ink-soft)] sm:hidden">
                            {messageDate.format(new Date(message.activityAt))}
                          </span>
                        </div>
                        <div className="mt-1 flex items-center gap-2 pl-4">
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
                        <p className="mt-0.5 truncate pl-4 text-xs leading-5 text-[var(--sea-ink-soft)]">
                          {message.snippet || "No text preview"}
                        </p>
                      </a>
                      {pending ? (
                        <LoaderCircle
                          aria-label="Updating message"
                          className="m-2 shrink-0 animate-spin text-[var(--sea-ink-soft)]"
                          size={14}
                        />
                      ) : null}
                      <div className="hidden h-8 shrink-0 items-center sm:flex">
                        <span className="px-1 text-[0.65rem] font-bold text-[var(--sea-ink-soft)] group-focus-within:hidden group-hover:hidden">
                          {messageDate.format(new Date(message.activityAt))}
                        </span>
                        <div className="hidden items-center gap-0.5 group-focus-within:flex group-hover:flex">
                          {readActionsEnabled ? (
                            <Button
                              type="button"
                              variant="ghost"
                              disabled={pending}
                              onClick={() => onMessageAction("read", message)}
                              aria-label={
                                message.read ? "Mark unread" : "Mark read"
                              }
                              title={message.read ? "Mark unread" : "Mark read"}
                              className="flex size-8 items-center justify-center rounded-lg text-[var(--sea-ink-soft)] hover:bg-[var(--foam)] hover:text-[var(--sea-ink)] disabled:opacity-35"
                            >
                              {message.read ? (
                                <Mail size={14} />
                              ) : (
                                <MailOpen size={14} />
                              )}
                            </Button>
                          ) : null}
                          <Button
                            type="button"
                            variant="ghost"
                            disabled={
                              pending || message.folderId === archiveFolderId
                            }
                            onClick={() => onMessageAction("archive", message)}
                            aria-label="Archive message"
                            title="Archive message"
                            className="flex size-8 items-center justify-center rounded-lg text-[var(--sea-ink-soft)] hover:bg-[var(--foam)] hover:text-[var(--sea-ink)] disabled:opacity-35"
                          >
                            <Archive size={14} />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            disabled={
                              pending || message.folderId === trashFolderId
                            }
                            onClick={() => onMessageAction("trash", message)}
                            aria-label="Move message to trash"
                            title="Move message to trash"
                            className="flex size-8 items-center justify-center rounded-lg text-[var(--sea-ink-soft)] hover:bg-[var(--danger-bg)] hover:text-[var(--danger-fg)] disabled:opacity-35"
                          >
                            <Trash2 size={14} />
                          </Button>
                          <MessageOverflowMenu
                            archiveFolderId={archiveFolderId}
                            message={message}
                            onAction={onMessageAction}
                            onOpen={() =>
                              onOpenMessage(message.threadId, message.id)
                            }
                            pending={pending}
                            readActionsEnabled={readActionsEnabled}
                            trashFolderId={trashFolderId}
                          />
                        </div>
                      </div>
                      <div className="sm:hidden">
                        <MessageOverflowMenu
                          archiveFolderId={archiveFolderId}
                          message={message}
                          onAction={onMessageAction}
                          onOpen={() =>
                            onOpenMessage(message.threadId, message.id)
                          }
                          pending={pending}
                          readActionsEnabled={readActionsEnabled}
                          trashFolderId={trashFolderId}
                        />
                      </div>
                    </div>
                  </ContextMenu.Trigger>
                  <ContextMenu.Portal>
                    <ContextMenu.Positioner className="z-50 outline-none">
                      <ContextMenu.Popup className={menuPopupClass}>
                        <MessageMenuItems
                          archiveFolderId={archiveFolderId}
                          message={message}
                          onAction={onMessageAction}
                          onOpen={() =>
                            onOpenMessage(message.threadId, message.id)
                          }
                          pending={pending}
                          readActionsEnabled={readActionsEnabled}
                          trashFolderId={trashFolderId}
                          type="context"
                        />
                      </ContextMenu.Popup>
                    </ContextMenu.Positioner>
                  </ContextMenu.Portal>
                </ContextMenu.Root>
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
