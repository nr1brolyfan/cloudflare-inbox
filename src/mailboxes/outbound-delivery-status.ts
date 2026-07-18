import * as Schema from "effect/Schema";

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
