import * as Schema from "effect/Schema";

import { LabelId, MailboxId } from "./identifiers";
import { LabelName, UnixMillis, Version } from "./primitives";

export class Label extends Schema.Class<Label>("cloudflare-inbox/Label")({
  id: LabelId,
  mailboxId: MailboxId,
  name: LabelName,
  createdAt: UnixMillis,
  updatedAt: UnixMillis,
  version: Version,
}) {}

export const LabelSchema = Label.check(
  Schema.makeFilter((label) =>
    label.updatedAt >= label.createdAt
      ? undefined
      : "updatedAt cannot be earlier than createdAt"
  )
);
