import * as Schema from "effect/Schema";

import { Folder } from "./folder";

export class FolderSummary extends Folder.extend<FolderSummary>(
  "cloudflare-inbox/FolderSummary"
)({
  messageCount: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
  unreadCount: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
}) {}

export const FolderSummarySchema = FolderSummary.check(
  Schema.makeFilter((folder) => {
    if (folder.updatedAt < folder.createdAt) {
      return "updatedAt cannot be earlier than createdAt";
    }
    return folder.unreadCount <= folder.messageCount
      ? undefined
      : "unreadCount cannot exceed messageCount";
  })
);
