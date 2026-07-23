import * as Data from "effect/Data";

export class MailboxRepositoryError extends Data.TaggedError(
  "MailboxRepositoryError"
)<{
  readonly operation:
    | "read"
    | "write"
    | "transaction"
    | "migrate"
    | "reconcile";
  readonly commitState: "not-committed" | "committed" | "unknown";
  readonly message: string;
  readonly cause: unknown;
  readonly transient?: boolean;
}> {
  get retryable(): boolean {
    return this.transient ?? this.commitState === "not-committed";
  }
}
