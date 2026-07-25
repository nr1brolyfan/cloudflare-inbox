import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  DeliveryIndeterminateError,
  DeliveryRejectedError,
  DeliveryTemporaryFailureError,
  OutboundEmailAttachment,
  OutboundEmailMessage,
} from "#/modules/mailbox/ports/OutboundEmailProvider";

const address = (value: string) => ({ address: value });

describe("outbound email provider contract", () => {
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

  it("accepts one through fifty combined recipients and either body form", () => {
    const one = Schema.decodeUnknownSync(OutboundEmailMessage)({
      attachments: [],
      bcc: [address("recipient@example.com")],
      cc: [],
      html: "<p>Hello</p>",
      sender: address("sender@example.com"),
      subject: "Hello",
      to: [],
    });
    const fifty = Schema.decodeUnknownSync(OutboundEmailMessage)({
      attachments: [],
      bcc: Array.from({ length: 20 }, (_, index) =>
        address(`bcc-${index}@example.com`)
      ),
      cc: Array.from({ length: 20 }, (_, index) =>
        address(`cc-${index}@example.com`)
      ),
      sender: address("sender@example.com"),
      subject: "Hello",
      text: "Hello",
      to: Array.from({ length: 10 }, (_, index) =>
        address(`to-${index}@example.com`)
      ),
    });

    expect(one.bcc).toHaveLength(1);
    expect(fifty.to.length + fifty.cc.length + fifty.bcc.length).toBe(50);
  });

  it("accepts unique threading References ending in the immediate parent", () => {
    const message = Schema.decodeUnknownSync(OutboundEmailMessage)({
      attachments: [],
      bcc: [],
      cc: [],
      sender: address("sender@example.com"),
      subject: "Reply",
      text: "Reply",
      threading: {
        inReplyTo: "<parent@example.com>",
        references: ["<root@example.com>", "<parent@example.com>"],
      },
      to: [address("recipient@example.com")],
    });

    expect(message.threading?.references).toStrictEqual([
      "<root@example.com>",
      "<parent@example.com>",
    ]);
  });

  it.each([
    [
      "duplicate IDs",
      ["<root@example.com>", "<parent@example.com>", "<parent@example.com>"],
      /unique/u,
    ],
    [
      "a non-final parent",
      ["<parent@example.com>", "<root@example.com>"],
      /end with/u,
    ],
  ])("rejects threading References with %s", (_, references, expected) => {
    expect(() =>
      Schema.decodeUnknownSync(OutboundEmailMessage)({
        attachments: [],
        bcc: [],
        cc: [],
        sender: address("sender@example.com"),
        subject: "Reply",
        text: "Reply",
        threading: { inReplyTo: "<parent@example.com>", references },
        to: [address("recipient@example.com")],
      })
    ).toThrow(expected);
  });

  it.each([
    ["without recipients", { bcc: [], cc: [], text: "Hello", to: [] }],
    [
      "with more than fifty recipients",
      {
        bcc: [],
        cc: [],
        text: "Hello",
        to: Array.from({ length: 51 }, (_, index) =>
          address(`recipient-${index}@example.com`)
        ),
      },
    ],
    ["without a body", { bcc: [], cc: [], to: [address("to@example.com")] }],
  ])("rejects messages %s", (_, fields) => {
    expect(() =>
      Schema.decodeUnknownSync(OutboundEmailMessage)({
        attachments: [],
        sender: address("sender@example.com"),
        subject: "Hello",
        ...fields,
      })
    ).toThrow(/recipient|body/u);
  });

  it("requires content IDs exactly for inline attachments", () => {
    const base = {
      content: new Uint8Array([1]),
      fileName: "pixel.png",
      mimeType: "image/png",
    };
    const inline = Schema.decodeUnknownSync(OutboundEmailAttachment)({
      ...base,
      contentId: "pixel-1",
      disposition: "inline",
    });
    const regular = Schema.decodeUnknownSync(OutboundEmailAttachment)({
      ...base,
      disposition: "attachment",
    });

    expect(inline.contentId).toBe("pixel-1");
    expect(regular.contentId).toBeUndefined();
    expect(() =>
      Schema.decodeUnknownSync(OutboundEmailAttachment)({
        ...base,
        disposition: "inline",
      })
    ).toThrow(/contentId/u);
    expect(() =>
      Schema.decodeUnknownSync(OutboundEmailAttachment)({
        ...base,
        contentId: "pixel-1",
        disposition: "attachment",
      })
    ).toThrow(/contentId/u);
  });
});
