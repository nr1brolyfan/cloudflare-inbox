import { describe, expect, it } from "vitest";

import {
  directoryResponseChangeScopes,
  mailDataResponseChangeScopes,
} from "#/modules/mailbox/application/MailboxChangeProjection";

describe("mailbox change projection", () => {
  it("projects user-visible message, draft, outbound, and directory writes", () => {
    expect([
      mailDataResponseChangeScopes({
        _tag: "MessageMutated",
        value: {} as never,
      }),
      mailDataResponseChangeScopes({
        _tag: "DraftUpdated",
        value: {} as never,
      }),
      mailDataResponseChangeScopes({
        _tag: "OutboundScheduled",
        value: {} as never,
      }),
      directoryResponseChangeScopes({
        _tag: "LabelRenamed",
        value: {} as never,
      }),
    ]).toStrictEqual([
      ["messages", "navigation", "threads"],
      ["drafts", "navigation"],
      ["contacts", "drafts", "messages", "navigation", "outbound"],
      ["messages", "navigation", "threads"],
    ]);
  });

  it("does not publish reads, processing checkpoints, or domain failures", () => {
    expect([
      mailDataResponseChangeScopes({
        _tag: "MessagesListed",
        value: {} as never,
      }),
      mailDataResponseChangeScopes({
        _tag: "InboundProcessingRecorded",
        value: {} as never,
      }),
      mailDataResponseChangeScopes({
        _tag: "DomainError",
        operation: "list-messages",
        reason: "not-found",
        message: "missing",
        resourceType: "mailbox",
        resourceId: "mailbox-a",
      }),
    ]).toStrictEqual([[], [], []]);
  });
});
