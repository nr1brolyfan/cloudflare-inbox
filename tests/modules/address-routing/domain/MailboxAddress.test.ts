import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  CreateMailboxAddressInput,
  MailboxAddressList,
  MailboxAddressSchema,
} from "#/modules/address-routing/domain/MailboxAddress";

const decodeSucceeds = <S extends Schema.ConstraintDecoder<unknown, never>>(
  schema: S,
  input: unknown
) => Exit.isSuccess(Schema.decodeUnknownExit(schema)(input));

describe("mailbox address", () => {
  it("validates commands and primary-address invariants", () => {
    expect(
      decodeSucceeds(CreateMailboxAddressInput, {
        mailboxId: "primary",
        operationId: "alias-1",
        address: "alias@example.",
      })
    ).toBeFalsy();
    expect(
      decodeSucceeds(MailboxAddressSchema, {
        id: "alias-1",
        mailboxId: "primary",
        address: { address: "owner@example.com" },
        isPrimary: true,
        enabled: false,
        createdAt: 1000,
        updatedAt: 1000,
        version: 1,
      })
    ).toBeFalsy();
    expect(
      decodeSucceeds(MailboxAddressList, {
        mailboxId: "primary",
        items: [
          {
            id: "alias-1",
            mailboxId: "primary",
            address: { address: "owner@example.com" },
            isPrimary: true,
            enabled: true,
            createdAt: 1000,
            updatedAt: 1000,
            version: 1,
          },
          {
            id: "alias-2",
            mailboxId: "primary",
            address: { address: "alias@example.com" },
            isPrimary: true,
            enabled: true,
            createdAt: 1000,
            updatedAt: 1000,
            version: 1,
          },
        ],
      })
    ).toBeFalsy();
  });
});
