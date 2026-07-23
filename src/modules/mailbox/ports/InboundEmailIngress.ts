import * as Data from "effect/Data";

export class InboundEmailRejected extends Data.TaggedError(
  "InboundEmailRejected"
)<{
  readonly reason:
    | "invalid-envelope"
    | "processing-unavailable"
    | "unknown-recipient";
  readonly message: string;
  readonly cause?: unknown;
}> {}
