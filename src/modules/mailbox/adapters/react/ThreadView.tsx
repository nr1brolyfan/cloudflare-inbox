import type * as Schema from "effect/Schema";
import {
  ArrowLeft,
  Download,
  Ellipsis,
  MailOpen,
  Paperclip,
  Reply,
} from "lucide-react";
import { useState } from "react";

import type { MailboxThreadResult } from "#/modules/mailbox/application/MailboxMessageReading";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

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
const ignoreReply = (_messageId: string) => null;

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

interface QuotedTextLine {
  readonly depth: number;
  readonly text: string;
}

const quoteLine = (line: string): QuotedTextLine => {
  const match = /^\s*(?<markers>(?:>\s*)+)(?<content>.*)$/u.exec(line)?.groups;
  return match === undefined
    ? { depth: 0, text: line }
    : {
        depth: match?.["markers"]?.match(/>/gu)?.length ?? 1,
        text: match?.["content"] ?? "",
      };
};

const splitPlainTextQuote = (text: string) => {
  const lines = text.split("\n");
  let quoteTailEnd = lines.length - 1;
  while (quoteTailEnd >= 0 && lines[quoteTailEnd]?.trim() === "") {
    quoteTailEnd -= 1;
  }
  if (quoteTailEnd < 0 || !/^\s*>/u.test(lines[quoteTailEnd] ?? "")) {
    return { authoredText: text, quotedLines: [] };
  }

  let firstQuotedLine = quoteTailEnd;
  while (
    firstQuotedLine > 0 &&
    (lines[firstQuotedLine - 1]?.trim() === "" ||
      /^\s*>/u.test(lines[firstQuotedLine - 1] ?? ""))
  ) {
    firstQuotedLine -= 1;
  }

  let quoteStart = firstQuotedLine;
  let attributionEnd = firstQuotedLine - 1;
  while (attributionEnd >= 0 && lines[attributionEnd]?.trim() === "") {
    attributionEnd -= 1;
  }
  let attributionStart = attributionEnd;
  while (attributionStart > 0 && lines[attributionStart - 1]?.trim() !== "") {
    attributionStart -= 1;
  }
  const attribution = lines
    .slice(attributionStart, attributionEnd + 1)
    .join(" ")
    .trim();
  if (/(?:wrote|napisał|napisała):\s*$/iu.test(attribution)) {
    quoteStart = attributionStart;
  }

  return {
    authoredText: lines.slice(0, quoteStart).join("\n").trimEnd(),
    quotedLines: lines.slice(quoteStart).map(quoteLine),
  };
};

function QuotedPlainText({
  lines,
}: {
  readonly lines: readonly QuotedTextLine[];
}) {
  return (
    <div className="mt-2 overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--control-bg)] px-3 py-3 text-[var(--sea-ink-soft)]">
      {lines.map((line, index) => {
        const visibleDepth = Math.min(line.depth, 5);
        return (
          <div
            // Quote bodies have no stable line identifiers and duplicate lines are common.
            // oxlint-disable-next-line react/no-array-index-key
            key={index}
            data-quote-depth={line.depth}
            className={`flex min-h-6 text-sm leading-6 ${line.depth === 0 ? "italic" : ""}`}
          >
            {visibleDepth > 0 ? (
              <span aria-hidden="true" className="mr-2 flex shrink-0 gap-1.5">
                {Array.from({ length: visibleDepth }, (_, depth) => (
                  <span
                    // The position is the identity of each visual nesting guide.
                    // oxlint-disable-next-line react/no-array-index-key
                    key={depth}
                    className="w-0.5 rounded-full bg-[var(--lagoon-deep)]/35"
                  />
                ))}
              </span>
            ) : null}
            {line.depth > visibleDepth ? (
              <span className="mr-2 shrink-0 text-[0.65rem] font-bold text-[var(--sea-ink-soft)]/70">
                +{line.depth - visibleDepth}
              </span>
            ) : null}
            <span className="min-w-0 break-words whitespace-pre-wrap">
              {line.text || "\u00A0"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

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
  const [showQuotedText, setShowQuotedText] = useState(false);
  const plainText =
    textBody === undefined ? undefined : splitPlainTextQuote(textBody);

  return (
    <>
      {textBody !== undefined && hasHtmlBody ? (
        <fieldset className="mb-4 flex gap-2 border-0 p-0">
          <legend className="sr-only">Message body format</legend>
          <Button
            type="button"
            variant="ghost"
            aria-pressed={!showHtml}
            onClick={() => setShowHtml(false)}
            className="h-auto rounded-lg border border-[var(--line)] bg-[var(--control-bg)] px-3 py-1.5 text-xs font-bold text-[var(--sea-ink)] aria-pressed:bg-[var(--sand)] aria-pressed:text-[var(--palm)]"
          >
            Plain text
          </Button>
          <Button
            type="button"
            variant="ghost"
            aria-pressed={showHtml}
            onClick={() => setShowHtml(true)}
            className="h-auto rounded-lg border border-[var(--line)] bg-[var(--control-bg)] px-3 py-1.5 text-xs font-bold text-[var(--sea-ink)] aria-pressed:bg-[var(--sand)] aria-pressed:text-[var(--palm)]"
          >
            Sandboxed HTML
          </Button>
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
      ) : plainText === undefined ? null : (
        <div>
          {plainText.authoredText === "" ? null : (
            <pre className="font-sans text-sm leading-7 whitespace-pre-wrap text-[var(--sea-ink)]">
              {plainText.authoredText}
            </pre>
          )}
          {plainText.quotedLines.length > 0 ? (
            <div className={plainText.authoredText === "" ? "" : "mt-3"}>
              <Button
                type="button"
                variant="ghost"
                aria-expanded={showQuotedText}
                aria-label={
                  showQuotedText ? "Hide quoted text" : "Show quoted text"
                }
                onClick={() => setShowQuotedText((current) => !current)}
                className="flex h-7 min-w-10 items-center justify-center rounded-lg border border-[var(--line)] bg-[var(--control-bg)] px-2 text-[var(--sea-ink-soft)] hover:bg-[var(--surface-strong)] hover:text-[var(--sea-ink)]"
              >
                <Ellipsis aria-hidden="true" size={18} />
              </Button>
              {showQuotedText ? (
                <QuotedPlainText lines={plainText.quotedLines} />
              ) : null}
            </div>
          ) : null}
        </div>
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
  onReply = ignoreReply,
  replyError,
  replyingMessageId,
  selection,
}: {
  readonly data: ThreadData;
  readonly filters: MailboxMessageQueryState;
  readonly mailboxId: string;
  readonly onClose: () => void;
  readonly onPreviewAccessFailure?: (status: 401 | 403) => void;
  readonly onReply?: (messageId: string) => void;
  readonly replyError?: {
    readonly messageId: string;
    readonly retryable: boolean;
  };
  readonly replyingMessageId?: string;
  readonly selection: MailboxViewSelection;
}) {
  return (
    <section
      aria-label="Conversation"
      className="min-h-0 flex-1 bg-[var(--workspace-bg)]"
    >
      <header className="border-b border-[var(--line)] bg-[var(--control-bg)] px-4 py-4 sm:px-7 sm:py-5">
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
            className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-[var(--line)] bg-[var(--control-bg)] text-[var(--sea-ink-soft)] no-underline hover:bg-[var(--surface-strong)] hover:text-[var(--sea-ink)] lg:hidden"
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
          {data.messages.map((message) => {
            const outbound = message.direction === "outbound";
            return (
              <article
                key={message.id}
                data-direction={message.direction}
                className={`overflow-hidden rounded-2xl border shadow-[0_10px_30px_rgba(23,58,64,0.06)] ${
                  outbound
                    ? "ml-5 border-[var(--lagoon-deep)]/45 bg-[var(--foam)] sm:ml-12"
                    : "mr-5 border-[var(--line)] bg-[var(--surface-strong)] sm:mr-12"
                }`}
              >
                <header
                  className={`border-b px-4 py-4 sm:px-5 ${outbound ? "border-[var(--lagoon-deep)]/25" : "border-[var(--line)]"}`}
                >
                  <div className="flex items-start gap-3">
                    <span
                      className={`flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-extrabold ${outbound ? "bg-[var(--lagoon-deep)] text-white" : "bg-[var(--sand)] text-[var(--palm)]"}`}
                    >
                      {outbound
                        ? "YOU"
                        : messageAuthor(message).slice(0, 2).toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-extrabold">
                        {outbound ? "You" : messageAuthor(message)}
                      </p>
                      <p className="mt-1 truncate text-[0.68rem] text-[var(--sea-ink-soft)]">
                        To{" "}
                        {message.to.map(addressText).join(", ") ||
                          "undisclosed"}
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
                                className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-[var(--line)] bg-[var(--surface-strong)] text-[var(--sea-ink)] no-underline hover:bg-[var(--sand)]"
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
                  {message.direction === "inbound" && message.replyEligible ? (
                    <div className="mt-5 flex items-center gap-3 border-t border-[var(--line)] pt-4">
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={replyingMessageId !== undefined}
                        onClick={() => onReply(message.id)}
                        className="inline-flex h-auto items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--control-bg)] px-3.5 py-2 text-xs font-extrabold text-[var(--sea-ink)] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Reply aria-hidden="true" size={14} />
                        {replyingMessageId === message.id
                          ? "Creating reply..."
                          : replyError?.messageId === message.id &&
                              replyError.retryable
                            ? "Retry reply"
                            : "Reply"}
                      </Button>
                      {replyError?.messageId === message.id ? (
                        <Alert className="block w-auto rounded-none border-0 bg-transparent p-0 text-xs font-bold text-[var(--danger-fg)]">
                          Reply draft could not be created.
                        </Alert>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </article>
            );
          })}

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
      className="hidden min-h-0 flex-1 items-center justify-center bg-[var(--workspace-bg)] px-8 text-center text-[var(--sea-ink-soft)] lg:flex"
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
