import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  MailboxChangedEvent,
  mailboxChangedEvent,
} from "#/modules/mailbox/domain/MailboxRealtime";

describe("mailbox changed event contract", () => {
  it("normalizes duplicate scopes without exposing mailbox content", () => {
    const event = mailboxChangedEvent(["messages", "navigation", "messages"]);

    expect(Schema.encodeSync(MailboxChangedEvent)(event)).toStrictEqual({
      _tag: "MailboxChanged",
      formatVersion: 1,
      scopes: ["messages", "navigation"],
    });
  });

  it("rejects unknown protocol versions and scopes", () => {
    const decode = Schema.decodeUnknownOption(MailboxChangedEvent);

    expect(
      decode({ _tag: "MailboxChanged", formatVersion: 2, scopes: [] })._tag
    ).toBe("None");
    expect(
      decode({
        _tag: "MailboxChanged",
        formatVersion: 1,
        scopes: ["message-content"],
      })._tag
    ).toBe("None");
  });
});
