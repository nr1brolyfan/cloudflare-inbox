import type { InboundProcessingStatus } from "./inbound-processing-status";

const transitions = {
  received: new Set<InboundProcessingStatus>(["raw_stored", "failed"]),
  raw_stored: new Set<InboundProcessingStatus>(["parsing", "failed"]),
  parsing: new Set<InboundProcessingStatus>(["attachments_stored", "failed"]),
  attachments_stored: new Set<InboundProcessingStatus>(["ready", "failed"]),
  ready: new Set<InboundProcessingStatus>(),
  failed: new Set<InboundProcessingStatus>(),
} as const satisfies Record<
  InboundProcessingStatus,
  ReadonlySet<InboundProcessingStatus>
>;

/** Same-state writes are accepted as idempotent retries. */
export const canTransitionInbound = (
  from: InboundProcessingStatus,
  to: InboundProcessingStatus
): boolean => from === to || transitions[from].has(to);
