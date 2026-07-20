import * as Schema from "effect/Schema";
import { CircleAlert, LoaderCircle, RotateCcw, Undo2, X } from "lucide-react";
import { useEffect, useState } from "react";

import { UndoMailboxSendCommand } from "../mailboxes/outbound-sending";

type UndoCommand = Schema.Schema.Type<typeof UndoMailboxSendCommand>;

type UndoResult =
  | { readonly ok: true; readonly delivery: { readonly status: string } }
  | { readonly ok: false; readonly status: number };

export interface UndoSendNoticeValue {
  readonly mailboxId: string;
  readonly outboundDeliveryId: string;
  readonly sendAt: number;
  readonly serverNow: number;
  readonly version: number;
}

interface UndoSendNoticeProps {
  readonly notice: UndoSendNoticeValue;
  readonly onClose: () => void;
  readonly onMailboxChanged: () => void;
  readonly onUnauthorized: () => void;
  readonly undo: (command: UndoCommand) => Promise<UndoResult>;
}

const decodeUndoCommand = Schema.decodeUnknownSync(UndoMailboxSendCommand);

export function UndoSendNotice({
  notice,
  onClose,
  onMailboxChanged,
  onUnauthorized,
  undo,
}: UndoSendNoticeProps) {
  const [command] = useState(() =>
    decodeUndoCommand({
      expectedVersion: notice.version,
      mailboxId: notice.mailboxId,
      operationId: crypto.randomUUID(),
      outboundDeliveryId: notice.outboundDeliveryId,
    })
  );
  const [displayDeadline] = useState(
    () => Date.now() + Math.max(0, notice.sendAt - notice.serverNow)
  );
  const [remainingMillis, setRemainingMillis] = useState(() =>
    Math.max(0, notice.sendAt - notice.serverNow)
  );
  const [state, setState] = useState<
    "ready" | "pending" | "retry" | "expired" | "success" | "failed"
  >("ready");

  useEffect(() => {
    if (displayDeadline <= Date.now()) {
      return;
    }
    const timer = window.setInterval(() => {
      setRemainingMillis(Math.max(0, displayDeadline - Date.now()));
    }, 250);
    return () => window.clearInterval(timer);
  }, [displayDeadline]);

  const runUndo = async () => {
    setState("pending");
    try {
      const result = await undo(command);
      if (result.ok) {
        setState("success");
        onMailboxChanged();
        return;
      }
      if (result.status === 401) {
        setState("failed");
        onUnauthorized();
        return;
      }
      if (result.status === 409) {
        setState("expired");
        onMailboxChanged();
        return;
      }
      setState(
        result.status >= 500 && result.status < 600 ? "retry" : "failed"
      );
    } catch {
      setState("retry");
    }
  };

  const secondsRemaining = Math.ceil(remainingMillis / 1000);
  const detail =
    state === "success"
      ? "Send undone"
      : state === "expired"
        ? "The undo window has expired."
        : state === "pending"
          ? "Undoing send..."
          : state === "retry"
            ? "Could not confirm the undo. Retry uses the same request."
            : state === "failed"
              ? "This send could not be undone."
              : remainingMillis === 0
                ? "The undo window may have closed. The server will confirm."
                : `Sending in ${secondsRemaining} ${secondsRemaining === 1 ? "second" : "seconds"}.`;

  return (
    <output
      aria-atomic="true"
      aria-live="polite"
      className="fixed inset-x-0 bottom-0 z-40 px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:right-5 sm:left-auto sm:w-[25rem] sm:px-0 sm:pb-5"
    >
      <div className="flex items-center gap-3 rounded-2xl border border-[var(--line)] bg-[var(--sea-ink)] p-3 text-white shadow-[0_20px_60px_rgba(10,35,40,0.3)] sm:p-4">
        {state === "retry" || state === "expired" || state === "failed" ? (
          <CircleAlert aria-hidden="true" className="shrink-0" size={19} />
        ) : (
          <Undo2 aria-hidden="true" className="shrink-0" size={19} />
        )}
        <p className="min-w-0 flex-1 text-sm font-bold">{detail}</p>
        {state === "ready" || state === "retry" || state === "pending" ? (
          <button
            type="button"
            disabled={state === "pending"}
            onClick={() => void runUndo()}
            className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl bg-white px-4 text-xs font-extrabold text-[var(--sea-ink)] disabled:opacity-60"
          >
            {state === "pending" ? (
              <LoaderCircle
                aria-hidden="true"
                className="animate-spin"
                size={15}
              />
            ) : state === "retry" ? (
              <RotateCcw aria-hidden="true" size={15} />
            ) : null}
            {state === "pending"
              ? "Undoing"
              : state === "retry"
                ? "Retry"
                : "Undo"}
          </button>
        ) : null}
        <button
          type="button"
          aria-label="Dismiss send notice"
          onClick={onClose}
          className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl text-white/75 hover:bg-white/10 hover:text-white"
        >
          <X aria-hidden="true" size={17} />
        </button>
      </div>
    </output>
  );
}
