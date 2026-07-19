import * as Schema from "effect/Schema";

import {
  EmailAddress,
  MailAddress,
  MailboxAddressId,
  MailboxId,
  OperationId,
  UnixMillis,
  Version,
} from "./core";

export class MailboxAddress extends Schema.Class<MailboxAddress>(
  "cloudflare-inbox/MailboxAddress"
)({
  id: MailboxAddressId,
  mailboxId: MailboxId,
  address: MailAddress,
  isPrimary: Schema.Boolean,
  enabled: Schema.Boolean,
  createdAt: UnixMillis,
  updatedAt: UnixMillis,
  version: Version,
}) {}

export const MailboxAddressSchema = MailboxAddress.check(
  Schema.makeFilter((address) => {
    if (address.updatedAt < address.createdAt) {
      return "updatedAt cannot be earlier than createdAt";
    }
    return !address.isPrimary || address.enabled
      ? undefined
      : "the primary mailbox address must be enabled";
  })
);

export const ListMailboxAddressesInput = Schema.Struct({
  mailboxId: MailboxId,
});
export type ListMailboxAddressesInput = Schema.Schema.Type<
  typeof ListMailboxAddressesInput
>;

export const MailboxAddressList = Schema.Struct({
  mailboxId: MailboxId,
  items: Schema.Array(MailboxAddressSchema),
}).check(
  Schema.makeFilter((list) => {
    if (list.items.some((item) => item.mailboxId !== list.mailboxId)) {
      return "every address must belong to the listed mailbox";
    }
    return list.items.filter((item) => item.isPrimary).length <= 1
      ? undefined
      : "a mailbox can have at most one primary address";
  })
);
export type MailboxAddressList = Schema.Schema.Type<typeof MailboxAddressList>;

export const CreateMailboxAddressInput = Schema.Struct({
  mailboxId: MailboxId,
  operationId: OperationId,
  address: EmailAddress,
  displayName: Schema.optional(Schema.String),
});
export type CreateMailboxAddressInput = Schema.Schema.Type<
  typeof CreateMailboxAddressInput
>;

export const SetMailboxAddressEnabledInput = Schema.Struct({
  mailboxId: MailboxId,
  mailboxAddressId: MailboxAddressId,
  expectedVersion: Version,
  enabled: Schema.Boolean,
});
export type SetMailboxAddressEnabledInput = Schema.Schema.Type<
  typeof SetMailboxAddressEnabledInput
>;

export const SetPrimaryMailboxAddressInput = Schema.Struct({
  mailboxId: MailboxId,
  mailboxAddressId: MailboxAddressId,
  expectedVersion: Version,
});
export type SetPrimaryMailboxAddressInput = Schema.Schema.Type<
  typeof SetPrimaryMailboxAddressInput
>;

export const MailboxAddressMutationResult = MailboxAddressSchema;
export type MailboxAddressMutationResult = Schema.Schema.Type<
  typeof MailboxAddressMutationResult
>;
