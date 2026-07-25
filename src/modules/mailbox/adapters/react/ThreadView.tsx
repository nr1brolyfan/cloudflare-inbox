import type * as Schema from "effect/Schema";
import { ArrowLeft, Download, MailOpen, Paperclip } from "lucide-react";
import { useState } from "react";

import type { MailboxThreadResult } from "#/modules/mailbox/application/MailboxMessageReading";

import type {
  MailboxMessageQueryState,
  MailboxViewSelection,
} from "./MailboxViewLinks";
import {
  mailboxInboundAttachmentHref,
  mailboxMessageHtmlHref,
  mailboxViewHref,
} from "./MailboxViewLinks";
import { SandboxedMessageHtml } from "./SandboxedMessageHtml";

type ThreadData = Schema.Codec.Encoded<typeof MailboxThreadResult>;

const messageDate = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

const addressText = (address: {
  readonly address: string;
  readonly displayName?: string;
}) =>
  address.displayName === undefined
    ? address.address
    : `${address.displayName} <${address.address}>`;

const messageAuthor = (message: {
  readonly direction: "inbound" | "outbound";
  readonly sender?: { readonly address: string; readonly displayName?: string };
}) =>
  message.sender === undefined
    ? message.direction === "inbound"
      ? "Unknown sender"
      : "Me"
    : addressText(message.sender);

const byteSize = (size: number) => {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${Math.round(size / 1024)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

function MessageBody({
  authorLabel,
  hasHtmlBody,
  htmlSrc,
  onPreviewAccessFailure,
  textBody,
}: {
  readonly authorLabel: string;
  readonly hasHtmlBody: boolean;
  readonly htmlSrc: string;
  readonly onPreviewAccessFailure?: (status: 401 | 403) => void;
  readonly textBody?: string;
}) {
  const [showHtml, setShowHtml] = useState(
    textBody === undefined && hasHtmlBody
  );

  return (
    <>
      {textBody !== undefined && hasHtmlBody ? (
        <fieldset className="mb-4 flex gap-2 border-0 p-0">
          <legend className="sr-only">Message body format</legend>
          <button
            type="button"
            aria-pressed={!showHtml}
            onClick={() => setShowHtml(false)}
            className="rounded-lg border border-[var(--line)] bg-white px-3 py-1.5 text-xs font-bold"
          >
            Plain text
          </button>
          <button
            type="button"
            aria-pressed={showHtml}
            onClick={() => setShowHtml(true)}
            className="rounded-lg border border-[var(--line)] bg-white px-3 py-1.5 text-xs font-bold"
          >
            Sandboxed HTML
          </button>
        </fieldset>
      ) : null}

      {showHtml ? (
        <SandboxedMessageHtml
          onAccessFailure={onPreviewAccessFailure}
          src={htmlSrc}
          title={`Sandboxed HTML message from ${authorLabel}`}
        />
      ) : textBody === undefined ? (
        <p className="text-sm text-[var(--sea-ink-soft)] italic">
          This message has no readable text body.
        </p>
      ) : (
        <pre className="font-sans text-sm leading-7 whitespace-pre-wrap text-[var(--sea-ink)]">
          {textBody}
        </pre>
      )}
    </>
  );
}

export function ThreadView({
  data,
  filters,
  mailboxId,
  onClose,
  onPreviewAccessFailure,
  selection,
}: {
  readonly data: ThreadData;
  readonly filters: MailboxMessageQueryState;
  readonly mailboxId: string;
  readonly onClose: () => void;
  readonly onPreviewAccessFailure?: (status: 401 | 403) => void;
  readonly selection: MailboxViewSelection;
}) {
  return (
    <section aria-label="Conversation" className="min-h-0 flex-1 bg-white/58">
      <header className="border-b border-[var(--line)] bg-white/58 px-4 py-4 sm:px-7 sm:py-5">
        <div className="flex items-start gap-3">
          <a
            href={mailboxViewHref(selection, undefined, undefined, filters)}
            aria-label="Close conversation"
            onClick={(event) => {
              if (
                event.button === 0 &&
                !event.altKey &&
                !event.ctrlKey &&
                !event.metaKey &&
                !event.shiftKey
              ) {
                event.preventDefault();
                onClose();
              }
            }}
            className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-[var(--line)] bg-white/72 text-[var(--sea-ink-soft)] no-underline hover:bg-white hover:text-[var(--sea-ink)] lg:hidden"
          >
            <ArrowLeft size={18} />
          </a>
          <div className="min-w-0 flex-1">
            <h2 className="display-title text-xl font-bold tracking-tight sm:text-2xl">
              {data.thread.subject || "(No subject)"}
            </h2>
            <p className="mt-1 flex items-center gap-2 text-xs text-[var(--sea-ink-soft)]">
              {data.thread.messageCount} messages
            </p>
          </div>
        </div>
      </header>

      <div className="h-[calc(100dvh-8.75rem)] overflow-y-auto p-3 sm:p-5 lg:h-[calc(100dvh-9rem)] lg:p-7">
        <div className="mx-auto max-w-3xl space-y-4">
          {data.messages.map((message) => (
            <article
              key={message.id}
              className="overflow-hidden rounded-2xl border border-[var(--line)] bg-white/78 shadow-[0_10px_30px_rgba(23,58,64,0.06)]"
            >
              <header className="border-b border-[var(--line)] px-4 py-4 sm:px-5">
                <div className="flex items-start gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--sand)] text-xs font-extrabold text-[var(--palm)]">
                    {messageAuthor(message).slice(0, 2).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-extrabold">
                      {messageAuthor(message)}
                    </p>
                    <p className="mt-1 truncate text-[0.68rem] text-[var(--sea-ink-soft)]">
                      To{" "}
                      {message.to.map(addressText).join(", ") || "undisclosed"}
                    </p>
                    {message.cc.length > 0 ? (
                      <p className="mt-0.5 truncate text-[0.68rem] text-[var(--sea-ink-soft)]">
                        Cc {message.cc.map(addressText).join(", ")}
                      </p>
                    ) : null}
                  </div>
                  <time className="shrink-0 text-[0.65rem] font-bold text-[var(--sea-ink-soft)]">
                    {messageDate.format(new Date(message.activityAt))}
                  </time>
                </div>
              </header>

              <div className="px-4 py-5 sm:px-6 sm:py-6">
                <MessageBody
                  authorLabel={messageAuthor(message)}
                  hasHtmlBody={message.hasHtmlBody}
                  htmlSrc={mailboxMessageHtmlHref(
                    mailboxId,
                    message.id,
                    selection
                  )}
                  onPreviewAccessFailure={onPreviewAccessFailure}
                  textBody={message.textBody}
                />

                {message.attachments.length > 0 ? (
                  <div className="mt-6 border-t border-[var(--line)] pt-4">
                    <p className="flex items-center gap-2 text-[0.65rem] font-extrabold tracking-[0.12em] text-[var(--sea-ink-soft)] uppercase">
                      <Paperclip size={13} /> Attachments
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {message.attachments.map((attachment) => (
                        <div
                          key={attachment.id}
                          className="flex max-w-full items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--foam)] px-3.5 py-2.5"
                        >
                          <div className="min-w-0">
                            <p className="max-w-64 truncate text-xs font-extrabold">
                              {attachment.fileName}
                            </p>
                            <p className="mt-0.5 text-[0.62rem] text-[var(--sea-ink-soft)]">
                              {attachment.mimeType} ·{" "}
                              {byteSize(attachment.size)}
                            </p>
                          </div>
                          {message.direction === "inbound" &&
                          attachment.disposition === "attachment" ? (
                            <a
                              aria-label={`Download ${attachment.fileName}`}
                              className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-[var(--line)] bg-white text-[var(--sea-ink)] no-underline hover:bg-[var(--sand)]"
                              download
                              href={mailboxInboundAttachmentHref(
                                mailboxId,
                                message.id,
                                attachment.id,
                                selection
                              )}
                            >
                              <Download aria-hidden="true" size={15} />
                            </a>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </article>
          ))}

          {data.hasMore ? (
            <p className="rounded-xl border border-[var(--line)] bg-[var(--sand)]/55 px-4 py-3 text-center text-xs font-bold text-[var(--sea-ink-soft)]">
              Earlier messages are available in this conversation.
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

export function NoThreadSelected() {
  return (
    <section
      aria-label="Conversation"
      className="hidden min-h-0 flex-1 items-center justify-center bg-white/58 px-8 text-center text-[var(--sea-ink-soft)] lg:flex"
    >
      <div>
        <MailOpen className="mx-auto opacity-25" size={42} />
        <p className="mt-4 text-sm font-extrabold text-[var(--sea-ink)]">
          Choose a message
        </p>
        <p className="mt-1 max-w-xs text-xs leading-5">
          Open a conversation while keeping your folder or label in view.
        </p>
      </div>
    </section>
  );
}
