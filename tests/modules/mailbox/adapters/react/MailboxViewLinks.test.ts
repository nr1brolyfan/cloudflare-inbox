import { describe, expect, it } from "vitest";

import {
  mailboxDraftHref,
  mailboxViewHref,
} from "#/modules/mailbox/adapters/react/MailboxViewLinks";

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
      "/mail/inbox?message=message-1&thread=thread-1&q=invoice&read=unread&starred=true&attachment=true&delivery=delivery-1"
    );
  });
});

describe(mailboxDraftHref, () => {
  it("opens a draft in its folder and preserves delivery tracking", () => {
    expect(mailboxDraftHref("drafts", "draft/one", "delivery/one")).toBe(
      "/mail/drafts/draft%2Fone?delivery=delivery%2Fone"
    );
  });
});
