/* oxlint-disable jsx-a11y/prefer-tag-over-role -- Editable ARIA comboboxes require input, listbox, and option roles. */
import * as Schema from "effect/Schema";
import {
  CircleAlert,
  FileText,
  LoaderCircle,
  Paperclip,
  RotateCcw,
  Send,
  X,
} from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import type { DraftEditorFields } from "#/modules/mailbox/adapters/browser/DraftSessionStorage";
import { DraftEditorContent } from "#/modules/mailbox/application/MailboxDraftEditing";
import type { DraftAttachmentReservation } from "#/modules/mailbox/domain/MailboxDraftAttachment";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type EditorContent = Schema.Schema.Type<typeof DraftEditorContent>;
export interface DraftEditorSnapshot {
  readonly content: EditorContent;
  readonly fields: DraftEditorFields;
}

export const draftSendErrorText = (status: number, backendMessage?: string) => {
  if (status === 400) {
    return backendMessage === "Message is too large for the email provider"
      ? "This message is too large for the email provider. Remove attachments or shorten the content."
      : "Add at least one recipient and save the draft before sending.";
  }
  if (status === 403) {
    return "You do not have permission to send from this mailbox.";
  }
  if (status === 404) {
    return "This draft no longer exists.";
  }
  return status === 409
    ? "This draft changed elsewhere. Close and reopen it before sending."
    : "The send result could not be confirmed. Retry safely.";
};

interface DraftEditorProps {
  readonly attachments: readonly DraftAttachmentReservation[];
  readonly attachmentUploads: readonly DraftAttachmentUploadView[];
  readonly error?: string;
  readonly initial: EditorContent;
  readonly initialFields?: DraftEditorFields;
  readonly isNew: boolean;
  readonly isSendUncertain: boolean;
  readonly isSaving: boolean;
  readonly isSending: boolean;
  readonly loadRecipientSuggestions?: (
    query: string
  ) => Promise<readonly EditorContent["to"][number][]>;
  readonly onAttachFiles: (
    files: readonly File[],
    snapshot: DraftEditorSnapshot
  ) => void;
  readonly onAutosave: (snapshot: DraftEditorSnapshot) => void;
  readonly onChange: (fields: DraftEditorFields) => void;
  readonly onClose: (snapshot: DraftEditorSnapshot) => void;
  readonly onRetry?: () => void;
  readonly onDismissAttachmentUpload: (id: string) => void;
  readonly onRetryAttachmentUpload: (id: string) => void;
  readonly onSend: (snapshot: DraftEditorSnapshot) => void;
  readonly saveStatus: "error" | "idle" | "saved" | "saving" | "unsaved";
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

const recipientTokenRange = (value: string, cursor: number) => {
  let start = 0;
  let escaped = false;
  let inAddress = false;
  let inQuotes = false;
  const ranges: { readonly end: number; readonly start: number }[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === '"' && !escaped) {
      inQuotes = !inQuotes;
    } else if (character === "<" && !inQuotes) {
      inAddress = true;
    } else if (character === ">" && !inQuotes) {
      inAddress = false;
    }
    if (character === "," && !inQuotes && !inAddress) {
      ranges.push({ end: index, start });
      start = index + 1;
    }
    escaped = character === "\\" && !escaped;
  }
  ranges.push({ end: value.length, start });
  return (
    ranges.find((range) => cursor >= range.start && cursor <= range.end) ??
    ranges.at(-1) ?? { end: value.length, start: 0 }
  );
};

const suggestionIdentity = (address: string) => address.toLowerCase();

interface RecipientInputProps {
  readonly allValues: readonly string[];
  readonly autoFocus?: boolean;
  readonly disabled: boolean;
  readonly id: string;
  readonly label: string;
  readonly loadSuggestions?: DraftEditorProps["loadRecipientSuggestions"];
  readonly onChange: (value: string) => void;
  readonly placeholder?: string;
  readonly value: string;
}

function RecipientInput({
  allValues,
  autoFocus,
  disabled,
  id,
  label,
  loadSuggestions,
  onChange,
  placeholder,
  value,
}: RecipientInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const requestId = useRef(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<EditorContent["to"]>([]);
  const hasSuggestionLoader = loadSuggestions !== undefined;
  const listboxId = `${id}-suggestions`;
  const load = useEffectEvent(async (term: string, currentRequest: number) => {
    if (loadSuggestions === undefined) {
      return;
    }
    try {
      const entered = new Set(
        allValues
          .flatMap((item) => parseAddresses(item))
          .map((item) => suggestionIdentity(String(item.address ?? "")))
      );
      const result = await loadSuggestions(term);
      if (requestId.current !== currentRequest) {
        return;
      }
      setSuggestions(
        result.filter((item) => !entered.has(suggestionIdentity(item.address)))
      );
      setActiveIndex(0);
    } catch {
      if (requestId.current === currentRequest) {
        setSuggestions([]);
      }
    }
  });
  useEffect(() => {
    const term = query.trim();
    requestId.current += 1;
    const currentRequest = requestId.current;
    if (term.length < 2 || !hasSuggestionLoader) {
      return;
    }
    const timeout = window.setTimeout(
      () => void load(term, currentRequest),
      120
    );
    return () => window.clearTimeout(timeout);
  }, [query, hasSuggestionLoader]);

  const refreshQuery = (nextValue: string, cursor: number) => {
    const range = recipientTokenRange(nextValue, cursor);
    const nextQuery = nextValue.slice(range.start, range.end).trim();
    if (nextQuery.length < 2) {
      setSuggestions([]);
    }
    setQuery(nextQuery);
  };
  const closeSuggestions = () => {
    requestId.current += 1;
    setSuggestions([]);
    setQuery("");
  };
  const selectSuggestion = (suggestion: EditorContent["to"][number]) => {
    const input = inputRef.current;
    const cursor = input?.selectionStart ?? value.length;
    const range = recipientTokenRange(value, cursor);
    const formatted = formatAddresses([suggestion]);
    const prefix = value.slice(0, range.start);
    const suffix = value.slice(range.end);
    const leadingSpace = prefix.endsWith(",") ? " " : "";
    const trailing = suffix.startsWith(",") ? "" : ", ";
    const next = `${prefix}${leadingSpace}${formatted}${trailing}${suffix}`;
    const nextCursor =
      prefix.length + leadingSpace.length + formatted.length + trailing.length;
    onChange(next);
    closeSuggestions();
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(nextCursor, nextCursor);
    });
  };
  const expanded = suggestions.length > 0;

  return (
    <div className="relative grid border-b border-[var(--line)] px-4 py-3 sm:grid-cols-[4rem_1fr] sm:items-center">
      <label
        htmlFor={id}
        className="text-xs font-extrabold text-[var(--sea-ink-soft)]"
      >
        {label}
      </label>
      <Input
        ref={inputRef}
        id={id}
        role="combobox"
        aria-label={`${label} recipients`}
        aria-autocomplete="list"
        aria-controls={listboxId}
        aria-expanded={expanded}
        aria-activedescendant={
          expanded ? `${listboxId}-${activeIndex}` : undefined
        }
        autoFocus={autoFocus}
        disabled={disabled}
        value={value}
        onBlur={closeSuggestions}
        onChange={(event) => {
          const next = event.target.value;
          onChange(next);
          refreshQuery(next, event.target.selectionStart ?? next.length);
        }}
        onFocus={(event) =>
          refreshQuery(
            value,
            event.currentTarget.selectionStart ?? value.length
          )
        }
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && expanded) {
            event.preventDefault();
            setActiveIndex((index) => (index + 1) % suggestions.length);
          } else if (event.key === "ArrowUp" && expanded) {
            event.preventDefault();
            setActiveIndex(
              (index) => (index - 1 + suggestions.length) % suggestions.length
            );
          } else if (event.key === "Enter" && expanded) {
            event.preventDefault();
            selectSuggestion(suggestions[activeIndex] ?? suggestions[0]);
          } else if (event.key === "Escape") {
            closeSuggestions();
          }
        }}
        placeholder={placeholder}
        className="mt-1 h-auto min-w-0 rounded-none border-0 bg-transparent px-0 py-0 text-sm transition-none outline-none placeholder:text-[var(--sea-ink-soft)]/42 focus-visible:ring-0 disabled:bg-transparent disabled:opacity-60 sm:mt-0 dark:bg-transparent dark:disabled:bg-transparent"
      />
      {expanded ? (
        <div
          id={listboxId}
          role="listbox"
          aria-label={`${label} recipient suggestions`}
          className="absolute top-[calc(100%-0.25rem)] right-3 left-3 z-30 overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface-strong)] py-1 shadow-[0_16px_45px_rgba(23,58,64,0.18)] sm:left-[4.5rem]"
        >
          {suggestions.map((suggestion, index) => (
            <button
              id={`${listboxId}-${index}`}
              key={suggestion.address}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              className={`flex w-full items-center justify-between gap-4 px-3 py-2 text-left text-sm ${
                index === activeIndex
                  ? "bg-[var(--foam)]"
                  : "hover:bg-[var(--foam)]"
              }`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => selectSuggestion(suggestion)}
            >
              <span className="min-w-0 truncate font-bold">
                {suggestion.displayName ?? suggestion.address}
              </span>
              {suggestion.displayName === undefined ? null : (
                <span className="min-w-0 truncate text-xs text-[var(--sea-ink-soft)]">
                  {suggestion.address}
                </span>
              )}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export const draftEditorFieldsFromContent = (
  content: EditorContent
): DraftEditorFields => ({
  bcc: formatAddresses(content.bcc),
  cc: formatAddresses(content.cc),
  subject: content.subject,
  textBody: content.textBody ?? "",
  to: formatAddresses(content.to),
});

const snapshotFromFields = (
  fields: DraftEditorFields
): DraftEditorSnapshot => ({
  content: Schema.decodeUnknownSync(DraftEditorContent)({
    bcc: parseAddresses(fields.bcc),
    cc: parseAddresses(fields.cc),
    subject: fields.subject,
    textBody: fields.textBody === "" ? undefined : fields.textBody,
    to: parseAddresses(fields.to),
  }),
  fields,
});

// oxlint-disable-next-line eslint/complexity -- Editor validation, lock state, and accessible upload controls share one form boundary.
export function DraftEditor({
  attachments,
  attachmentUploads,
  error,
  initial,
  initialFields,
  isNew,
  isSendUncertain,
  isSaving,
  isSending,
  loadRecipientSuggestions,
  onAttachFiles,
  onAutosave,
  onChange,
  onClose,
  onRetry,
  onDismissAttachmentUpload,
  onRetryAttachmentUpload,
  onSend,
  saveStatus,
}: DraftEditorProps) {
  const [fields, setFields] = useState(
    () => initialFields ?? draftEditorFieldsFromContent(initial)
  );
  const hasChanged = useRef(initialFields !== undefined);
  const [validationError, setValidationError] = useState<string>();
  const editorLocked =
    isSending || isSendUncertain || attachmentUploads.length > 0;
  const updateField = (change: Partial<DraftEditorFields>) => {
    const next = { ...fields, ...change };
    hasChanged.current = true;
    setFields(next);
    setValidationError(undefined);
    onChange(next);
  };
  const readSnapshot = () => {
    try {
      const snapshot = snapshotFromFields(fields);
      setValidationError(undefined);
      return snapshot;
    } catch {
      setValidationError(
        "Check the recipient addresses and keep the subject under 998 characters."
      );
      return null;
    }
  };
  const scheduleAutosave = useEffectEvent(
    (changedFields: DraftEditorFields) => {
      let snapshot: DraftEditorSnapshot;
      try {
        snapshot = snapshotFromFields(changedFields);
      } catch {
        return;
      }
      if (!hasChanged.current) {
        return;
      }
      const timeout = window.setTimeout(() => onAutosave(snapshot), 700);
      return () => window.clearTimeout(timeout);
    }
  );
  useEffect(() => scheduleAutosave(fields), [fields]);
  const visibleError = validationError ?? error;
  const statusText =
    saveStatus === "saving"
      ? "Saving..."
      : saveStatus === "saved"
        ? "Saved"
        : saveStatus === "error"
          ? "Save failed"
          : saveStatus === "unsaved"
            ? "Unsaved changes"
            : "Draft saves automatically";
  const hasRecipient =
    fields.to.trim() !== "" ||
    fields.cc.trim() !== "" ||
    fields.bcc.trim() !== "";

  return (
    <section className="flex h-full min-h-0 flex-col bg-[var(--workspace-bg)]">
      <div className="flex shrink-0 items-center justify-between border-b border-[var(--line)] px-4 py-3 sm:px-7 sm:py-4">
        <div>
          <p className="island-kicker">{isNew ? "New message" : "Draft"}</p>
          <p className="mt-1 text-xs text-[var(--sea-ink-soft)]">
            {statusText}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          aria-label="Close draft editor"
          disabled={editorLocked}
          onClick={() => {
            const snapshot = readSnapshot();
            if (snapshot !== null) {
              onClose(snapshot);
            }
          }}
          className="flex size-10 items-center justify-center rounded-xl border border-[var(--line)] bg-[var(--control-bg)] text-[var(--sea-ink-soft)] hover:bg-[var(--surface-strong)] disabled:opacity-55"
        >
          <X size={18} />
        </Button>
      </div>

      <form
        className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col overflow-y-auto px-4 py-4 sm:px-7 sm:py-6"
        onSubmit={(event) => {
          event.preventDefault();
          const snapshot = readSnapshot();
          if (snapshot !== null) {
            onSend(snapshot);
          }
        }}
      >
        <div className="overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface-strong)] shadow-[0_18px_50px_rgba(23,58,64,0.08)]">
          <RecipientInput
            allValues={[fields.to, fields.cc, fields.bcc]}
            autoFocus
            disabled={editorLocked}
            id="draft-to"
            label="To"
            loadSuggestions={loadRecipientSuggestions}
            onChange={(to) => updateField({ to })}
            placeholder="person@example.com, Team <team@example.com>"
            value={fields.to}
          />
          <RecipientInput
            allValues={[fields.to, fields.cc, fields.bcc]}
            disabled={editorLocked}
            id="draft-cc"
            label="Cc"
            loadSuggestions={loadRecipientSuggestions}
            onChange={(cc) => updateField({ cc })}
            value={fields.cc}
          />
          <RecipientInput
            allValues={[fields.to, fields.cc, fields.bcc]}
            disabled={editorLocked}
            id="draft-bcc"
            label="Bcc"
            loadSuggestions={loadRecipientSuggestions}
            onChange={(bcc) => updateField({ bcc })}
            value={fields.bcc}
          />
          <label
            htmlFor="draft-subject"
            className="grid px-4 py-3 sm:grid-cols-[4rem_1fr] sm:items-center"
          >
            <span className="text-xs font-extrabold text-[var(--sea-ink-soft)]">
              Subject
            </span>
            <Input
              id="draft-subject"
              aria-label="Subject"
              disabled={editorLocked}
              maxLength={998}
              value={fields.subject}
              onChange={(event) => updateField({ subject: event.target.value })}
              placeholder="What is this message about?"
              className="mt-1 h-auto min-w-0 rounded-none border-0 bg-transparent px-0 py-0 text-sm font-bold transition-none outline-none placeholder:font-normal placeholder:text-[var(--sea-ink-soft)]/42 focus-visible:ring-0 disabled:bg-transparent disabled:opacity-60 sm:mt-0 dark:bg-transparent dark:disabled:bg-transparent"
            />
          </label>
        </div>

        <label
          htmlFor="draft-message"
          className="mt-4 flex min-h-52 flex-1 flex-col rounded-2xl border border-[var(--line)] bg-[var(--surface-strong)] p-4 shadow-[0_18px_50px_rgba(23,58,64,0.08)] sm:p-6"
        >
          <span className="sr-only">Message</span>
          <Textarea
            id="draft-message"
            aria-label="Message"
            disabled={editorLocked}
            maxLength={1_000_000}
            value={fields.textBody}
            onChange={(event) => updateField({ textBody: event.target.value })}
            placeholder="Write your message..."
            className="min-h-44 flex-1 resize-none rounded-none border-0 bg-transparent p-0 text-sm leading-7 transition-none outline-none placeholder:text-[var(--sea-ink-soft)]/42 focus-visible:ring-0 disabled:bg-transparent disabled:opacity-60 sm:text-base dark:bg-transparent dark:disabled:bg-transparent"
          />
        </label>

        <section
          aria-label="Draft attachments"
          className="mt-4 shrink-0 rounded-2xl border border-[var(--line)] bg-[var(--control-bg)] p-4 sm:p-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-extrabold">Attachments</p>
              <p className="mt-1 text-[0.68rem] text-[var(--sea-ink-soft)]">
                Up to 10 files, 10 MB each and 20 MB total.
              </p>
            </div>
            <label
              htmlFor="draft-attachments"
              className={`inline-flex items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--surface-strong)] px-3.5 py-2 text-xs font-extrabold ${
                editorLocked
                  ? "cursor-not-allowed opacity-45"
                  : "cursor-pointer hover:bg-[var(--foam)]"
              }`}
            >
              <Paperclip size={15} /> Add files
              <Input
                id="draft-attachments"
                type="file"
                multiple
                aria-label="Add draft attachments"
                className="sr-only"
                disabled={editorLocked}
                onChange={(event) => {
                  const files = [...(event.target.files ?? [])];
                  event.target.value = "";
                  if (files.length > 0) {
                    const snapshot = readSnapshot();
                    if (snapshot !== null) {
                      onAttachFiles(files, snapshot);
                    }
                  }
                }}
              />
            </label>
          </div>
          {isNew || saveStatus !== "saved" ? (
            <p className="mt-3 text-[0.68rem] font-bold text-[var(--sea-ink-soft)]">
              Files will upload after the latest changes are saved.
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
                  className="rounded-xl border border-[var(--line)] bg-[var(--surface-strong)] px-3 py-2.5"
                >
                  <div className="flex items-center gap-3">
                    {upload.status === "failed" ? (
                      <CircleAlert
                        aria-hidden="true"
                        className="shrink-0 text-[var(--danger-fg)]"
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
                          <Button
                            type="button"
                            variant="ghost"
                            aria-label={`Retry ${upload.fileName} upload`}
                            onClick={() => onRetryAttachmentUpload(upload.id)}
                            className="h-auto rounded-lg px-2 py-1 text-[0.65rem] font-extrabold"
                          >
                            Retry
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          variant="ghost"
                          aria-label={`Dismiss ${upload.fileName} upload`}
                          onClick={() => onDismissAttachmentUpload(upload.id)}
                          className="flex size-7 items-center justify-center rounded-lg"
                        >
                          <X size={13} />
                        </Button>
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
              <Alert className="flex w-auto items-center gap-2 rounded-none border-0 bg-transparent p-0 text-xs font-bold text-[var(--danger-fg)]">
                <CircleAlert size={15} /> {visibleError}
              </Alert>
            )}
          </div>
          <div className="flex items-center justify-end gap-2">
            {onRetry === undefined ? null : (
              <Button
                type="button"
                variant="ghost"
                disabled={isSaving || isSending}
                onClick={onRetry}
                className="inline-flex h-auto items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--control-bg)] px-4 py-2.5 text-xs font-extrabold text-[var(--sea-ink)] disabled:opacity-55"
              >
                <RotateCcw size={15} /> Retry
              </Button>
            )}
            <Button
              type="submit"
              variant="ghost"
              disabled={editorLocked || !hasRecipient}
              className="inline-flex h-auto items-center gap-2 rounded-xl bg-[var(--palm)] px-5 py-2.5 text-xs font-extrabold text-[var(--bg-base)] shadow-[0_10px_26px_rgba(16,116,110,0.2)] disabled:opacity-45"
            >
              {isSending ? (
                <LoaderCircle className="animate-spin" size={15} />
              ) : (
                <Send size={15} />
              )}
              {isSending ? "Sending" : "Send"}
            </Button>
          </div>
        </div>
        {isSaving && !isSending ? (
          <p className="mt-2 shrink-0 text-right text-[0.68rem] font-bold text-[var(--sea-ink-soft)]">
            You can keep editing while this draft is saved.
          </p>
        ) : null}
      </form>
    </section>
  );
}
