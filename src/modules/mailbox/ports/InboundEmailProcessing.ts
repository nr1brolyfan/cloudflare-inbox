/* oxlint-disable max-classes-per-file -- Inbound processing failures share one temporary port contract. */
import * as Data from "effect/Data";

export class MimeParseError extends Data.TaggedError("MimeParseError")<{
  readonly reason:
    | "malformed-message"
    | "message-too-large"
    | "unsupported-message";
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class InboundManifestMismatchError extends Data.TaggedError(
  "InboundManifestMismatchError"
)<{
  readonly message: string;
}> {}

/** Marker preserved through Workflow retries so only exhausted transient failures are persisted. */
export class InboundRetryableStepError extends Error {
  readonly cause: unknown;

  constructor(cause: unknown) {
    super("Retryable inbound Workflow step failed");
    this.name = "InboundRetryableStepError";
    this.cause = cause;
  }
}
