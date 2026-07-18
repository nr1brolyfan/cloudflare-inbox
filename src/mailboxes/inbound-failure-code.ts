import * as Schema from "effect/Schema";

export const InboundFailureCode = Schema.Literals([
  "malformed_message",
  "message_too_large",
  "unsupported_message",
  "processing_failed",
]);
export type InboundFailureCode = Schema.Schema.Type<typeof InboundFailureCode>;
