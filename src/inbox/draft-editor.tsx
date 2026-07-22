import * as Schema from "effect/Schema";
import {
  CircleAlert,
  FileText,
  LoaderCircle,
  Paperclip,
  RotateCcw,
  Save,
  Send,
  X,
} from "lucide-react";
import { useState } from "react";

import { DraftEditorContent } from "#/modules/mailbox/application/MailboxDraftEditing";

import type { DraftAttachmentReservation } from "../mailboxes/draft-attachments";

type EditorContent = Schema.Schema.Type<typeof DraftEditorContent>;

interface DraftEditorProps {
  readonly attachments: readonly DraftAttachmentReservation[];
  readonly attachmentUploads: readonly DraftAttachmentUploadView[];
  readonly error?: string;
  readonly initial: EditorContent;
  readonly isNew: boolean;
  readonly isSaving: boolean;
  readonly isSending: boolean;
  readonly onAttachFiles: (files: readonly File[]) => void;
  readonly onClose: () => void;
  readonly onRetry?: () => void;
  readonly onDismissAttachmentUpload: (id: string) => void;
  readonly onRetryAttachmentUpload: (id: string) => void;
  readonly onSave: (content: EditorContent) => void;
  readonly onSend: () => void;
  readonly saved: boolean;
}

export interface DraftAttachmentUploadView {
  readonly error?: string;
  readonly fileName: string;
  readonly id: string;
  readonly progress: number;
  readonly retryable: boolean;
  readonly size: number;
  readonly status: "reserving" | "uploading" | "failed";
}

const formatBytes = (bytes: number) => {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const kibibytes = bytes / 1024;
  return kibibytes < 1024
    ? `${kibibytes.toFixed(1)} KB`
    : `${(kibibytes / 1024).toFixed(1)} MB`;
};

const formatAddresses = (addresses: EditorContent["to"]) =>
  addresses
    .map(({ address, displayName }) => {
      if (displayName === undefined) {
        return address;
      }
      const encodedName = /[,"]/u.test(displayName)
        ? `"${displayName.replaceAll('"', '\\"')}"`
        : displayName;
      return `${encodedName} <${address}>`;
    })
    .join(", ");

const parseAddress = (value: string) => {
  const named = value.match(/^(?<displayName>.*?)\s*<(?<address>[^<>]+)>$/u);
  if (named === null) {
    return { address: value };
  }
  const displayName = named.groups?.displayName
    ?.trim()
    .replaceAll(/^"|"$/gu, "")
    .replaceAll('\\"', '"');
  return {
    address: named.groups?.address?.trim(),
    displayName: displayName === "" ? undefined : displayName,
  };
};

const parseAddresses = (value: string) => {
  const parts: string[] = [];
  let current = "";
  let escaped = false;
  let inAddress = false;
  let inQuotes = false;
  for (const character of value) {
    if (character === '"' && !escaped) {
      inQuotes = !inQuotes;
    } else if (character === "<" && !inQuotes) {
      inAddress = true;
    } else if (character === ">" && !inQuotes) {
      inAddress = false;
    }
    if (character === "," && !inQuotes && !inAddress) {
      parts.push(current);
      current = "";
    } else {
      current += character;
    }
    escaped = character === "\\" && !escaped;
  }
  parts.push(current);
  return parts
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .map(parseAddress);
};

// oxlint-disable-next-line eslint/complexity -- Editor validation, lock state, and accessible upload controls share one form boundary.
export function DraftEditor({
  attachments,
  attachmentUploads,
  error,
  initial,
  isNew,
  isSaving,
  isSending,
  onAttachFiles,
  onClose,
  onRetry,
  onDismissAttachmentUpload,
  onRetryAttachmentUpload,
  onSave,
  onSend,
  saved,
}: DraftEditorProps) {
  const [to, setTo] = useState(() => formatAddresses(initial.to));
  const [cc, setCc] = useState(() => formatAddresses(initial.cc));
  const [bcc, setBcc] = useState(() => formatAddresses(initial.bcc));
  const [subject, setSubject] = useState<string>(initial.subject);
  const [textBody, setTextBody] = useState(initial.textBody ?? "");
  const [validationError, setValidationError] = useState<string>();
  const editorLocked =
    isSaving ||
    isSending ||
    onRetry !== undefined ||
    attachmentUploads.length > 0;
  const dirty =
    to !== formatAddresses(initial.to) ||
    cc !== formatAddresses(initial.cc) ||
    bcc !== formatAddresses(initial.bcc) ||
    subject !== initial.subject ||
    textBody !== (initial.textBody ?? "");
  const hasRecipient =
    initial.to.length + initial.cc.length + initial.bcc.length > 0;
  const canSend = !isNew && !dirty && !editorLocked && hasRecipient;

  const submit = () => {
    try {
      const content = Schema.decodeUnknownSync(DraftEditorContent)({
        bcc: parseAddresses(bcc),
        cc: parseAddresses(cc),
        subject,
        textBody: textBody === "" ? undefined : textBody,
        to: parseAddresses(to),
      });
      setValidationError(undefined);
      onSave(content);
    } catch {
      setValidationError(
        "Check the recipient addresses and keep the subject under 998 characters."
      );
    }
  };
  const visibleError = validationError ?? error;

  return (
    <section className="flex h-full min-h-0 flex-col bg-[linear-gradient(145deg,rgba(243,250,245,0.92),rgba(255,255,255,0.72))]">
      <div className="flex shrink-0 items-center justify-between border-b border-[var(--line)] px-4 py-3 sm:px-7 sm:py-4">
        <div>
          <p className="island-kicker">{isNew ? "New message" : "Draft"}</p>
          <p className="mt-1 text-xs text-[var(--sea-ink-soft)]">
            {saved && !dirty
              ? "Saved at the edge"
              : "Changes are saved only when you choose Save"}
          </p>
        </div>
        <button
          type="button"
          aria-label="Close draft editor"
          disabled={editorLocked}
          onClick={onClose}
          className="flex size-10 items-center justify-center rounded-xl border border-[var(--line)] bg-white/70 text-[var(--sea-ink-soft)] hover:bg-white disabled:opacity-55"
        >
          <X size={18} />
        </button>
      </div>

      <form
        className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col overflow-y-auto px-4 py-4 sm:px-7 sm:py-6"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="overflow-hidden rounded-2xl border border-[var(--line)] bg-white/84 shadow-[0_18px_50px_rgba(23,58,64,0.08)]">
          <label className="grid border-b border-[var(--line)] px-4 py-3 sm:grid-cols-[4rem_1fr] sm:items-center">
            <span className="text-xs font-extrabold text-[var(--sea-ink-soft)]">
              To
            </span>
            <input
              aria-label="To recipients"
              autoFocus
              disabled={editorLocked}
              value={to}
              onChange={(event) => setTo(event.target.value)}
              placeholder="person@example.com, Team <team@example.com>"
              className="mt-1 min-w-0 border-0 bg-transparent text-sm outline-none placeholder:text-[var(--sea-ink-soft)]/42 disabled:opacity-60 sm:mt-0"
            />
          </label>
          <label className="grid border-b border-[var(--line)] px-4 py-3 sm:grid-cols-[4rem_1fr] sm:items-center">
            <span className="text-xs font-extrabold text-[var(--sea-ink-soft)]">
              Cc
            </span>
            <input
              aria-label="Cc recipients"
              disabled={editorLocked}
              value={cc}
              onChange={(event) => setCc(event.target.value)}
              className="mt-1 min-w-0 border-0 bg-transparent text-sm outline-none disabled:opacity-60 sm:mt-0"
            />
          </label>
          <label className="grid border-b border-[var(--line)] px-4 py-3 sm:grid-cols-[4rem_1fr] sm:items-center">
            <span className="text-xs font-extrabold text-[var(--sea-ink-soft)]">
              Bcc
            </span>
            <input
              aria-label="Bcc recipients"
              disabled={editorLocked}
              value={bcc}
              onChange={(event) => setBcc(event.target.value)}
              className="mt-1 min-w-0 border-0 bg-transparent text-sm outline-none disabled:opacity-60 sm:mt-0"
            />
          </label>
          <label className="grid px-4 py-3 sm:grid-cols-[4rem_1fr] sm:items-center">
            <span className="text-xs font-extrabold text-[var(--sea-ink-soft)]">
              Subject
            </span>
            <input
              aria-label="Subject"
              disabled={editorLocked}
              maxLength={998}
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              placeholder="What is this message about?"
              className="mt-1 min-w-0 border-0 bg-transparent text-sm font-bold outline-none placeholder:font-normal placeholder:text-[var(--sea-ink-soft)]/42 disabled:opacity-60 sm:mt-0"
            />
          </label>
        </div>

        <label className="mt-4 flex min-h-52 flex-1 flex-col rounded-2xl border border-[var(--line)] bg-white/84 p-4 shadow-[0_18px_50px_rgba(23,58,64,0.08)] sm:p-6">
          <span className="sr-only">Message</span>
          <textarea
            aria-label="Message"
            disabled={editorLocked}
            maxLength={1_000_000}
            value={textBody}
            onChange={(event) => setTextBody(event.target.value)}
            placeholder="Write your message..."
            className="min-h-44 flex-1 resize-none border-0 bg-transparent text-sm leading-7 outline-none placeholder:text-[var(--sea-ink-soft)]/42 disabled:opacity-60 sm:text-base"
          />
        </label>

        <section
          aria-label="Draft attachments"
          className="mt-4 shrink-0 rounded-2xl border border-[var(--line)] bg-white/72 p-4 sm:p-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-extrabold">Attachments</p>
              <p className="mt-1 text-[0.68rem] text-[var(--sea-ink-soft)]">
                Up to 10 files, 10 MB each and 20 MB total.
              </p>
            </div>
            <label
              className={`inline-flex items-center gap-2 rounded-xl border border-[var(--line)] bg-white px-3.5 py-2 text-xs font-extrabold ${
                isNew || dirty || editorLocked
                  ? "cursor-not-allowed opacity-45"
                  : "cursor-pointer hover:bg-[var(--foam)]"
              }`}
            >
              <Paperclip size={15} /> Add files
              <input
                type="file"
                multiple
                aria-label="Add draft attachments"
                className="sr-only"
                disabled={isNew || dirty || editorLocked}
                onChange={(event) => {
                  const files = [...(event.target.files ?? [])];
                  event.target.value = "";
                  if (files.length > 0) {
                    onAttachFiles(files);
                  }
                }}
              />
            </label>
          </div>
          {isNew || dirty ? (
            <p className="mt-3 text-[0.68rem] font-bold text-[var(--sea-ink-soft)]">
              {isNew
                ? "Save this draft before attaching files."
                : "Save text changes before attaching files."}
            </p>
          ) : null}
          {attachments.length === 0 && attachmentUploads.length === 0 ? null : (
            <ul aria-live="polite" className="mt-4 space-y-2">
              {attachments.map((attachment) => (
                <li
                  key={attachment.id}
                  className="flex items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--foam)] px-3 py-2.5"
                >
                  <FileText
                    aria-hidden="true"
                    className="shrink-0 text-[var(--palm)]"
                    size={17}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-extrabold">
                      {attachment.fileName}
                    </span>
                    <span className="block text-[0.65rem] text-[var(--sea-ink-soft)]">
                      {formatBytes(attachment.size)} · Uploaded
                    </span>
                  </span>
                </li>
              ))}
              {attachmentUploads.map((upload) => (
                <li
                  key={upload.id}
                  className="rounded-xl border border-[var(--line)] bg-white px-3 py-2.5"
                >
                  <div className="flex items-center gap-3">
                    {upload.status === "failed" ? (
                      <CircleAlert
                        aria-hidden="true"
                        className="shrink-0 text-red-700"
                        size={17}
                      />
                    ) : (
                      <LoaderCircle
                        aria-hidden="true"
                        className="shrink-0 animate-spin text-[var(--palm)]"
                        size={17}
                      />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-extrabold">
                        {upload.fileName}
                      </span>
                      <span
                        role={upload.status === "failed" ? "alert" : "status"}
                        className="block text-[0.65rem] text-[var(--sea-ink-soft)]"
                      >
                        {upload.error ??
                          (upload.status === "reserving"
                            ? "Reserving secure upload"
                            : `Uploading ${upload.progress}%`)}
                      </span>
                    </span>
                    {upload.status === "failed" ? (
                      <span className="flex items-center gap-1">
                        {upload.retryable ? (
                          <button
                            type="button"
                            aria-label={`Retry ${upload.fileName} upload`}
                            onClick={() => onRetryAttachmentUpload(upload.id)}
                            className="rounded-lg px-2 py-1 text-[0.65rem] font-extrabold"
                          >
                            Retry
                          </button>
                        ) : null}
                        <button
                          type="button"
                          aria-label={`Dismiss ${upload.fileName} upload`}
                          onClick={() => onDismissAttachmentUpload(upload.id)}
                          className="flex size-7 items-center justify-center rounded-lg"
                        >
                          <X size={13} />
                        </button>
                      </span>
                    ) : null}
                  </div>
                  {upload.status === "uploading" ? (
                    <progress
                      aria-label={`${upload.fileName} upload progress`}
                      max={100}
                      value={upload.progress}
                      className="mt-2 block h-1.5 w-full overflow-hidden rounded-full accent-[var(--lagoon-deep)]"
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="mt-4 flex shrink-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div aria-live="polite" className="min-h-5">
            {visibleError === undefined ? null : (
              <p
                role="alert"
                className="flex items-center gap-2 text-xs font-bold text-red-700"
              >
                <CircleAlert size={15} /> {visibleError}
              </p>
            )}
          </div>
          <div className="flex items-center justify-end gap-2">
            {onRetry === undefined ? null : (
              <button
                type="button"
                disabled={isSaving || isSending}
                onClick={onRetry}
                className="inline-flex items-center gap-2 rounded-xl border border-[var(--line)] bg-white px-4 py-2.5 text-xs font-extrabold disabled:opacity-55"
              >
                <RotateCcw size={15} /> Retry
              </button>
            )}
            <button
              type="submit"
              disabled={editorLocked}
              className="inline-flex items-center gap-2 rounded-xl bg-[var(--sea-ink)] px-5 py-2.5 text-xs font-extrabold text-white shadow-[0_10px_26px_rgba(23,58,64,0.18)] disabled:opacity-55"
            >
              {isSaving ? (
                <LoaderCircle className="animate-spin" size={15} />
              ) : (
                <Save size={15} />
              )}
              {isSaving ? "Saving" : "Save draft"}
            </button>
            <button
              type="button"
              disabled={!canSend}
              onClick={onSend}
              className="inline-flex items-center gap-2 rounded-xl bg-[var(--lagoon-deep)] px-5 py-2.5 text-xs font-extrabold text-white shadow-[0_10px_26px_rgba(16,116,110,0.2)] disabled:opacity-45"
            >
              {isSending ? (
                <LoaderCircle className="animate-spin" size={15} />
              ) : (
                <Send size={15} />
              )}
              {isSending ? "Sending" : "Send"}
            </button>
          </div>
        </div>
        {canSend ? null : (
          <p className="mt-2 shrink-0 text-right text-[0.68rem] font-bold text-[var(--sea-ink-soft)]">
            {isNew || dirty
              ? "Save before sending."
              : hasRecipient
                ? "Sending is unavailable while another draft action is pending."
                : "Add at least one recipient, then save before sending."}
          </p>
        )}
      </form>
    </section>
  );
}
