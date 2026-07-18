import * as Schema from "effect/Schema";

import { DeletedFolder } from "./deleted-folder";
import { DeletedLabel } from "./deleted-label";
import { FolderSummarySchema } from "./folder-summary";
import { FolderId, LabelId, MailboxId, OperationId } from "./identifiers";
import { LabelSchema } from "./label";
import { FolderName, LabelName, Version } from "./primitives";

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
  folderId: FolderId,
  expectedVersion: Version,
  name: FolderName,
});
export type RenameFolderInput = Schema.Schema.Type<typeof RenameFolderInput>;

export const DeleteFolderInput = Schema.Struct({
  mailboxId: MailboxId,
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
  labelId: LabelId,
  expectedVersion: Version,
  name: LabelName,
});
export type RenameLabelInput = Schema.Schema.Type<typeof RenameLabelInput>;

export const DeleteLabelInput = Schema.Struct({
  mailboxId: MailboxId,
  labelId: LabelId,
  expectedVersion: Version,
});
export type DeleteLabelInput = Schema.Schema.Type<typeof DeleteLabelInput>;

export const DeleteLabelResult = DeletedLabel;
export type DeleteLabelResult = Schema.Schema.Type<typeof DeleteLabelResult>;
