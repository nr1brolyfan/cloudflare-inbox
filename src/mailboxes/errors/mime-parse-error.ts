import * as Data from "effect/Data";

export class MimeParseError extends Data.TaggedError("MimeParseError")<{
  readonly reason:
    | "malformed-message"
    | "message-too-large"
    | "unsupported-message";
  readonly message: string;
  readonly cause?: unknown;
}> {}
