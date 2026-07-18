import type { OutboundDeliveryStatus } from "./outbound-delivery-status";

const transitions = {
  scheduled: new Set<OutboundDeliveryStatus>(["sending", "cancelled"]),
  sending: new Set<OutboundDeliveryStatus>([
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
