import { describe, expect, it } from "vitest";

import {
  DeliveryIndeterminateError,
  DeliveryRejectedError,
  DeliveryTemporaryFailureError,
  MailboxRepositoryError,
} from "./errors";

describe("mail domain errors", () => {
  it("retries repository writes only when non-commit is known", () => {
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

  it("keeps provider outcomes distinct in the error channel", () => {
    const cause = new Error("provider result");
    const rejected = new DeliveryRejectedError({
      reason: "provider-rejected",
      message: "Provider rejected the message",
      cause,
    });
    const temporary = new DeliveryTemporaryFailureError({
      message: "Provider proved that the message was not accepted",
      cause,
    });
    const indeterminate = new DeliveryIndeterminateError({
      message: "Provider acceptance could not be determined",
      cause,
    });

    expect([rejected._tag, temporary._tag, indeterminate._tag]).toStrictEqual([
      "DeliveryRejectedError",
      "DeliveryTemporaryFailureError",
      "DeliveryIndeterminateError",
    ]);
  });
});
