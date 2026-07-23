import { describe, expect, it } from "vitest";

import { MailboxRepositoryError } from "#/modules/mailbox/ports/MailboxRepositoryError";

describe("mailbox repository error", () => {
  it("retries writes only when non-commit is known", () => {
    const cause = new Error("sqlite unavailable");
    const notCommitted = new MailboxRepositoryError({
      operation: "transaction",
      commitState: "not-committed",
      message: "Mailbox transaction failed",
      cause,
    });
    const committed = new MailboxRepositoryError({
      operation: "transaction",
      commitState: "committed",
      message: "Mailbox response persistence failed",
      cause,
    });
    const unknown = new MailboxRepositoryError({
      operation: "transaction",
      commitState: "unknown",
      message: "Mailbox commit outcome is unknown",
      cause,
    });

    expect([
      notCommitted.retryable,
      committed.retryable,
      unknown.retryable,
    ]).toStrictEqual([true, false, false]);
  });
});
