import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Schema from "effect/Schema";
import {
  CircleAlert,
  CircleCheck,
  Clock3,
  LoaderCircle,
  RotateCcw,
  Send,
  Undo2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { UndoMailboxSendCommand } from "#/modules/mailbox/application/MailboxOutboundSending";
import type {
  OutboundDeliveryStatus,
  OutboundFailureCode,
} from "#/modules/mailbox/domain/MailboxOutbound";

type UndoCommand = Schema.Schema.Type<typeof UndoMailboxSendCommand>;

export interface OutboundDeliveryView {
  readonly attemptCount: number;
  readonly failure?: { readonly code: OutboundFailureCode };
  readonly id: string;
  readonly mailboxId: string;
  readonly sendAt: number;
  readonly status: OutboundDeliveryStatus;
  readonly version: number;
}

export interface OutboundDeliverySnapshot {
  readonly delivery: OutboundDeliveryView;
  readonly serverNow: number;
}

type OutboundStatusResult =
  | { readonly ok: true; readonly outbound: OutboundDeliverySnapshot }
  | { readonly ok: false; readonly status: number };

type UndoResult =
  | { readonly ok: true; readonly delivery: OutboundDeliveryView }
  | { readonly ok: false; readonly status: number };

interface OutboundDeliveryTrackerProps {
  readonly deliveryId: string;
  readonly getStatus: () => Promise<OutboundStatusResult>;
  readonly mailboxId: string;
  readonly onDismiss: () => void;
  readonly onMailboxChanged: () => void;
  readonly onUnauthorized: () => Promise<void> | void;
  readonly sessionId: string;
  readonly undo: (command: UndoCommand) => Promise<UndoResult>;
}

class OutboundStatusRequestError extends Error {
  readonly status: number;

  constructor(status: number) {
    super("Outbound delivery status request failed");
    this.name = "OutboundStatusRequestError";
    this.status = status;
  }
}

const decodeUndoCommand = Schema.decodeUnknownSync(UndoMailboxSendCommand);
const acceptedAutoDismissMillis = 3000;

export const outboundDeliveryQueryKey = (
  sessionId: string,
  mailboxId: string,
  deliveryId: string
) =>
  ["mailbox", "outbound-delivery", sessionId, mailboxId, deliveryId] as const;

const failureDetail = {
  invalid_message:
    "The message could not be prepared because its content is invalid.",
  invalid_sender: "The sender address is not valid for this mailbox.",
  message_too_large: "The message is too large for the email provider.",
  preparation_failed: "The message could not be prepared for delivery.",
  provider_rejected: "The email provider rejected this message.",
  provider_unavailable: "The email provider was unavailable.",
  recipient_suppressed: "The provider has suppressed one or more recipients.",
  retry_exhausted: "Delivery failed after all automatic retry attempts.",
  temporary_provider_failure:
    "The provider kept returning a temporary failure.",
} satisfies Record<OutboundFailureCode, string>;

const deliveryCopy = (
  delivery: OutboundDeliveryView,
  remainingMillis: number
) => {
  switch (delivery.status) {
    case "scheduled": {
      if (delivery.attemptCount > 0) {
        return {
          detail: `Automatic retry attempt ${delivery.attemptCount} is scheduled.`,
          title: "Retrying delivery",
        };
      }
      if (remainingMillis === 0) {
        return {
          detail: "The send time has passed. Waiting for the send worker.",
          title: "Waiting to send",
        };
      }
      const seconds = Math.ceil(remainingMillis / 1000);
      return {
        detail: `Sending in ${seconds} ${seconds === 1 ? "second" : "seconds"}.`,
        title: "Send scheduled",
      };
    }
    case "sending": {
      return {
        detail: "The message is being handed to the email provider.",
        title: "Sending",
      };
    }
    case "accepted": {
      return {
        detail:
          "The provider accepted and queued this message. This does not confirm recipient delivery.",
        title: "Accepted by provider",
      };
    }
    case "failed": {
      return {
        detail:
          delivery.failure === undefined
            ? "Delivery failed."
            : failureDetail[delivery.failure.code],
        title: "Delivery failed",
      };
    }
    case "indeterminate": {
      return {
        detail:
          "The provider outcome is unknown. The message may have been accepted, so sending it again could create a duplicate.",
        title: "Delivery could not be confirmed",
      };
    }
    case "cancelled": {
      return {
        detail: "The scheduled send was cancelled before provider submission.",
        title: "Send cancelled",
      };
    }
    case "delivered": {
      return {
        detail: "The provider reported that the message was delivered.",
        title: "Delivered",
      };
    }
    case "bounced": {
      return {
        detail: "The provider reported that the message bounced.",
        title: "Message bounced",
      };
    }
    default: {
      return {
        detail: "The latest delivery state is unavailable.",
        title: "Delivery status unavailable",
      };
    }
  }
};

const statusIcon = (status: OutboundDeliveryStatus | undefined) => {
  if (status === "delivered" || status === "accepted") {
    return (
      <CircleCheck aria-hidden="true" className="mt-0.5 shrink-0" size={19} />
    );
  }
  if (
    status === "failed" ||
    status === "indeterminate" ||
    status === "bounced"
  ) {
    return (
      <CircleAlert aria-hidden="true" className="mt-0.5 shrink-0" size={19} />
    );
  }
  if (status === "scheduled" || status === "cancelled") {
    return <Clock3 aria-hidden="true" className="mt-0.5 shrink-0" size={19} />;
  }
  return <Send aria-hidden="true" className="mt-0.5 shrink-0" size={19} />;
};

// oxlint-disable-next-line eslint/complexity -- The tracker presents every delivery and request state in one persistent surface.
export function OutboundDeliveryTracker({
  deliveryId,
  getStatus,
  mailboxId,
  onDismiss,
  onMailboxChanged,
  onUnauthorized,
  sessionId,
  undo,
}: OutboundDeliveryTrackerProps) {
  const queryClient = useQueryClient();
  const queryKey = outboundDeliveryQueryKey(sessionId, mailboxId, deliveryId);
  const undoCommand = useRef<UndoCommand | null>(null);
  const mailboxRefreshVersion = useRef<number | null>(null);
  const [clockNow, setClockNow] = useState(Date.now);
  const [accessFailure, setAccessFailure] = useState<number>();
  const [actionFailure, setActionFailure] = useState<string>();
  const [undoState, setUndoState] = useState<
    "idle" | "pending" | "retry" | "checking"
  >("idle");
  const status = useQuery({
    queryFn: async () => {
      const result = await getStatus();
      if (result.ok) {
        setAccessFailure(undefined);
        return result.outbound;
      }
      if (result.status === 401) {
        await onUnauthorized();
      }
      throw new OutboundStatusRequestError(result.status);
    },
    queryKey,
    retry: false,
  });
  const delivery = status.data?.delivery;
  const deadline =
    status.data === undefined
      ? 0
      : status.dataUpdatedAt +
        status.data.delivery.sendAt -
        status.data.serverNow;
  const remainingMillis = Math.max(0, deadline - clockNow);

  useEffect(() => {
    if (
      delivery?.status !== "scheduled" ||
      delivery.attemptCount > 0 ||
      deadline <= Date.now()
    ) {
      return;
    }
    const timer = window.setInterval(() => setClockNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [deadline, delivery?.attemptCount, delivery?.status]);

  useEffect(() => {
    if (
      delivery?.status !== "accepted" ||
      mailboxRefreshVersion.current === delivery.version
    ) {
      return;
    }
    mailboxRefreshVersion.current = delivery.version;
    onMailboxChanged();
  }, [delivery?.status, delivery?.version, onMailboxChanged]);

  useEffect(() => {
    if (
      delivery?.status !== "accepted" ||
      status.error !== null ||
      actionFailure !== undefined
    ) {
      return;
    }
    const timer = window.setTimeout(onDismiss, acceptedAutoDismissMillis);
    return () => window.clearTimeout(timer);
  }, [actionFailure, delivery?.status, onDismiss, status.error]);

  const runUndo = async () => {
    if (delivery === undefined) {
      return;
    }
    const command =
      undoCommand.current ??
      decodeUndoCommand({
        expectedVersion: delivery.version,
        mailboxId,
        operationId: crypto.randomUUID(),
        outboundDeliveryId: deliveryId,
      });
    undoCommand.current = command;
    setActionFailure(undefined);
    setUndoState("pending");
    try {
      const result = await undo(command);
      if (result.ok) {
        queryClient.setQueryData<OutboundDeliverySnapshot>(
          queryKey,
          (current) => ({
            delivery: result.delivery,
            serverNow: current?.serverNow ?? Date.now(),
          })
        );
        setUndoState("idle");
        onMailboxChanged();
        return;
      }
      if (result.status === 401) {
        setUndoState("idle");
        await onUnauthorized();
        return;
      }
      if (result.status === 403 || result.status === 404) {
        setAccessFailure(result.status);
        setUndoState("idle");
        return;
      }
      if (result.status === 409) {
        setUndoState("checking");
        const refreshed = await status.refetch();
        if (refreshed.data !== undefined && refreshed.error === null) {
          undoCommand.current = null;
        }
        setUndoState("idle");
        return;
      }
      if (result.status >= 500) {
        setUndoState("retry");
        return;
      }
      setActionFailure(
        "The send could not be cancelled. Check its latest status."
      );
      setUndoState("idle");
    } catch {
      setUndoState("retry");
    }
  };

  const requestError =
    status.error instanceof OutboundStatusRequestError
      ? status.error.status
      : undefined;
  const stoppedStatus = accessFailure ?? requestError;
  const stoppedMessage =
    stoppedStatus === 401
      ? "Your session ended. Sign in again to check this send."
      : stoppedStatus === 403
        ? "You do not have permission to view this delivery."
        : stoppedStatus === 404
          ? "This outbound delivery could not be found."
          : stoppedStatus !== undefined && stoppedStatus < 500
            ? "The delivery status request was rejected."
            : undefined;
  const transientFailure =
    status.error !== null && stoppedMessage === undefined;
  const copy =
    delivery === undefined
      ? {
          detail: "Loading the latest provider status.",
          title: "Checking send status",
        }
      : deliveryCopy(delivery, remainingMillis);
  const canUndo =
    delivery?.status === "scheduled" &&
    delivery.attemptCount === 0 &&
    remainingMillis > 0 &&
    accessFailure === undefined;
  const canRefetch =
    stoppedMessage === undefined &&
    (transientFailure ||
      actionFailure !== undefined ||
      undoState === "checking" ||
      delivery?.status === "indeterminate" ||
      (delivery?.status === "scheduled" && !canUndo));
  const statusIndicator = statusIcon(delivery?.status);
  const alertStatus =
    delivery?.status === "failed" ||
    delivery?.status === "indeterminate" ||
    delivery?.status === "bounced";

  return (
    <output
      aria-atomic="true"
      aria-live="polite"
      className="fixed inset-x-0 bottom-0 z-40 px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:right-5 sm:left-auto sm:w-[27rem] sm:px-0 sm:pb-5"
    >
      <div className="rounded-2xl border border-[var(--line)] bg-[var(--nav-bg)] p-3 text-white shadow-[0_20px_60px_rgba(10,35,40,0.3)] sm:p-4">
        <div className="flex items-start gap-3">
          {status.isLoading ? (
            <LoaderCircle
              aria-hidden="true"
              className="mt-0.5 shrink-0 animate-spin"
              size={19}
            />
          ) : (
            statusIndicator
          )}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-extrabold">{copy.title}</p>
            <p
              role={alertStatus ? "alert" : undefined}
              className="mt-0.5 text-xs leading-5 text-white/72"
            >
              {copy.detail}
            </p>
            {stoppedMessage === undefined ? null : (
              <p role="alert" className="mt-2 text-xs font-bold text-amber-200">
                {stoppedMessage}
              </p>
            )}
            {transientFailure ? (
              <p role="alert" className="mt-2 text-xs font-bold text-amber-200">
                The latest status could not be loaded. The last known status is
                still shown.
              </p>
            ) : null}
            {actionFailure === undefined ? null : (
              <p role="alert" className="mt-2 text-xs font-bold text-amber-200">
                {actionFailure}
              </p>
            )}
            {undoState === "retry" ? (
              <p role="alert" className="mt-2 text-xs font-bold text-amber-200">
                The cancellation result is unknown. Retry uses the exact same
                request.
              </p>
            ) : null}
          </div>
          <button
            type="button"
            aria-label="Dismiss delivery status"
            onClick={onDismiss}
            className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl text-white/75 hover:bg-white/10 hover:text-white"
          >
            <X aria-hidden="true" size={17} />
          </button>
        </div>
        {canUndo || undoState === "retry" || canRefetch ? (
          <div className="mt-3 flex flex-wrap justify-end gap-2 border-t border-white/10 pt-3">
            {canRefetch ? (
              <button
                type="button"
                disabled={status.isFetching || undoState === "checking"}
                onClick={() => void status.refetch()}
                className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/16 px-4 text-xs font-extrabold text-white disabled:opacity-60"
              >
                {status.isFetching || undoState === "checking" ? (
                  <LoaderCircle
                    aria-hidden="true"
                    className="animate-spin"
                    size={15}
                  />
                ) : (
                  <RotateCcw aria-hidden="true" size={15} />
                )}
                Check status
              </button>
            ) : null}
            {canUndo || undoState === "retry" ? (
              <button
                type="button"
                disabled={undoState === "pending"}
                onClick={() => void runUndo()}
                className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[var(--nav-selection)] px-4 text-xs font-extrabold text-[var(--sea-ink)] disabled:opacity-60"
              >
                {undoState === "pending" ? (
                  <LoaderCircle
                    aria-hidden="true"
                    className="animate-spin"
                    size={15}
                  />
                ) : undoState === "retry" ? (
                  <RotateCcw aria-hidden="true" size={15} />
                ) : (
                  <Undo2 aria-hidden="true" size={15} />
                )}
                {undoState === "pending"
                  ? "Undoing"
                  : undoState === "retry"
                    ? "Retry undo"
                    : "Undo"}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </output>
  );
}
