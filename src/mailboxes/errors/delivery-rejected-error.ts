import * as Data from "effect/Data";

export class DeliveryRejectedError extends Data.TaggedError(
  "DeliveryRejectedError"
)<{
  readonly reason:
    | "invalid-message"
    | "message-too-large"
    | "invalid-sender"
    | "recipient-suppressed"
    | "provider-rejected";
  readonly message: string;
  readonly cause?: unknown;
}> {}
