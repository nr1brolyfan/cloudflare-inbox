/* oxlint-disable max-classes-per-file -- Organization mailbox schemas form one aggregate contract. */
import { UserIdSchema } from "@effect-auth/core/Identifiers";
import * as Schema from "effect/Schema";

import { MailboxId } from "#/modules/mailbox/domain/Mailbox";
import { UnixMillis, Version } from "#/shared/Temporal";

export const MailboxDisplayName = Schema.Trim.pipe(
  Schema.check(
    Schema.makeFilter<string>((value) =>
      [...value].length >= 1 && [...value].length <= 200
        ? undefined
        : "must contain between 1 and 200 Unicode code points"
    )
  ),
  Schema.brand("cloudflare-inbox/MailboxDisplayName")
);
export type MailboxDisplayName = Schema.Schema.Type<typeof MailboxDisplayName>;

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
