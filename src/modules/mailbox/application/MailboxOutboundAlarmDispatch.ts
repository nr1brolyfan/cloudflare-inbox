import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";

import { MailboxOutboundAlarmScheduler } from "#/modules/mailbox/application/MailboxOutboundAlarmScheduler";
import type { MailboxOutboundDispatcherError } from "#/modules/mailbox/application/MailboxOutboundDispatcher";
import { MailboxOutboundDispatcher } from "#/modules/mailbox/application/MailboxOutboundDispatcher";
import type { OutboundFailureCode } from "#/modules/mailbox/domain/MailboxOutbound";
import { MailboxOutboundLifecycleStore } from "#/modules/mailbox/ports/MailboxOutboundLifecycleStore";
import type { OutboundDeliverySettlement } from "#/modules/mailbox/ports/MailboxOutboundLifecycleStore";

const rejectionCodes = {
  "invalid-message": "invalid_message",
  "message-too-large": "message_too_large",
  "invalid-sender": "invalid_sender",
  "recipient-suppressed": "recipient_suppressed",
  "provider-rejected": "provider_rejected",
} as const satisfies Readonly<Record<string, OutboundFailureCode>>;

type FailureResolution = OutboundDeliverySettlement | "retry";

const failureResolution = (
  error: MailboxOutboundDispatcherError
): FailureResolution => {
  switch (error._tag) {
    case "DeliveryRejectedError": {
      return { _tag: "Failed", code: rejectionCodes[error.reason] };
    }
    case "DeliveryTemporaryFailureError": {
      return "retry";
    }
    case "DeliveryProviderUnavailableError": {
      return "retry";
    }
    case "BlobStoreError": {
      return error.retryable
        ? "retry"
        : { _tag: "Failed", code: "preparation_failed" };
    }
    case "OutboundDispatchSnapshotError": {
      return error.reason === "storage"
        ? "retry"
        : { _tag: "Failed", code: "preparation_failed" };
    }
    case "DeliveryIndeterminateError": {
      return { _tag: "Indeterminate" };
    }
    default: {
      return { _tag: "Indeterminate" };
    }
  }
};

export interface MailboxOutboundAlarmDispatchService {
  readonly handle: Effect.Effect<void>;
}

/** Processes one delivery per invocation and reconciles the next alarm on every exit. */
export class MailboxOutboundAlarmDispatch extends Context.Service<
  MailboxOutboundAlarmDispatch,
  MailboxOutboundAlarmDispatchService
>()("cloudflare-inbox/MailboxOutboundAlarmDispatch", {
  make: Effect.gen(function* () {
    const lifecycle = yield* MailboxOutboundLifecycleStore;
    const dispatcher = yield* MailboxOutboundDispatcher;
    const scheduler = yield* MailboxOutboundAlarmScheduler;

    const processOne = Effect.gen(function* () {
      yield* lifecycle.recoverStaleSending;
      const claim = yield* lifecycle.claimDue;
      if (claim === null) {
        return;
      }

      yield* Effect.result(dispatcher.dispatch(claim.outboundDeliveryId)).pipe(
        Effect.flatMap((result) => {
          if (Result.isSuccess(result)) {
            return lifecycle.settle(claim, {
              _tag: "Accepted",
              providerMessageId: result.success.providerMessageId,
            });
          }
          const resolution = failureResolution(result.failure);
          return resolution === "retry"
            ? lifecycle.retry(claim)
            : lifecycle.settle(claim, resolution);
        }),
        // Unknown failures cannot prove whether provider acceptance occurred.
        Effect.catchDefect(() =>
          lifecycle.settle(claim, { _tag: "Indeterminate" })
        ),
        Effect.asVoid
      );
    });

    return {
      handle: processOne.pipe(Effect.ensuring(scheduler.reconcile)),
    } satisfies MailboxOutboundAlarmDispatchService;
  }),
}) {
  static readonly layerNoDeps = Layer.effect(this, this.make);
}
