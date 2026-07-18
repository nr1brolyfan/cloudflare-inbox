import * as Schema from "effect/Schema";

import { AttachmentId, MessageId } from "./identifiers";
import { ByteSize, FileName, MimeType } from "./primitives";

export class AttachmentMetadata extends Schema.Class<AttachmentMetadata>(
  "cloudflare-inbox/AttachmentMetadata"
)({
  id: AttachmentId,
  messageId: MessageId,
  fileName: FileName,
  mimeType: MimeType,
  size: ByteSize,
  contentId: Schema.optional(Schema.String),
  disposition: Schema.Literals(["attachment", "inline"]),
}) {}
