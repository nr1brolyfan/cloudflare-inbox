import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import { MailboxArchiveRecipient } from "#/modules/mailbox/contracts/MailboxArchiveConfig";
import {
  canTransitionOutbound,
  effectiveOutboundBcc,
  OutboundDeliverySchema,
  OutboundDeliveryStatus,
  ResendOutboundInput,
  ResendOutboundResult,
  ScheduleOutboundInput,
  outboundUndoWindowMillis,
} from "#/modules/mailbox/domain/MailboxOutbound";
import { MailAddress } from "#/shared/MailAddress";

const decodes = <S extends Schema.ConstraintDecoder<unknown, never>>(
  schema: S,
  value: unknown
) => Exit.isSuccess(Schema.decodeUnknownExit(schema)(value));

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

const address = (value: string) =>
  Schema.decodeUnknownSync(MailAddress)({ address: value });
const archive = (value: string) =>
  Schema.decodeUnknownSync(MailboxArchiveRecipient)(value);

describe("mailbox outbound contracts", () => {
  it("defines the fixed undo-send scheduling policy", () => {
    const input = Schema.decodeUnknownSync(ScheduleOutboundInput)({
      confirmation: "explicit-user-action",
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
      confirmation: "explicit-user-action",
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

  it("keeps unsupported lifecycle details out of delivery statuses", () => {
    expect([
      decodes(OutboundDeliveryStatus, "accepted"),
      decodes(OutboundDeliveryStatus, "sent"),
      decodes(OutboundDeliveryStatus, "indeterminate"),
    ]).toStrictEqual([true, false, true]);
  });

  it("appends a distinct archive recipient after user BCC with SMTP identity dedupe", () => {
    const userBcc = [address("blind@example.com")];

    const namedBcc = [
      Schema.decodeUnknownSync(MailAddress)({
        address: "Blind@Example.COM",
        displayName: "User supplied name",
      }),
    ];
    expect({
      distinct: effectiveOutboundBcc(
        [address("Visible@Example.COM")],
        [address("copy@example.com")],
        userBcc,
        archive("archive@example.net")
      ),
      toDomainCaseCollision: effectiveOutboundBcc(
        [address("Visible@Example.COM")],
        [],
        userBcc,
        archive("Visible@example.com")
      ),
      ccCollision: effectiveOutboundBcc(
        [],
        [address("copy@EXAMPLE.COM")],
        userBcc,
        archive("copy@example.com")
      ),
      userBccDisplayCollision: effectiveOutboundBcc(
        [],
        [],
        namedBcc,
        archive("Blind@example.com")
      ),
      localCaseDistinct: effectiveOutboundBcc(
        [address("visible@example.com")],
        [],
        userBcc,
        archive("Visible@example.com")
      ),
    }).toStrictEqual({
      distinct: [address("blind@example.com"), address("archive@example.net")],
      toDomainCaseCollision: userBcc,
      ccCollision: userBcc,
      userBccDisplayCollision: namedBcc,
      localCaseDistinct: [
        address("blind@example.com"),
        address("Visible@example.com"),
      ],
    });
  });

  it.each([
    ["scheduled", "sending", true],
    ["scheduled", "cancelled", true],
    ["sending", "scheduled", true],
    ["sending", "accepted", true],
    ["sending", "indeterminate", true],
    ["accepted", "delivered", true],
    ["indeterminate", "accepted", true],
    ["indeterminate", "failed", true],
    ["indeterminate", "sending", false],
    ["cancelled", "sending", false],
    ["delivered", "bounced", false],
    ["sending", "sending", false],
  ] as const)("validates transition %s -> %s", (from, to, expected) => {
    expect(canTransitionOutbound(from, to)).toBe(expected);
  });

  it("enforces timestamps and failure invariants", () => {
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

  it("requires explicit duplicate-risk acknowledgement for resend", () => {
    expect([
      decodes(ResendOutboundInput, {
        confirmation: "explicit-user-action",
        mailboxId: "primary",
        outboundDeliveryId: "delivery-1",
        expectedVersion: 2,
        operationId: "resend-1",
        acknowledgeDuplicateRisk: true,
      }),
      decodes(ResendOutboundInput, {
        confirmation: "explicit-user-action",
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
