/* oxlint-disable max-classes-per-file -- Claim schema and lifecycle store form one cohesive port contract. */
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  AttemptCount,
  OutboundDeliveryId,
  Version,
} from "#/modules/mailbox/domain/Mailbox";
import {
  OutboundFailureCode,
  OutboundProviderMessageId,
} from "#/modules/mailbox/domain/MailboxOutbound";
import { UnixMillis } from "#/shared/Temporal";

export const outboundRetryBaseDelayMillis = 30_000;
export const outboundRetryMaxDelayMillis = 30 * 60_000;
export const outboundRetryMaxAttempts = 5;
export const outboundSendingStaleTimeoutMillis = 15 * 60_000;

export const outboundRetryDelayMillis = (attemptCount: number): number =>
  Math.min(
    outboundRetryBaseDelayMillis * 2 ** Math.max(0, attemptCount - 1),
    outboundRetryMaxDelayMillis
  );

export class OutboundDeliveryClaim extends Schema.Class<OutboundDeliveryClaim>(
  "cloudflare-inbox/OutboundDeliveryClaim"
)({
  attemptCount: AttemptCount,
  claimedAt: UnixMillis,
  outboundDeliveryId: OutboundDeliveryId,
  version: Version,
}) {}

export const OutboundDeliverySettlement = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("Accepted"),
    providerMessageId: OutboundProviderMessageId,
  }),
  Schema.Struct({
    _tag: Schema.Literal("Failed"),
    code: OutboundFailureCode,
  }),
  Schema.Struct({ _tag: Schema.Literal("Indeterminate") }),
]);
export type OutboundDeliverySettlement = Schema.Schema.Type<
  typeof OutboundDeliverySettlement
>;

export interface MailboxOutboundLifecycleStoreService {
  readonly claimDue: Effect.Effect<OutboundDeliveryClaim | null>;
  readonly nextScheduledAt: Effect.Effect<number | null>;
  readonly recoverStaleSending: Effect.Effect<number>;
  readonly retry: (claim: OutboundDeliveryClaim) => Effect.Effect<boolean>;
  readonly settle: (
    claim: OutboundDeliveryClaim,
    settlement: OutboundDeliverySettlement
  ) => Effect.Effect<boolean>;
}

/** Internal DO store; claims and settlements are guarded by lifecycle version and attempt. */
export class MailboxOutboundLifecycleStore extends Context.Service<
  MailboxOutboundLifecycleStore,
  MailboxOutboundLifecycleStoreService
>()("cloudflare-inbox/MailboxOutboundLifecycleStore") {}
