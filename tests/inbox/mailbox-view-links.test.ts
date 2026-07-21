import { describe, expect, it } from "vitest";

import { mailboxDraftHref, mailboxViewHref } from "#/inbox/mailbox-view-links";

describe(mailboxViewHref, () => {
  it("preserves an outbound delivery with view and message state", () => {
    expect(
      mailboxViewHref({ folder: "inbox" }, "thread-1", "message-1", {
        delivery: "delivery-1",
        hasAttachment: true,
        query: "invoice",
        read: "unread",
        starred: true,
      })
    ).toBe(
      "/inbox?folder=inbox&thread=thread-1&message=message-1&q=invoice&read=unread&starred=true&attachment=true&delivery=delivery-1"
    );
  });
});

describe(mailboxDraftHref, () => {
  it("opens a draft in its folder and preserves delivery tracking", () => {
    expect(mailboxDraftHref("drafts", "draft/one", "delivery/one")).toBe(
      "/inbox?draft=draft%2Fone&folder=drafts&delivery=delivery%2Fone"
    );
  });
});
