import * as Schema from "effect/Schema";

import { LabelId } from "./identifiers";
import { UnixMillis, Version } from "./primitives";

export class DeletedLabel extends Schema.Class<DeletedLabel>(
  "cloudflare-inbox/DeletedLabel"
)({
  id: LabelId,
  deletedAt: UnixMillis,
  version: Version,
}) {}
