import * as Schema from "effect/Schema";

import {
  CreateFolderInput,
  CreateLabelInput,
  DeleteFolderInput,
  DeleteFolderResult,
  DeleteLabelInput,
  DeleteLabelResult,
  FolderList,
  ListFoldersInput,
  ListLabelsInput,
  LabelList,
  RenameFolderInput,
  RenameLabelInput,
} from "./directory-contract";
import { FolderSchema } from "./folder";
import { LabelSchema } from "./label";
import { Version } from "./primitives";

export const MailboxDomainErrorDto = Schema.Struct({
  _tag: Schema.Literal("DomainError"),
  operation: Schema.Literals([
    "create-folder",
    "list-folders",
    "rename-folder",
    "delete-folder",
    "create-label",
    "list-labels",
    "rename-label",
    "delete-label",
    "list-messages",
    "get-message",
    "get-thread",
    "mutate-message",
    "create-draft",
    "get-draft",
    "update-draft",
    "schedule-outbound",
    "get-outbound",
    "cancel-outbound",
    "resend-outbound",
  ]),
  reason: Schema.Literals([
    "validation",
    "not-found",
    "version-conflict",
    "idempotency-conflict",
    "invalid-state",
    "system-folder",
    "folder-not-empty",
  ]),
  message: Schema.String,
  resourceType: Schema.optional(
    Schema.Literals([
      "mailbox",
      "folder",
      "label",
      "message",
      "thread",
      "draft",
      "outbound",
    ])
  ),
  resourceId: Schema.optional(Schema.String),
  expectedVersion: Schema.optional(Version),
  actualVersion: Schema.optional(Version),
});
export type MailboxDomainErrorDto = Schema.Schema.Type<
  typeof MailboxDomainErrorDto
>;

export const DirectoryRpcRequest = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("ListFolders"),
    input: ListFoldersInput,
  }),
  Schema.Struct({
    _tag: Schema.Literal("CreateFolder"),
    input: CreateFolderInput,
  }),
  Schema.Struct({
    _tag: Schema.Literal("RenameFolder"),
    input: RenameFolderInput,
  }),
  Schema.Struct({
    _tag: Schema.Literal("DeleteFolder"),
    input: DeleteFolderInput,
  }),
  Schema.Struct({ _tag: Schema.Literal("ListLabels"), input: ListLabelsInput }),
  Schema.Struct({
    _tag: Schema.Literal("CreateLabel"),
    input: CreateLabelInput,
  }),
  Schema.Struct({
    _tag: Schema.Literal("RenameLabel"),
    input: RenameLabelInput,
  }),
  Schema.Struct({
    _tag: Schema.Literal("DeleteLabel"),
    input: DeleteLabelInput,
  }),
]);
export type DirectoryRpcRequest = Schema.Schema.Type<
  typeof DirectoryRpcRequest
>;

export const DirectoryRpcResponse = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal("FoldersListed"), value: FolderList }),
  Schema.Struct({ _tag: Schema.Literal("FolderCreated"), value: FolderSchema }),
  Schema.Struct({ _tag: Schema.Literal("FolderRenamed"), value: FolderSchema }),
  Schema.Struct({
    _tag: Schema.Literal("FolderDeleted"),
    value: DeleteFolderResult,
  }),
  Schema.Struct({ _tag: Schema.Literal("LabelsListed"), value: LabelList }),
  Schema.Struct({ _tag: Schema.Literal("LabelCreated"), value: LabelSchema }),
  Schema.Struct({ _tag: Schema.Literal("LabelRenamed"), value: LabelSchema }),
  Schema.Struct({
    _tag: Schema.Literal("LabelDeleted"),
    value: DeleteLabelResult,
  }),
  MailboxDomainErrorDto,
]);
export type DirectoryRpcResponse = Schema.Schema.Type<
  typeof DirectoryRpcResponse
>;
