import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  OutboundEmailAttachment,
  OutboundEmailMessage,
} from "#/modules/mailbox/ports/OutboundEmailProvider";

const address = (value: string) => ({ address: value });

describe("outbound email provider contract", () => {
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
