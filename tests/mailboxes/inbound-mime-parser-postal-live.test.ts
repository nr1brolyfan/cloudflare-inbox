import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { describe, expect, it } from "vitest";

import { InboundMimeParser } from "#/mailboxes/inbound";
import type { InboundMimeParserConfig as InboundMimeParserConfigShape } from "#/mailboxes/inbound-mime-parser-postal-live";
import {
  InboundMimeParserConfig,
  InboundMimeParserPostalMimeLive,
} from "#/mailboxes/inbound-mime-parser-postal-live";

const defaultConfig: InboundMimeParserConfigShape = {
  maximumAddresses: 256,
  maximumAttachments: 256,
  maximumHeadersBytes: 256 * 1024,
  maximumNestingDepth: 64,
  maximumRawBytes: 10 * 1024 * 1024,
  maximumReferences: 100,
  maximumWorkflowResultBytes: 768 * 1024,
};

const raw = (source: string) => new TextEncoder().encode(source).buffer;

const runParse = (
  source: string,
  overrides: Partial<InboundMimeParserConfigShape> = {}
) =>
  Effect.runPromise(
    InboundMimeParser.pipe(
      Effect.flatMap((parser) => parser.parse(raw(source))),
      Effect.provide(
        InboundMimeParserPostalMimeLive.pipe(
          Layer.provide(
            Layer.succeed(
              InboundMimeParserConfig,
              InboundMimeParserConfig.of({ ...defaultConfig, ...overrides })
            )
          )
        )
      )
    )
  );

describe("PostalMime inbound parser", () => {
  it("maps decoded headers, addresses, threading, and text", async () => {
    const result = await runParse(
      `From: =?UTF-8?Q?Sender_=E2=9C=93?= <sender@example.test>\r
To: Owner <owner@example.test>\r
Cc: invalid-address, Team <team@example.test>\r
Subject: =?UTF-8?Q?Hello_=E2=9C=93?=\r
Message-ID: <message-1@example.test>\r
In-Reply-To: <parent@example.test>\r
References: <root@example.test> <parent@example.test>\r
Date: Thu, 01 Jan 1970 00:00:00 +0000\r
Content-Type: text/plain; charset=utf-8\r
Content-Transfer-Encoding: quoted-printable\r
\r
Hello=20world`
    );

    expect(result).toMatchObject({
      attachments: [],
      cc: [{ address: "team@example.test", displayName: "Team" }],
      formatVersion: 1,
      headerDate: 0,
      inReplyTo: "<parent@example.test>",
      references: ["<root@example.test>", "<parent@example.test>"],
      rfcMessageId: "<message-1@example.test>",
      sender: { address: "sender@example.test", displayName: "Sender ✓" },
      subject: "Hello ✓",
      to: [{ address: "owner@example.test", displayName: "Owner" }],
    });
    expect(result.textBody).toContain("Hello world");
  });

  it("emits attachment metadata without binary content", async () => {
    const result = await runParse(
      `From: sender@example.test\r
To: owner@example.test\r
Subject: Related\r
Content-Type: multipart/related; boundary="boundary"\r
\r
--boundary\r
Content-Type: text/html; charset=utf-8\r
\r
<img src="cid:image-1">\r
--boundary\r
Content-Type: image/png\r
Content-ID: <image-1>\r
Content-Disposition: inline; filename="image.png"\r
Content-Transfer-Encoding: base64\r
\r
AQID\r
--boundary--`
    );

    expect(result.attachments).toStrictEqual([
      {
        contentId: "image-1",
        disposition: "inline",
        fileName: "image.png",
        index: 0,
        mimeType: "image/png",
        size: 3,
      },
    ]);
    expect(result.attachments[0]).not.toHaveProperty("content");
    expect(result.htmlBody).toContain("cid:image-1");
  });

  it("rejects raw messages above the configured memory limit", async () => {
    const failure = await runParse("Subject: Hello\r\n\r\nBody", {
      maximumRawBytes: 2,
    }).catch((error: unknown) => error);

    expect(failure).toMatchObject({
      _tag: "MimeParseError",
      reason: "message-too-large",
    });
  });

  it("rejects parsed manifests above the Workflow result budget", async () => {
    const failure = await runParse("Subject: Hello\r\n\r\nLong body", {
      maximumWorkflowResultBytes: 10,
    }).catch((error: unknown) => error);

    expect(failure).toMatchObject({
      _tag: "MimeParseError",
      reason: "message-too-large",
    });
  });

  it("maps schema-invalid parsed fields to malformed_message", async () => {
    const failure = await runParse(
      `Subject: ${"x".repeat(999)}\r\n\r\nBody`
    ).catch((error: unknown) => error);

    expect(failure).toMatchObject({
      _tag: "MimeParseError",
      reason: "malformed-message",
    });
  });
});
