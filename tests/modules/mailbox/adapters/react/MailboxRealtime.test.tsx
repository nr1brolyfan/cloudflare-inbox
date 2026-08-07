// @vitest-environment jsdom

import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { invalidateMailboxChangedEvent } from "#/modules/mailbox/adapters/react/MailboxRealtime";

describe(invalidateMailboxChangedEvent, () => {
  it("invalidates only matching session and mailbox resources", async () => {
    const client = new QueryClient();
    const matchingMessages = ["mailbox", "messages", "session-a", "mailbox-a"];
    const otherSession = ["mailbox", "messages", "session-b", "mailbox-a"];
    const matchingNavigation = ["mailbox", "navigation", "user-a", "session-a"];
    const activeDraft = ["mailbox", "draft", "session-a", "mailbox-a", "d-1"];
    for (const key of [
      matchingMessages,
      otherSession,
      matchingNavigation,
      activeDraft,
    ]) {
      client.setQueryData(key, { value: true });
    }

    await invalidateMailboxChangedEvent(
      client,
      { mailboxId: "mailbox-a", sessionId: "session-a", userId: "user-a" },
      {
        _tag: "MailboxChanged",
        formatVersion: 1,
        scopes: ["drafts", "messages", "navigation"],
      }
    );

    expect({
      activeDraft: client.getQueryState(activeDraft)?.isInvalidated,
      matchingMessages: client.getQueryState(matchingMessages)?.isInvalidated,
      matchingNavigation:
        client.getQueryState(matchingNavigation)?.isInvalidated,
      otherSession: client.getQueryState(otherSession)?.isInvalidated,
    }).toStrictEqual({
      activeDraft: false,
      matchingMessages: true,
      matchingNavigation: true,
      otherSession: false,
    });
  });
});
