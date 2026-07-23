import * as Schema from "effect/Schema";

import { EmailAddress } from "#/modules/address-routing/domain/EmailAddress";

export class MailAddress extends Schema.Class<MailAddress>(
  "cloudflare-inbox/MailAddress"
)({
  address: EmailAddress,
  displayName: Schema.optional(Schema.String),
}) {}
