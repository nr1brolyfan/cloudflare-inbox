import * as Schema from "effect/Schema";

export const OutboundFailureCode = Schema.Literals([
  "invalid_message",
  "message_too_large",
  "invalid_sender",
  "recipient_suppressed",
  "provider_rejected",
  "retry_exhausted",
]);
export type OutboundFailureCode = Schema.Schema.Type<
  typeof OutboundFailureCode
>;
