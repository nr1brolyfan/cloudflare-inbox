import * as Schema from "effect/Schema";

export class MailboxRecord extends Schema.Class<MailboxRecord>(
  "cloudflare-inbox/MailboxRecord"
)({
  createdAt: Schema.Number,
  createdByUserId: Schema.String,
  displayName: Schema.String,
  id: Schema.String,
  status: Schema.Literal("active"),
  updatedAt: Schema.Number,
  version: Schema.Number,
}) {}
