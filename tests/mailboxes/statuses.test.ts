import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import { MailAddress } from "#/mailboxes/core";
import {
  canTransitionInbound,
  InboundProcessingSchema,
  InboundProcessingStatus,
} from "#/mailboxes/inbound";
import {
  MessageDetailSchema,
  MessageSummarySchema,
} from "#/mailboxes/messages";
import {
  canTransitionOutbound,
  OutboundDeliverySchema,
  OutboundDeliveryStatus,
  ResendOutboundInput,
  ResendOutboundResult,
  ScheduleOutboundInput,
  outboundUndoWindowMillis,
} from "#/mailboxes/outbound";

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

const outbound = (overrides: Readonly<Record<string, unknown>> = {}) => ({
  id: "delivery-1",
  mailboxId: "primary",
  messageId: "message-1",
  status: "scheduled",
  sendAt: 2000,
  attemptCount: 0,
  createdAt: 1000,
  updatedAt: 1000,
  version: 1,
  ...overrides,
});

const message = (overrides: Readonly<Record<string, unknown>> = {}) => ({
  id: "message-1",
  mailboxId: "primary",
  folderId: "inbox",
  threadId: "thread-1",
  direction: "inbound",
  subject: "Subject",
  recipients: [{ address: "owner@example.com" }],
  snippet: "Snippet",
  activityAt: 1000,
  read: false,
  starred: false,
  hasAttachments: false,
  labelIds: [],
  size: 100,
  version: 1,
  ...overrides,
});

const messageDetail = (overrides: Readonly<Record<string, unknown>> = {}) => ({
  ...message(),
  references: [],
  to: [{ address: "owner@example.com" }],
  cc: [],
  bcc: [],
  receivedAt: 1000,
  attachments: [],
  ...overrides,
});

describe("mail lifecycle statuses", () => {
  it("defines the fixed undo-send scheduling policy", () => {
    const input = Schema.decodeUnknownSync(ScheduleOutboundInput)({
      mailboxId: "primary",
      draftId: "draft-1",
      expectedVersion: 1,
      operationId: "schedule-1",
      sender: Schema.decodeUnknownSync(MailAddress)({
        address: "sender@example.com",
        displayName: "Sender",
      }),
      sendAt: 1,
    });

    expect(outboundUndoWindowMillis).toBe(10_000);
    expect(input).toStrictEqual({
      mailboxId: "primary",
      draftId: "draft-1",
      expectedVersion: 1,
      operationId: "schedule-1",
      sender: Schema.decodeUnknownSync(MailAddress)({
        address: "sender@example.com",
        displayName: "Sender",
      }),
    });
  });

  it("keeps transaction and AI details out of processing statuses", () => {
    expect([
      decodes(InboundProcessingStatus, "ready"),
      decodes(InboundProcessingStatus, "committed"),
      decodes(InboundProcessingStatus, "ai_pending"),
      decodes(OutboundDeliveryStatus, "accepted"),
      decodes(OutboundDeliveryStatus, "sent"),
      decodes(OutboundDeliveryStatus, "indeterminate"),
    ]).toStrictEqual([true, false, false, true, false, true]);
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
  ] as const)("validates inbound transition %s -> %s", (from, to, expected) => {
    expect(canTransitionInbound(from, to)).toBe(expected);
  });

  it.each([
    ["scheduled", "sending", true],
    ["scheduled", "cancelled", true],
    ["sending", "accepted", true],
    ["sending", "indeterminate", true],
    ["accepted", "delivered", true],
    ["indeterminate", "accepted", true],
    ["indeterminate", "failed", true],
    ["indeterminate", "sending", false],
    ["cancelled", "sending", false],
    ["delivered", "bounced", false],
    ["sending", "sending", false],
  ] as const)(
    "validates outbound transition %s -> %s",
    (from, to, expected) => {
      expect(canTransitionOutbound(from, to)).toBe(expected);
    }
  );

  it("enforces terminal inbound result invariants", () => {
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

  it("enforces outbound timestamps and failure invariants", () => {
    expect([
      decodes(OutboundDeliverySchema, outbound()),
      decodes(
        OutboundDeliverySchema,
        outbound({
          status: "accepted",
          providerMessageId: "provider-message-1",
          acceptedAt: 2100,
          updatedAt: 2100,
        })
      ),
      decodes(OutboundDeliverySchema, outbound({ status: "accepted" })),
      decodes(
        OutboundDeliverySchema,
        outbound({ status: "scheduled", acceptedAt: 2100 })
      ),
      decodes(
        OutboundDeliverySchema,
        outbound({
          status: "failed",
          updatedAt: 2200,
          failure: { code: "retry_exhausted", failedAt: 2200 },
        })
      ),
      decodes(OutboundDeliverySchema, outbound({ status: "failed" })),
      decodes(OutboundDeliverySchema, outbound({ status: "sending" })),
      decodes(
        OutboundDeliverySchema,
        outbound({
          status: "accepted",
          acceptedAt: 2100,
          updatedAt: 2100,
        })
      ),
      decodes(
        OutboundDeliverySchema,
        outbound({
          status: "failed",
          updatedAt: 2200,
          failure: { code: "retry_exhausted", failedAt: 1500 },
        })
      ),
    ]).toStrictEqual([
      true,
      true,
      false,
      false,
      true,
      false,
      false,
      false,
      false,
    ]);
  });

  it("associates delivery state only with outbound messages", () => {
    expect([
      decodes(MessageSummarySchema, message()),
      decodes(
        MessageSummarySchema,
        message({
          outboundDeliveryId: "delivery-1",
          deliveryStatus: "accepted",
        })
      ),
      decodes(
        MessageSummarySchema,
        message({ outboundDeliveryId: "delivery-1" })
      ),
      decodes(
        MessageSummarySchema,
        message({
          direction: "outbound",
          outboundDeliveryId: "delivery-1",
          deliveryStatus: "scheduled",
        })
      ),
      decodes(MessageSummarySchema, message({ direction: "outbound" })),
    ]).toStrictEqual([true, false, false, true, false]);
  });

  it("keeps message lifecycle metadata consistent with delivery state", () => {
    expect([
      decodes(MessageDetailSchema, messageDetail()),
      decodes(MessageDetailSchema, messageDetail({ acceptedAt: 1100 })),
      decodes(
        MessageDetailSchema,
        messageDetail({
          direction: "outbound",
          outboundDeliveryId: "delivery-1",
          deliveryStatus: "scheduled",
          receivedAt: undefined,
          scheduledAt: 1000,
        })
      ),
      decodes(
        MessageDetailSchema,
        messageDetail({
          direction: "outbound",
          outboundDeliveryId: "delivery-1",
          deliveryStatus: "accepted",
          receivedAt: undefined,
          scheduledAt: 1000,
        })
      ),
      decodes(
        MessageDetailSchema,
        messageDetail({
          direction: "outbound",
          outboundDeliveryId: "delivery-1",
          deliveryStatus: "accepted",
          receivedAt: undefined,
          scheduledAt: 1000,
          acceptedAt: 1100,
        })
      ),
      decodes(
        MessageDetailSchema,
        messageDetail({
          direction: "outbound",
          outboundDeliveryId: "delivery-1",
          deliveryStatus: "accepted",
          receivedAt: undefined,
          scheduledAt: 1200,
          acceptedAt: 1100,
        })
      ),
    ]).toStrictEqual([true, false, true, false, true, false]);
  });

  it("requires explicit duplicate-risk acknowledgement for resend", () => {
    expect([
      decodes(ResendOutboundInput, {
        mailboxId: "primary",
        outboundDeliveryId: "delivery-1",
        expectedVersion: 2,
        operationId: "resend-1",
        acknowledgeDuplicateRisk: true,
      }),
      decodes(ResendOutboundInput, {
        mailboxId: "primary",
        outboundDeliveryId: "delivery-1",
        expectedVersion: 2,
        operationId: "resend-1",
        acknowledgeDuplicateRisk: false,
      }),
      decodes(OutboundDeliverySchema, outbound({ resendOf: "delivery-1" })),
      decodes(
        OutboundDeliverySchema,
        outbound({ id: "delivery-2", resendOf: "delivery-1" })
      ),
      decodes(ResendOutboundResult, {
        sourceDeliveryId: "delivery-1",
        delivery: outbound({ id: "delivery-2", resendOf: "delivery-1" }),
      }),
      decodes(ResendOutboundResult, {
        sourceDeliveryId: "delivery-1",
        delivery: outbound({ id: "delivery-2" }),
      }),
    ]).toStrictEqual([true, false, false, true, true, false]);
  });
});
