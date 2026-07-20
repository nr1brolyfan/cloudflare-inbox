import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";

import type { MailboxOutboundDispatcherError } from "./mailbox-outbound-dispatcher";
import { MailboxOutboundDispatcher } from "./mailbox-outbound-dispatcher";
import type { OutboundFailureCode } from "./outbound";
import { MailboxOutboundAlarmScheduler } from "./outbound-alarm-live";
import { MailboxOutboundLifecycleStore } from "./outbound-lifecycle-store-sqlite-live";
import type { OutboundDeliverySettlement } from "./outbound-lifecycle-store-sqlite-live";

const rejectionCodes = {
  "invalid-message": "invalid_message",
  "message-too-large": "message_too_large",
  "invalid-sender": "invalid_sender",
  "recipient-suppressed": "recipient_suppressed",
  "provider-rejected": "provider_rejected",
} as const satisfies Readonly<Record<string, OutboundFailureCode>>;

const failureSettlement = (
  error: MailboxOutboundDispatcherError
): OutboundDeliverySettlement => {
  switch (error._tag) {
    case "DeliveryRejectedError": {
      return { _tag: "Failed", code: rejectionCodes[error.reason] };
    }
    case "DeliveryTemporaryFailureError": {
      // The provider explicitly declined this attempt, so a later retry is safe.
      return { _tag: "Failed", code: "temporary_provider_failure" };
    }
    case "DeliveryProviderUnavailableError": {
      return { _tag: "Failed", code: "provider_unavailable" };
    }
    case "BlobStoreError":
    case "OutboundDispatchSnapshotError": {
      return { _tag: "Failed", code: "preparation_failed" };
    }
    case "DeliveryIndeterminateError": {
      return { _tag: "Indeterminate" };
    }
    default: {
      return { _tag: "Indeterminate" };
    }
  }
};

export interface MailboxOutboundAlarmDispatch {
  readonly handle: Effect.Effect<void>;
}

export const MailboxOutboundAlarmDispatch =
  Context.Service<MailboxOutboundAlarmDispatch>(
    "cloudflare-inbox/MailboxOutboundAlarmDispatch"
  );

/** Processes one delivery per invocation and reconciles the next alarm on every exit. */
export const MailboxOutboundAlarmDispatchLive = Layer.effect(
  MailboxOutboundAlarmDispatch,
  Effect.gen(function* () {
    const lifecycle = yield* MailboxOutboundLifecycleStore;
    const dispatcher = yield* MailboxOutboundDispatcher;
    const scheduler = yield* MailboxOutboundAlarmScheduler;

    const processOne = Effect.gen(function* () {
      const claim = yield* lifecycle.claimDue;
      if (claim === null) {
        return;
      }

      yield* Effect.result(dispatcher.dispatch(claim.outboundDeliveryId)).pipe(
        Effect.flatMap((result) =>
          Result.isFailure(result)
            ? lifecycle.settle(claim, failureSettlement(result.failure))
            : lifecycle.settle(claim, {
                _tag: "Accepted",
                providerMessageId: result.success.providerMessageId,
              })
        ),
        // Unknown failures cannot prove whether provider acceptance occurred.
        Effect.catchDefect(() =>
          lifecycle.settle(claim, { _tag: "Indeterminate" })
        ),
        Effect.asVoid
      );
    });

    return MailboxOutboundAlarmDispatch.of({
      handle: processOne.pipe(Effect.ensuring(scheduler.reconcile)),
    });
  })
);
