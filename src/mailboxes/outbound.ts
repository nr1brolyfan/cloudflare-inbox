/* oxlint-disable max-classes-per-file -- Outbound domain schemas are intentionally consolidated. */
import * as Schema from "effect/Schema";

import {
  AttemptCount,
  DraftId,
  MailAddress,
  MailboxId,
  MessageId,
  OperationId,
  OutboundDeliveryId,
  UnixMillis,
  Version,
} from "./core";

export const outboundUndoWindowMillis = 10_000;
export const outboundMaxRecipientCount = 50;

export const OutboundDeliveryStatus = Schema.Literals([
  "scheduled",
  "sending",
  "accepted",
  "delivered",
  "bounced",
  "cancelled",
  "failed",
  "indeterminate",
]);
export type OutboundDeliveryStatus = Schema.Schema.Type<
  typeof OutboundDeliveryStatus
>;

export const isOutboundFinalStatus = (
  status: OutboundDeliveryStatus
): boolean =>
  status === "delivered" ||
  status === "bounced" ||
  status === "cancelled" ||
  status === "failed";

export const isOutboundQuiescentStatus = (
  status: OutboundDeliveryStatus
): boolean =>
  status === "accepted" ||
  status === "indeterminate" ||
  isOutboundFinalStatus(status);

export const OutboundFailureCode = Schema.Literals([
  "invalid_message",
  "message_too_large",
  "invalid_sender",
  "recipient_suppressed",
  "provider_rejected",
  "preparation_failed",
  "temporary_provider_failure",
  "provider_unavailable",
  "retry_exhausted",
]);
export type OutboundFailureCode = Schema.Schema.Type<
  typeof OutboundFailureCode
>;

export class OutboundDeliveryFailure extends Schema.Class<OutboundDeliveryFailure>(
  "cloudflare-inbox/OutboundDeliveryFailure"
)({
  code: OutboundFailureCode,
  failedAt: UnixMillis,
}) {}

export const OutboundProviderMessageId = Schema.Trimmed.pipe(
  Schema.check(Schema.isLengthBetween(1, 998)),
  Schema.brand("cloudflare-inbox/OutboundProviderMessageId")
);
export type OutboundProviderMessageId = Schema.Schema.Type<
  typeof OutboundProviderMessageId
>;

export class OutboundDelivery extends Schema.Class<OutboundDelivery>(
  "cloudflare-inbox/OutboundDelivery"
)({
  id: OutboundDeliveryId,
  resendOf: Schema.optional(OutboundDeliveryId),
  mailboxId: MailboxId,
  messageId: MessageId,
  status: OutboundDeliveryStatus,
  sendAt: UnixMillis,
  providerMessageId: Schema.optional(OutboundProviderMessageId),
  acceptedAt: Schema.optional(UnixMillis),
  deliveredAt: Schema.optional(UnixMillis),
  bouncedAt: Schema.optional(UnixMillis),
  cancelledAt: Schema.optional(UnixMillis),
  failure: Schema.optional(OutboundDeliveryFailure),
  attemptCount: AttemptCount,
  createdAt: UnixMillis,
  updatedAt: UnixMillis,
  version: Version,
}) {}

type StatusInvariant = (delivery: OutboundDelivery) => string | undefined;

const noProviderOutcome: StatusInvariant = (delivery) =>
  delivery.providerMessageId === undefined &&
  delivery.acceptedAt === undefined &&
  delivery.deliveredAt === undefined &&
  delivery.bouncedAt === undefined &&
  delivery.cancelledAt === undefined
    ? undefined
    : `${delivery.status} delivery cannot claim a terminal timestamp`;

const statusInvariants = {
  scheduled: noProviderOutcome,
  sending: noProviderOutcome,
  failed: noProviderOutcome,
  indeterminate: noProviderOutcome,
  accepted: (delivery) =>
    delivery.providerMessageId !== undefined &&
    delivery.acceptedAt !== undefined &&
    delivery.deliveredAt === undefined &&
    delivery.bouncedAt === undefined &&
    delivery.cancelledAt === undefined
      ? undefined
      : "accepted delivery must contain only acceptedAt",
  delivered: (delivery) =>
    delivery.providerMessageId !== undefined &&
    delivery.acceptedAt !== undefined &&
    delivery.deliveredAt !== undefined &&
    delivery.deliveredAt >= delivery.acceptedAt &&
    delivery.bouncedAt === undefined &&
    delivery.cancelledAt === undefined
      ? undefined
      : "delivered delivery requires ordered acceptedAt and deliveredAt",
  bounced: (delivery) =>
    delivery.providerMessageId !== undefined &&
    delivery.acceptedAt !== undefined &&
    delivery.bouncedAt !== undefined &&
    delivery.bouncedAt >= delivery.acceptedAt &&
    delivery.deliveredAt === undefined &&
    delivery.cancelledAt === undefined
      ? undefined
      : "bounced delivery requires ordered acceptedAt and bouncedAt",
  cancelled: (delivery) =>
    delivery.providerMessageId === undefined &&
    delivery.cancelledAt !== undefined &&
    delivery.cancelledAt >= delivery.createdAt &&
    delivery.acceptedAt === undefined &&
    delivery.deliveredAt === undefined &&
    delivery.bouncedAt === undefined
      ? undefined
      : "cancelled delivery must contain only cancelledAt",
} satisfies Record<OutboundDeliveryStatus, StatusInvariant>;

export const OutboundDeliverySchema = OutboundDelivery.check(
  Schema.makeFilter((delivery) => {
    if (delivery.updatedAt < delivery.createdAt) {
      return "updatedAt cannot be earlier than createdAt";
    }
    if (delivery.sendAt < delivery.createdAt) {
      return "sendAt cannot be earlier than createdAt";
    }
    if (delivery.resendOf === delivery.id) {
      return "a delivery cannot be a resend of itself";
    }
    if (
      (delivery.status === "sending" || delivery.status === "indeterminate") &&
      delivery.updatedAt < delivery.sendAt
    ) {
      return `${delivery.status} delivery cannot predate sendAt`;
    }
    if ((delivery.status === "failed") !== (delivery.failure !== undefined)) {
      return "failure must be present exactly when outbound delivery has failed";
    }
    if (
      delivery.failure !== undefined &&
      (delivery.failure.failedAt < delivery.sendAt ||
        delivery.failure.failedAt > delivery.updatedAt)
    ) {
      return "failedAt must fall between sendAt and updatedAt";
    }
    if (
      delivery.acceptedAt !== undefined &&
      (delivery.acceptedAt < delivery.sendAt ||
        delivery.acceptedAt > delivery.updatedAt)
    ) {
      return "acceptedAt must fall between sendAt and updatedAt";
    }
    if (
      delivery.deliveredAt !== undefined &&
      delivery.deliveredAt > delivery.updatedAt
    ) {
      return "deliveredAt cannot be later than updatedAt";
    }
    if (
      delivery.bouncedAt !== undefined &&
      delivery.bouncedAt > delivery.updatedAt
    ) {
      return "bouncedAt cannot be later than updatedAt";
    }
    if (
      delivery.cancelledAt !== undefined &&
      delivery.cancelledAt > delivery.updatedAt
    ) {
      return "cancelledAt cannot be later than updatedAt";
    }

    return statusInvariants[delivery.status](delivery);
  })
);

const transitions = {
  scheduled: new Set<OutboundDeliveryStatus>(["sending", "cancelled"]),
  sending: new Set<OutboundDeliveryStatus>([
    "scheduled",
    "accepted",
    "failed",
    "indeterminate",
  ]),
  accepted: new Set<OutboundDeliveryStatus>(["delivered", "bounced"]),
  delivered: new Set<OutboundDeliveryStatus>(),
  bounced: new Set<OutboundDeliveryStatus>(),
  cancelled: new Set<OutboundDeliveryStatus>(),
  failed: new Set<OutboundDeliveryStatus>(),
  indeterminate: new Set<OutboundDeliveryStatus>([
    "accepted",
    "delivered",
    "bounced",
    "failed",
  ]),
} as const satisfies Record<
  OutboundDeliveryStatus,
  ReadonlySet<OutboundDeliveryStatus>
>;

/** Only a scheduled delivery may remain scheduled while being rescheduled. */
export const canTransitionOutbound = (
  from: OutboundDeliveryStatus,
  to: OutboundDeliveryStatus
): boolean =>
  (from === "scheduled" && to === "scheduled") || transitions[from].has(to);

export const OutboundOperationConfirmation = Schema.Literals([
  "explicit-user-action",
  "ai-tool-execution",
  "system-execution",
]);
export type OutboundOperationConfirmation = Schema.Schema.Type<
  typeof OutboundOperationConfirmation
>;

export const ScheduleOutboundInput = Schema.Struct({
  confirmation: OutboundOperationConfirmation,
  mailboxId: MailboxId,
  draftId: DraftId,
  expectedVersion: Version,
  operationId: OperationId,
  sender: MailAddress,
});
export type ScheduleOutboundInput = Schema.Schema.Type<
  typeof ScheduleOutboundInput
>;

export const ScheduleOutboundResult = Schema.Struct({
  delivery: OutboundDeliverySchema,
  serverNow: UnixMillis,
});
export type ScheduleOutboundResult = Schema.Schema.Type<
  typeof ScheduleOutboundResult
>;

export const GetOutboundDeliveryInput = Schema.Struct({
  mailboxId: MailboxId,
  outboundDeliveryId: OutboundDeliveryId,
});
export type GetOutboundDeliveryInput = Schema.Schema.Type<
  typeof GetOutboundDeliveryInput
>;

export const CancelOutboundDeliveryInput = Schema.Struct({
  mailboxId: MailboxId,
  operationId: OperationId,
  outboundDeliveryId: OutboundDeliveryId,
  expectedVersion: Version,
});
export type CancelOutboundDeliveryInput = Schema.Schema.Type<
  typeof CancelOutboundDeliveryInput
>;

export const ResendOutboundInput = Schema.Struct({
  confirmation: OutboundOperationConfirmation,
  mailboxId: MailboxId,
  outboundDeliveryId: OutboundDeliveryId,
  expectedVersion: Version,
  operationId: OperationId,
  acknowledgeDuplicateRisk: Schema.Literal(true),
});
export type ResendOutboundInput = Schema.Schema.Type<
  typeof ResendOutboundInput
>;

/** Resend creates a new delivery whose resendOf points at the source. */
export const ResendOutboundResult = Schema.Struct({
  sourceDeliveryId: OutboundDeliveryId,
  delivery: OutboundDeliverySchema,
}).check(
  Schema.makeFilter((result) =>
    result.delivery.resendOf === result.sourceDeliveryId
      ? undefined
      : "resend delivery must point at the source delivery"
  )
);
export type ResendOutboundResult = Schema.Schema.Type<
  typeof ResendOutboundResult
>;

export const OutboundDeliveryResult = OutboundDeliverySchema;
export type OutboundDeliveryResult = Schema.Schema.Type<
  typeof OutboundDeliveryResult
>;
