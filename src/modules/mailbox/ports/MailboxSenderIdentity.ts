/* oxlint-disable max-classes-per-file -- Port error and service form one capability contract. */
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { MailboxId } from "#/mailboxes/core";
import type { MailAddress } from "#/mailboxes/core";

export class MailboxSenderIdentityError extends Schema.TaggedErrorClass<MailboxSenderIdentityError>(
  "cloudflare-inbox/MailboxSenderIdentityError"
)("MailboxSenderIdentityError", {
  cause: Schema.optional(Schema.Defect()),
  mailboxId: MailboxId,
  message: Schema.String,
  reason: Schema.Literals(["not-found", "storage"]),
}) {}

export interface MailboxSenderIdentityService {
  readonly resolve: (
    mailboxId: MailboxId
  ) => Effect.Effect<MailAddress, MailboxSenderIdentityError>;
}

/** Trusted canonical From identity selected independently of transport. */
export class MailboxSenderIdentity extends Context.Service<
  MailboxSenderIdentity,
  MailboxSenderIdentityService
>()("cloudflare-inbox/MailboxSenderIdentity") {}
