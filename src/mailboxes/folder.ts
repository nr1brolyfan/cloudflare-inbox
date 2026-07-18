import * as Schema from "effect/Schema";

import { FolderId, MailboxId } from "./identifiers";
import { FolderKind, FolderName, UnixMillis, Version } from "./primitives";

export class Folder extends Schema.Class<Folder>("cloudflare-inbox/Folder")({
  id: FolderId,
  mailboxId: MailboxId,
  name: FolderName,
  kind: FolderKind,
  createdAt: UnixMillis,
  updatedAt: UnixMillis,
  version: Version,
}) {}

export const FolderSchema = Folder.check(
  Schema.makeFilter((folder) =>
    folder.updatedAt >= folder.createdAt
      ? undefined
      : "updatedAt cannot be earlier than createdAt"
  )
);
