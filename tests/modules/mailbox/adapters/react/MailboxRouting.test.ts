import { describe, expect, it } from "vitest";

import {
  decodeMailboxSearch,
  mailboxHref,
  mailboxSearchForPath,
} from "#/modules/mailbox/adapters/react/MailboxRouting";

describe("mailbox routing", () => {
  it.each([
    ["inbox", "/mail/inbox"],
    ["sent", "/mail/sent"],
    ["drafts", "/mail/drafts"],
    ["scheduled", "/mail/scheduled"],
    ["archive", "/mail/archive"],
    ["spam", "/mail/spam"],
    ["trash", "/mail/trash"],
  ])("maps the %s system folder to its canonical route", (folder, href) => {
    expect(mailboxHref(decodeMailboxSearch({ folder }))).toBe(href);
  });

  it("uses resource routes for custom folders and labels", () => {
    expect(
      mailboxHref(decodeMailboxSearch({ folder: "customer/success" }))
    ).toBe("/mail/folders/customer%2Fsuccess");
    expect(mailboxHref(decodeMailboxSearch({ label: "priority/high" }))).toBe(
      "/mail/labels/priority%2Fhigh"
    );
  });

  it("derives mailbox selection from a canonical path and keeps filters", () => {
    expect(
      mailboxSearchForPath(
        "/mail/labels/priority%2Fhigh",
        decodeMailboxSearch({ q: "invoice", read: "unread" })
      )
    ).toMatchObject({
      label: "priority/high",
      q: "invoice",
      read: "unread",
    });
  });

  it("models compose and draft editors as routes", () => {
    expect(
      mailboxSearchForPath("/mail/compose", decodeMailboxSearch({}))
    ).toMatchObject({ compose: "true" });
    expect(
      mailboxSearchForPath(
        "/mail/drafts/draft%2Fone",
        decodeMailboxSearch({ delivery: "delivery-1" })
      )
    ).toMatchObject({
      delivery: "delivery-1",
      draft: "draft/one",
      folder: "drafts",
    });
  });
});
