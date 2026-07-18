import * as Schema from "effect/Schema";

/** Durable checkpoints exposed for progress and replay diagnostics. */
export const InboundProcessingStatus = Schema.Literals([
  "received",
  "raw_stored",
  "parsing",
  "attachments_stored",
  "ready",
  "failed",
]);
export type InboundProcessingStatus = Schema.Schema.Type<
  typeof InboundProcessingStatus
>;

export const isInboundTerminalStatus = (
  status: InboundProcessingStatus
): boolean => status === "ready" || status === "failed";
