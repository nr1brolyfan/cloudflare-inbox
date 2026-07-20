import * as Schema from "effect/Schema";
import { CircleAlert, LoaderCircle, RotateCcw, Save, X } from "lucide-react";
import { useState } from "react";

import { DraftEditorContent } from "../mailboxes/draft-editing";

type EditorContent = Schema.Schema.Type<typeof DraftEditorContent>;

interface DraftEditorProps {
  readonly error?: string;
  readonly initial: EditorContent;
  readonly isNew: boolean;
  readonly isSaving: boolean;
  readonly onClose: () => void;
  readonly onRetry?: () => void;
  readonly onSave: (content: EditorContent) => void;
  readonly saved: boolean;
}

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

export function DraftEditor({
  error,
  initial,
  isNew,
  isSaving,
  onClose,
  onRetry,
  onSave,
  saved,
}: DraftEditorProps) {
  const [to, setTo] = useState(() => formatAddresses(initial.to));
  const [cc, setCc] = useState(() => formatAddresses(initial.cc));
  const [bcc, setBcc] = useState(() => formatAddresses(initial.bcc));
  const [subject, setSubject] = useState<string>(initial.subject);
  const [textBody, setTextBody] = useState(initial.textBody ?? "");
  const [validationError, setValidationError] = useState<string>();
  const editorLocked = isSaving || onRetry !== undefined;
  const dirty =
    to !== formatAddresses(initial.to) ||
    cc !== formatAddresses(initial.cc) ||
    bcc !== formatAddresses(initial.bcc) ||
    subject !== initial.subject ||
    textBody !== (initial.textBody ?? "");

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
          onClick={onClose}
          className="flex size-10 items-center justify-center rounded-xl border border-[var(--line)] bg-white/70 text-[var(--sea-ink-soft)] hover:bg-white"
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
                disabled={isSaving}
                onClick={onRetry}
                className="inline-flex items-center gap-2 rounded-xl border border-[var(--line)] bg-white px-4 py-2.5 text-xs font-extrabold disabled:opacity-55"
              >
                <RotateCcw size={15} /> Retry
              </button>
            )}
            <button
              type="submit"
              disabled={isSaving || onRetry !== undefined}
              className="inline-flex items-center gap-2 rounded-xl bg-[var(--sea-ink)] px-5 py-2.5 text-xs font-extrabold text-white shadow-[0_10px_26px_rgba(23,58,64,0.18)] disabled:opacity-55"
            >
              {isSaving ? (
                <LoaderCircle className="animate-spin" size={15} />
              ) : (
                <Save size={15} />
              )}
              {isSaving ? "Saving" : "Save draft"}
            </button>
          </div>
        </div>
      </form>
    </section>
  );
}
