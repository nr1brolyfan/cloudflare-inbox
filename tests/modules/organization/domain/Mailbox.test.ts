/* oxlint-disable vitest/max-expects -- Receipt tests cover the closed bootstrap and rename invariant matrix together. */
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  BootstrapOwnerMailboxCommand,
  MailboxAdministrationReceiptSchema,
  RenameMailboxCommand,
} from "#/modules/organization/application/MailboxAdministration";
import { MailboxDisplayName } from "#/modules/organization/domain/Mailbox";

const decodeSucceeds = <S extends Schema.ConstraintDecoder<unknown, never>>(
  schema: S,
  input: unknown
) => Exit.isSuccess(Schema.decodeUnknownExit(schema)(input));

describe("organization mailbox contracts", () => {
  it("decodes transport-neutral mailbox administration commands", () => {
    expect(
      Schema.decodeUnknownSync(BootstrapOwnerMailboxCommand)({
        displayName: "  Inbox  ",
        operationId: "00000000-0000-4000-8000-000000000010",
      })
    ).toStrictEqual({
      displayName: "Inbox",
      operationId: "00000000-0000-4000-8000-000000000010",
    });
    expect(
      Schema.decodeUnknownSync(RenameMailboxCommand)({
        displayName: "  Recruiting  ",
        expectedVersion: 1,
        mailboxId: "primary",
        operationId: "00000000-0000-4000-8000-000000000011",
      })
    ).toStrictEqual({
      displayName: "Recruiting",
      expectedVersion: 1,
      mailboxId: "primary",
      operationId: "00000000-0000-4000-8000-000000000011",
    });
    expect(
      decodeSucceeds(RenameMailboxCommand, {
        displayName: "Recruiting",
        expectedVersion: 1,
        mailboxId: " primary ",
        operationId: "00000000-0000-4000-8000-000000000011",
      })
    ).toBeFalsy();
  });

  it("validates normalized Unicode display names", () => {
    expect(Schema.decodeUnknownSync(MailboxDisplayName)("  Inbox  ")).toBe(
      "Inbox"
    );
    expect(decodeSucceeds(MailboxDisplayName, "😀".repeat(200))).toBeTruthy();
    expect(decodeSucceeds(MailboxDisplayName, "😀".repeat(201))).toBeFalsy();
  });

  it("reuses the mailbox name invariant at the administration boundary", () => {
    expect(
      Schema.decodeUnknownSync(BootstrapOwnerMailboxCommand)({
        displayName: "  Team inbox  ",
        operationId: "00000000-0000-4000-8000-000000000010",
      })
    ).toStrictEqual({
      displayName: "Team inbox",
      operationId: "00000000-0000-4000-8000-000000000010",
    });
    expect(
      decodeSucceeds(BootstrapOwnerMailboxCommand, {
        displayName: "x".repeat(201),
        operationId: "00000000-0000-4000-8000-000000000010",
      })
    ).toBeFalsy();
    expect(
      decodeSucceeds(BootstrapOwnerMailboxCommand, {
        displayName: "Team inbox",
        operationId: "owner@example.test",
      })
    ).toBeFalsy();
  });

  it("validates typed mailbox administration receipt invariants", () => {
    const receipt = {
      actorUserId: "user-a",
      committedAt: 2000,
      displayName: "Recruiting",
      expectedVersion: 1,
      mailboxId: "primary",
      operationId: "00000000-0000-4000-8000-000000000011",
      operationKind: "rename",
      result: {
        createdAt: 1000,
        createdByUserId: "user-a",
        displayName: "Recruiting",
        id: "primary",
        status: "active",
        updatedAt: 2000,
        version: 2,
      },
      schemaVersion: 1,
    } as const;

    expect(
      decodeSucceeds(MailboxAdministrationReceiptSchema, receipt)
    ).toBeTruthy();
    expect(
      decodeSucceeds(MailboxAdministrationReceiptSchema, {
        ...receipt,
        expectedVersion: undefined,
      })
    ).toBeFalsy();
    expect(
      decodeSucceeds(MailboxAdministrationReceiptSchema, {
        ...receipt,
        result: { ...receipt.result, displayName: "Other" },
      })
    ).toBeFalsy();

    const bootstrapReceipt = {
      actorUserId: "user-a",
      committedAt: 1000,
      displayName: "Inbox",
      mailboxId: "primary",
      operationId: "00000000-0000-4000-8000-000000000010",
      operationKind: "bootstrap-owner",
      result: {
        createdAt: 1000,
        createdByUserId: "user-a",
        displayName: "Inbox",
        id: "primary",
        status: "active",
        updatedAt: 1000,
        version: 1,
      },
      schemaVersion: 1,
    } as const;
    expect(
      decodeSucceeds(MailboxAdministrationReceiptSchema, bootstrapReceipt)
    ).toBeTruthy();
    expect(
      decodeSucceeds(MailboxAdministrationReceiptSchema, {
        ...bootstrapReceipt,
        initialAddress: "inbox@example.test",
        schemaVersion: 2,
      })
    ).toBeTruthy();
    for (const forged of [
      {
        ...bootstrapReceipt,
        result: { ...bootstrapReceipt.result, version: 2 },
      },
      {
        ...bootstrapReceipt,
        actorUserId: "user-b",
      },
      {
        ...bootstrapReceipt,
        committedAt: 1001,
      },
      {
        ...bootstrapReceipt,
        result: { ...bootstrapReceipt.result, updatedAt: 1001 },
      },
    ]) {
      expect(
        decodeSucceeds(MailboxAdministrationReceiptSchema, forged)
      ).toBeFalsy();
    }
  });
});
