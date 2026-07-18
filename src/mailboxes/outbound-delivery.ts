import * as Schema from "effect/Schema";

import { MailboxId, MessageId, OutboundDeliveryId } from "./identifiers";
import { OutboundDeliveryFailure } from "./outbound-delivery-failure";
import { OutboundDeliveryStatus } from "./outbound-delivery-status";
import { AttemptCount, UnixMillis, Version } from "./primitives";

export class OutboundDelivery extends Schema.Class<OutboundDelivery>(
  "cloudflare-inbox/OutboundDelivery"
)({
  id: OutboundDeliveryId,
  resendOf: Schema.optional(OutboundDeliveryId),
  mailboxId: MailboxId,
  messageId: MessageId,
  status: OutboundDeliveryStatus,
  sendAt: UnixMillis,
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
    delivery.acceptedAt !== undefined &&
    delivery.deliveredAt === undefined &&
    delivery.bouncedAt === undefined &&
    delivery.cancelledAt === undefined
      ? undefined
      : "accepted delivery must contain only acceptedAt",
  delivered: (delivery) =>
    delivery.acceptedAt !== undefined &&
    delivery.deliveredAt !== undefined &&
    delivery.deliveredAt >= delivery.acceptedAt &&
    delivery.bouncedAt === undefined &&
    delivery.cancelledAt === undefined
      ? undefined
      : "delivered delivery requires ordered acceptedAt and deliveredAt",
  bounced: (delivery) =>
    delivery.acceptedAt !== undefined &&
    delivery.bouncedAt !== undefined &&
    delivery.bouncedAt >= delivery.acceptedAt &&
    delivery.deliveredAt === undefined &&
    delivery.cancelledAt === undefined
      ? undefined
      : "bounced delivery requires ordered acceptedAt and bouncedAt",
  cancelled: (delivery) =>
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
