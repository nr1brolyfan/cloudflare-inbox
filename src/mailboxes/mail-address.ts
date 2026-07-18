import * as Schema from "effect/Schema";

import { EmailAddress } from "./primitives";

export class MailAddress extends Schema.Class<MailAddress>(
  "cloudflare-inbox/MailAddress"
)({
  address: EmailAddress,
  displayName: Schema.optional(Schema.String),
}) {}
