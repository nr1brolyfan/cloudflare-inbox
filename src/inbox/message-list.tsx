import type * as Schema from "effect/Schema";
import { ArrowDownLeft, ArrowUpRight, Inbox, Paperclip } from "lucide-react";

import type { MailboxMessageListResult } from "../mailboxes/message-reading";
import type { MailboxViewSelection } from "./mailbox-view-links";
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

export function MessageList({
  data,
  selectedThreadId,
  selection,
}: {
  readonly data: MessageListData;
  readonly selectedThreadId?: string;
  readonly selection: MailboxViewSelection;
}) {
  return (
    <section
      aria-label="Messages"
      className={`min-h-0 border-[var(--line)] bg-white/42 lg:border-r ${selectedThreadId === undefined ? "flex" : "hidden lg:flex"} flex-col`}
    >
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-[var(--line)] px-4 sm:px-5">
        <p className="text-xs font-extrabold tracking-[0.12em] text-[var(--sea-ink-soft)] uppercase">
          Messages
        </p>
        <span className="rounded-full bg-[var(--sand)] px-2.5 py-1 text-[0.65rem] font-extrabold text-[var(--palm)]">
          {data.items.length}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2 sm:p-3">
        {data.items.length === 0 ? (
          <div className="flex min-h-72 items-center justify-center px-6 text-center text-[var(--sea-ink-soft)]">
            <div>
              <Inbox className="mx-auto opacity-30" size={34} />
              <p className="mt-4 text-sm font-extrabold">No messages here</p>
              <p className="mt-1 text-xs leading-5">
                This folder or label is currently empty.
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
                    message.id
                  )}
                  aria-label={`${correspondent}: ${message.subject || "No subject"}`}
                  aria-current={selected ? "page" : undefined}
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

      {data.hasMore ? (
        <p className="border-t border-[var(--line)] px-5 py-3 text-center text-[0.68rem] font-bold text-[var(--sea-ink-soft)]">
          More messages are available
        </p>
      ) : null}
    </section>
  );
}
