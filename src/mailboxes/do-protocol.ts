import * as Schema from "effect/Schema";

import { Version } from "./core";
import {
  CreateFolderInput,
  CreateLabelInput,
  DeleteFolderInput,
  DeleteFolderResult,
  DeleteLabelInput,
  DeleteLabelResult,
  FolderList,
  FolderSchema,
  LabelList,
  LabelSchema,
  ListFoldersInput,
  ListLabelsInput,
  RenameFolderInput,
  RenameLabelInput,
} from "./directory";
import {
  CreateDraftInput,
  DraftResult,
  GetDraftInput,
  UpdateDraftInput,
} from "./drafts";
import { MailboxDomainError } from "./errors";
import { CommitInboundMessageV1, InboundProcessingResult } from "./inbound";
import {
  AddMessageLabelInput,
  GetMessageInput,
  GetMessageResult,
  GetThreadInput,
  GetThreadResult,
  ListMessagesInput,
  MessageMutationResult,
  MessagePage,
  MoveMessageInput,
  RemoveMessageLabelInput,
  SearchMessagesInput,
  SetMessageReadInput,
  SetMessageStarredInput,
} from "./messages";
import {
  CancelOutboundDeliveryInput,
  GetOutboundDeliveryInput,
  OutboundDeliveryResult,
  ResendOutboundInput,
  ResendOutboundResult,
  ScheduleOutboundInput,
  ScheduleOutboundResult,
} from "./outbound";

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
    "search-messages",
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
    "commit-inbound",
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
      "inbound",
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

export const encodeMailboxDomainError = (
  error: MailboxDomainError
): MailboxDomainErrorDto =>
  Schema.decodeUnknownSync(MailboxDomainErrorDto)({
    _tag: "DomainError",
    operation: error.operation,
    reason: error.reason,
    message: error.message,
    resourceType: error.resourceType,
    resourceId: error.resourceId,
    expectedVersion: error.expectedVersion,
    actualVersion: error.actualVersion,
  });

export const decodeMailboxDomainError = (error: MailboxDomainErrorDto) =>
  new MailboxDomainError({
    operation: error.operation,
    reason: error.reason,
    message: error.message,
    resourceType: error.resourceType,
    resourceId: error.resourceId,
    expectedVersion: error.expectedVersion,
    actualVersion: error.actualVersion,
  });

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

export const MailDataRpcRequest = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("ListMessages"),
    input: ListMessagesInput,
  }),
  Schema.Struct({
    _tag: Schema.Literal("SearchMessages"),
    input: SearchMessagesInput,
  }),
  Schema.Struct({ _tag: Schema.Literal("GetMessage"), input: GetMessageInput }),
  Schema.Struct({ _tag: Schema.Literal("GetThread"), input: GetThreadInput }),
  Schema.Struct({
    _tag: Schema.Literal("SetMessageRead"),
    input: SetMessageReadInput,
  }),
  Schema.Struct({
    _tag: Schema.Literal("SetMessageStarred"),
    input: SetMessageStarredInput,
  }),
  Schema.Struct({
    _tag: Schema.Literal("MoveMessage"),
    input: MoveMessageInput,
  }),
  Schema.Struct({
    _tag: Schema.Literal("AddMessageLabel"),
    input: AddMessageLabelInput,
  }),
  Schema.Struct({
    _tag: Schema.Literal("RemoveMessageLabel"),
    input: RemoveMessageLabelInput,
  }),
  Schema.Struct({
    _tag: Schema.Literal("CreateDraft"),
    input: CreateDraftInput,
  }),
  Schema.Struct({ _tag: Schema.Literal("GetDraft"), input: GetDraftInput }),
  Schema.Struct({
    _tag: Schema.Literal("UpdateDraft"),
    input: UpdateDraftInput,
  }),
  Schema.Struct({
    _tag: Schema.Literal("ScheduleOutbound"),
    input: ScheduleOutboundInput,
  }),
  Schema.Struct({
    _tag: Schema.Literal("GetOutboundDelivery"),
    input: GetOutboundDeliveryInput,
  }),
  Schema.Struct({
    _tag: Schema.Literal("CancelOutboundDelivery"),
    input: CancelOutboundDeliveryInput,
  }),
  Schema.Struct({
    _tag: Schema.Literal("ResendOutbound"),
    input: ResendOutboundInput,
  }),
  Schema.Struct({
    _tag: Schema.Literal("CommitInbound"),
    input: CommitInboundMessageV1,
  }),
]);
export type MailDataRpcRequest = Schema.Schema.Type<typeof MailDataRpcRequest>;

export const MailDataRpcResponse = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal("MessagesListed"), value: MessagePage }),
  Schema.Struct({
    _tag: Schema.Literal("MessagesSearched"),
    value: MessagePage,
  }),
  Schema.Struct({
    _tag: Schema.Literal("MessageFound"),
    value: GetMessageResult,
  }),
  Schema.Struct({
    _tag: Schema.Literal("ThreadFound"),
    value: GetThreadResult,
  }),
  Schema.Struct({
    _tag: Schema.Literal("MessageMutated"),
    value: MessageMutationResult,
  }),
  Schema.Struct({ _tag: Schema.Literal("DraftCreated"), value: DraftResult }),
  Schema.Struct({ _tag: Schema.Literal("DraftFound"), value: DraftResult }),
  Schema.Struct({ _tag: Schema.Literal("DraftUpdated"), value: DraftResult }),
  Schema.Struct({
    _tag: Schema.Literal("OutboundScheduled"),
    value: ScheduleOutboundResult,
  }),
  Schema.Struct({
    _tag: Schema.Literal("OutboundFound"),
    value: OutboundDeliveryResult,
  }),
  Schema.Struct({
    _tag: Schema.Literal("OutboundCancelled"),
    value: OutboundDeliveryResult,
  }),
  Schema.Struct({
    _tag: Schema.Literal("OutboundResent"),
    value: ResendOutboundResult,
  }),
  Schema.Struct({
    _tag: Schema.Literal("InboundCommitted"),
    value: InboundProcessingResult,
  }),
  MailboxDomainErrorDto,
]);
export type MailDataRpcResponse = Schema.Schema.Type<
  typeof MailDataRpcResponse
>;

interface RpcRequestMetadata {
  readonly operation: MailboxDomainError["operation"];
  readonly kind: "read" | "write";
  readonly responseTag: Exclude<
    DirectoryRpcResponse["_tag"] | MailDataRpcResponse["_tag"],
    "DomainError"
  >;
}

export const directoryRequestMetadataByTag = {
  ListFolders: {
    operation: "list-folders",
    kind: "read",
    responseTag: "FoldersListed",
  },
  CreateFolder: {
    operation: "create-folder",
    kind: "write",
    responseTag: "FolderCreated",
  },
  RenameFolder: {
    operation: "rename-folder",
    kind: "write",
    responseTag: "FolderRenamed",
  },
  DeleteFolder: {
    operation: "delete-folder",
    kind: "write",
    responseTag: "FolderDeleted",
  },
  ListLabels: {
    operation: "list-labels",
    kind: "read",
    responseTag: "LabelsListed",
  },
  CreateLabel: {
    operation: "create-label",
    kind: "write",
    responseTag: "LabelCreated",
  },
  RenameLabel: {
    operation: "rename-label",
    kind: "write",
    responseTag: "LabelRenamed",
  },
  DeleteLabel: {
    operation: "delete-label",
    kind: "write",
    responseTag: "LabelDeleted",
  },
} as const satisfies Record<DirectoryRpcRequest["_tag"], RpcRequestMetadata>;

export const mailDataRequestMetadataByTag = {
  ListMessages: {
    operation: "list-messages",
    kind: "read",
    responseTag: "MessagesListed",
  },
  SearchMessages: {
    operation: "search-messages",
    kind: "read",
    responseTag: "MessagesSearched",
  },
  GetMessage: {
    operation: "get-message",
    kind: "read",
    responseTag: "MessageFound",
  },
  GetThread: {
    operation: "get-thread",
    kind: "read",
    responseTag: "ThreadFound",
  },
  SetMessageRead: {
    operation: "mutate-message",
    kind: "write",
    responseTag: "MessageMutated",
  },
  SetMessageStarred: {
    operation: "mutate-message",
    kind: "write",
    responseTag: "MessageMutated",
  },
  MoveMessage: {
    operation: "mutate-message",
    kind: "write",
    responseTag: "MessageMutated",
  },
  AddMessageLabel: {
    operation: "mutate-message",
    kind: "write",
    responseTag: "MessageMutated",
  },
  RemoveMessageLabel: {
    operation: "mutate-message",
    kind: "write",
    responseTag: "MessageMutated",
  },
  CreateDraft: {
    operation: "create-draft",
    kind: "write",
    responseTag: "DraftCreated",
  },
  GetDraft: {
    operation: "get-draft",
    kind: "read",
    responseTag: "DraftFound",
  },
  UpdateDraft: {
    operation: "update-draft",
    kind: "write",
    responseTag: "DraftUpdated",
  },
  ScheduleOutbound: {
    operation: "schedule-outbound",
    kind: "write",
    responseTag: "OutboundScheduled",
  },
  GetOutboundDelivery: {
    operation: "get-outbound",
    kind: "read",
    responseTag: "OutboundFound",
  },
  CancelOutboundDelivery: {
    operation: "cancel-outbound",
    kind: "write",
    responseTag: "OutboundCancelled",
  },
  ResendOutbound: {
    operation: "resend-outbound",
    kind: "write",
    responseTag: "OutboundResent",
  },
  CommitInbound: {
    operation: "commit-inbound",
    kind: "write",
    responseTag: "InboundCommitted",
  },
} as const satisfies Record<MailDataRpcRequest["_tag"], RpcRequestMetadata>;

export const directoryRequestMetadata = (
  request: DirectoryRpcRequest
): RpcRequestMetadata => directoryRequestMetadataByTag[request._tag];

export const mailDataRequestMetadata = (
  request: MailDataRpcRequest
): RpcRequestMetadata => mailDataRequestMetadataByTag[request._tag];

const responseMatchesRequest = (
  metadata: RpcRequestMetadata,
  response: DirectoryRpcResponse | MailDataRpcResponse
) =>
  response._tag === "DomainError"
    ? response.operation === metadata.operation
    : response._tag === metadata.responseTag;

export const directoryResponseMatchesRequest = (
  request: DirectoryRpcRequest,
  response: DirectoryRpcResponse
) => responseMatchesRequest(directoryRequestMetadata(request), response);

export const mailDataResponseMatchesRequest = (
  request: MailDataRpcRequest,
  response: MailDataRpcResponse
) => responseMatchesRequest(mailDataRequestMetadata(request), response);
