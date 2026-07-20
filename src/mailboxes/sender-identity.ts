import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { MailboxId } from "./core";
import type { MailAddress } from "./core";

export class MailboxSenderIdentityError extends Schema.TaggedErrorClass<MailboxSenderIdentityError>(
  "cloudflare-inbox/MailboxSenderIdentityError"
)("MailboxSenderIdentityError", {
  cause: Schema.optional(Schema.Defect()),
  mailboxId: MailboxId,
  message: Schema.String,
  reason: Schema.Literals(["not-found", "storage"]),
}) {}

export interface MailboxSenderIdentity {
  readonly resolve: (
    mailboxId: MailboxId
  ) => Effect.Effect<MailAddress, MailboxSenderIdentityError>;
}

/** Trusted canonical From identity selected independently of transport. */
export const MailboxSenderIdentity = Context.Service<MailboxSenderIdentity>(
  "cloudflare-inbox/MailboxSenderIdentity"
);
