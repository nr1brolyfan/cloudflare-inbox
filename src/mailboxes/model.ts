import { UserIdSchema } from "@effect-auth/core/Identifiers";
import * as Schema from "effect/Schema";

import { MailboxId } from "./identifiers";
import { MailboxDisplayName, UnixMillis, Version } from "./primitives";

export class MailboxRecord extends Schema.Class<MailboxRecord>(
  "cloudflare-inbox/MailboxRecord"
)({
  createdAt: UnixMillis,
  createdByUserId: UserIdSchema,
  displayName: MailboxDisplayName,
  id: MailboxId,
  status: Schema.Literal("active"),
  updatedAt: UnixMillis,
  version: Version,
}) {}

export const MailboxRecordSchema = MailboxRecord.check(
  Schema.makeFilter((mailbox) =>
    mailbox.updatedAt >= mailbox.createdAt
      ? undefined
      : "updatedAt cannot be earlier than createdAt"
  )
);
