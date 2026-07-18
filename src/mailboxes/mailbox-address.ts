import * as Schema from "effect/Schema";

import { MailboxAddressId, MailboxId } from "./identifiers";
import { MailAddress } from "./mail-address";
import { UnixMillis, Version } from "./primitives";

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
