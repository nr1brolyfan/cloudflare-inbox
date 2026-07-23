/* oxlint-disable max-classes-per-file -- Directory domain schemas are intentionally consolidated. */
import * as Schema from "effect/Schema";

import { OperationId } from "#/shared/Operation";
import { UnixMillis, Version } from "#/shared/Temporal";

import {
  FolderId,
  FolderKind,
  FolderName,
  LabelId,
  LabelName,
  MailboxId,
} from "./Mailbox";

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

export class DeletedFolder extends Schema.Class<DeletedFolder>(
  "cloudflare-inbox/DeletedFolder"
)({
  id: FolderId,
  deletedAt: UnixMillis,
  version: Version,
}) {}

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

export class DeletedLabel extends Schema.Class<DeletedLabel>(
  "cloudflare-inbox/DeletedLabel"
)({
  id: LabelId,
  deletedAt: UnixMillis,
  version: Version,
}) {}

export const ListFoldersInput = Schema.Struct({ mailboxId: MailboxId });
export type ListFoldersInput = Schema.Schema.Type<typeof ListFoldersInput>;

export const FolderList = Schema.Struct({
  items: Schema.Array(FolderSummarySchema),
});
export type FolderList = Schema.Schema.Type<typeof FolderList>;

export const CreateFolderInput = Schema.Struct({
  mailboxId: MailboxId,
  operationId: OperationId,
  name: FolderName,
});
export type CreateFolderInput = Schema.Schema.Type<typeof CreateFolderInput>;

export const RenameFolderInput = Schema.Struct({
  mailboxId: MailboxId,
  operationId: OperationId,
  folderId: FolderId,
  expectedVersion: Version,
  name: FolderName,
});
export type RenameFolderInput = Schema.Schema.Type<typeof RenameFolderInput>;

export const DeleteFolderInput = Schema.Struct({
  mailboxId: MailboxId,
  operationId: OperationId,
  folderId: FolderId,
  expectedVersion: Version,
});
export type DeleteFolderInput = Schema.Schema.Type<typeof DeleteFolderInput>;

export const DeleteFolderResult = DeletedFolder;
export type DeleteFolderResult = Schema.Schema.Type<typeof DeleteFolderResult>;

export const ListLabelsInput = Schema.Struct({ mailboxId: MailboxId });
export type ListLabelsInput = Schema.Schema.Type<typeof ListLabelsInput>;

export const LabelList = Schema.Struct({ items: Schema.Array(LabelSchema) });
export type LabelList = Schema.Schema.Type<typeof LabelList>;

export const CreateLabelInput = Schema.Struct({
  mailboxId: MailboxId,
  operationId: OperationId,
  name: LabelName,
});
export type CreateLabelInput = Schema.Schema.Type<typeof CreateLabelInput>;

export const RenameLabelInput = Schema.Struct({
  mailboxId: MailboxId,
  operationId: OperationId,
  labelId: LabelId,
  expectedVersion: Version,
  name: LabelName,
});
export type RenameLabelInput = Schema.Schema.Type<typeof RenameLabelInput>;

export const DeleteLabelInput = Schema.Struct({
  mailboxId: MailboxId,
  operationId: OperationId,
  labelId: LabelId,
  expectedVersion: Version,
});
export type DeleteLabelInput = Schema.Schema.Type<typeof DeleteLabelInput>;

export const DeleteLabelResult = DeletedLabel;
export type DeleteLabelResult = Schema.Schema.Type<typeof DeleteLabelResult>;
