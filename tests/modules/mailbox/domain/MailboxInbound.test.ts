import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  canTransitionInbound,
  InboundProcessingSchema,
  InboundProcessingStatus,
  ParsedInboundMessageV1,
} from "#/modules/mailbox/domain/MailboxInbound";

const decodes = <S extends Schema.ConstraintDecoder<unknown, never>>(
  schema: S,
  value: unknown
) => Exit.isSuccess(Schema.decodeUnknownExit(schema)(value));

const inbound = (overrides: Readonly<Record<string, unknown>> = {}) => ({
  id: "ingest-1",
  mailboxId: "primary",
  status: "received",
  attemptCount: 0,
  createdAt: 1000,
  updatedAt: 1000,
  version: 1,
  ...overrides,
});

describe("mailbox inbound contracts", () => {
  it("keeps transaction and AI details out of processing statuses", () => {
    expect([
      decodes(InboundProcessingStatus, "ready"),
      decodes(InboundProcessingStatus, "committed"),
      decodes(InboundProcessingStatus, "ai_pending"),
    ]).toStrictEqual([true, false, false]);
  });

  it.each([
    ["received", "raw_stored", true],
    ["raw_stored", "parsing", true],
    ["parsing", "attachments_stored", true],
    ["attachments_stored", "ready", true],
    ["parsing", "failed", true],
    ["ready", "parsing", false],
    ["failed", "received", false],
    ["raw_stored", "raw_stored", true],
  ] as const)("validates transition %s -> %s", (from, to, expected) => {
    expect(canTransitionInbound(from, to)).toBe(expected);
  });

  it("enforces terminal result invariants", () => {
    expect([
      decodes(
        InboundProcessingSchema,
        inbound({ status: "ready", messageId: "message-1" })
      ),
      decodes(InboundProcessingSchema, inbound({ status: "ready" })),
      decodes(
        InboundProcessingSchema,
        inbound({
          status: "failed",
          updatedAt: 1100,
          failure: {
            code: "malformed_message",
            failedAt: 1100,
            replayable: true,
          },
        })
      ),
      decodes(
        InboundProcessingSchema,
        inbound({ status: "failed", messageId: "message-1" })
      ),
    ]).toStrictEqual([true, false, true, false]);
  });

  it("keeps parsed MIME manifests transport-neutral and attachment-ordered", () => {
    const parsed = Schema.decodeUnknownSync(ParsedInboundMessageV1)({
      attachments: [
        {
          attachmentObjectKey: "must-not-leak",
          content: new Uint8Array([1, 2, 3]),
          disposition: "attachment",
          index: 0,
          mimeType: "application/pdf",
          size: 3,
        },
      ],
      bcc: [],
      cc: [],
      formatVersion: 1,
      references: [],
      subject: "Manifest",
      to: [],
    });
    const encoded = Schema.encodeSync(ParsedInboundMessageV1)(parsed);

    expect(encoded.attachments).toStrictEqual([
      {
        disposition: "attachment",
        index: 0,
        mimeType: "application/pdf",
        size: 3,
      },
    ]);
    expect(
      decodes(ParsedInboundMessageV1, {
        ...encoded,
        attachments: [{ ...encoded.attachments[0], index: 1 }],
      })
    ).toBeFalsy();
  });
});
