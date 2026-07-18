import * as Schema from "effect/Schema";

import { FolderId } from "./identifiers";
import { UnixMillis, Version } from "./primitives";

export class DeletedFolder extends Schema.Class<DeletedFolder>(
  "cloudflare-inbox/DeletedFolder"
)({
  id: FolderId,
  deletedAt: UnixMillis,
  version: Version,
}) {}
