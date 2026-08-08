import * as Schema from "effect/Schema";

import {
  ContactDetail,
  ContactSearchResult,
  RemoveContactResult,
  TrustedGetContactInput,
  TrustedListContactsInput,
  TrustedRemoveContactCommand,
  TrustedSaveContactCommand,
} from "#/modules/mailbox/domain/MailboxContact";
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
} from "#/modules/mailbox/domain/MailboxDirectory";
import {
  CreateDraftInput,
  CreateReplyDraftInput,
  DraftPage,
  DraftResult,
  GetDraftInput,
  ListDraftsInput,
  ReplyDraftOperationResult,
  UpdateDraftInput,
} from "#/modules/mailbox/domain/MailboxDraft";
import {
  CompleteDraftAttachmentInput,
  DraftAttachmentList,
  DraftAttachmentReservationSchema,
  DraftAttachmentUploadResult,
  GetDraftAttachmentInput,
  ListDraftAttachmentsInput,
  ReserveDraftAttachmentCommand,
} from "#/modules/mailbox/domain/MailboxDraftAttachment";
import { MailboxDomainError } from "#/modules/mailbox/domain/MailboxError";
import {
  CommitInboundMessage,
  InboundProcessingResult,
  PreparedInboundReplayV1,
  RecordInboundProcessing,
  ReplayInboundInput,
} from "#/modules/mailbox/domain/MailboxInbound";
import {
  AddMessageLabelInput,
  AttachmentBlobLocation,
  BatchMessageMutationsInput,
  BatchMessageMutationsResult,
  GetAttachmentBlobInput,
  GetMessageInput,
  GetMessageResult,
  InboundAttachmentBlobLocation,
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
  SetThreadReadInput,
  SetThreadReadResult,
} from "#/modules/mailbox/domain/MailboxMessage";
import {
  CancelOutboundDeliveryInput,
  GetOutboundDeliveryInput,
  OutboundDeliveryResult,
  ResendOutboundInput,
  ResendOutboundResult,
  PrivateScheduleOutboundInput,
  ScheduleOutboundResult,
} from "#/modules/mailbox/domain/MailboxOutbound";
import { Version } from "#/shared/Temporal";

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
    "search-contacts",
    "get-contact",
    "save-contact",
    "remove-contact",
    "get-attachment",
    "get-message",
    "get-thread",
    "mutate-message",
    "create-draft",
    "create-reply-draft",
    "list-drafts",
    "get-draft",
    "update-draft",
    "reserve-draft-attachment",
    "get-draft-attachment",
    "list-draft-attachments",
    "complete-draft-attachment",
    "schedule-outbound",
    "get-outbound",
    "cancel-outbound",
    "resend-outbound",
    "record-inbound",
    "commit-inbound",
    "replay-inbound",
  ]),
  reason: Schema.Literals([
    "validation",
    "message-too-large",
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
      "attachment",
      "thread",
      "draft",
      "inbound",
      "outbound",
      "contact",
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
  Schema.Struct({
    _tag: Schema.Literal("SearchContacts"),
    input: TrustedListContactsInput,
  }),
  Schema.Struct({
    _tag: Schema.Literal("GetContact"),
    input: TrustedGetContactInput,
  }),
  Schema.Struct({
    _tag: Schema.Literal("SaveContact"),
    input: TrustedSaveContactCommand,
  }),
  Schema.Struct({
    _tag: Schema.Literal("RemoveContact"),
    input: TrustedRemoveContactCommand,
  }),
  Schema.Struct({ _tag: Schema.Literal("GetMessage"), input: GetMessageInput }),
  Schema.Struct({
    _tag: Schema.Literal("GetAttachmentBlob"),
    input: GetAttachmentBlobInput,
  }),
  Schema.Struct({
    _tag: Schema.Literal("GetInboundAttachmentBlob"),
    input: GetAttachmentBlobInput,
  }),
  Schema.Struct({ _tag: Schema.Literal("GetThread"), input: GetThreadInput }),
  Schema.Struct({
    _tag: Schema.Literal("SetThreadRead"),
    input: SetThreadReadInput,
  }),
  Schema.Struct({
    _tag: Schema.Literal("BatchMutateMessages"),
    input: BatchMessageMutationsInput,
  }),
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
  Schema.Struct({
    _tag: Schema.Literal("CreateReplyDraft"),
    input: CreateReplyDraftInput,
  }),
  Schema.Struct({
    _tag: Schema.Literal("ReadReplyDraftOperation"),
    input: CreateReplyDraftInput,
  }),
  Schema.Struct({ _tag: Schema.Literal("GetDraft"), input: GetDraftInput }),
  Schema.Struct({ _tag: Schema.Literal("ListDrafts"), input: ListDraftsInput }),
  Schema.Struct({
    _tag: Schema.Literal("ReserveDraftAttachment"),
    input: ReserveDraftAttachmentCommand,
  }),
  Schema.Struct({
    _tag: Schema.Literal("GetDraftAttachment"),
    input: GetDraftAttachmentInput,
  }),
  Schema.Struct({
    _tag: Schema.Literal("ListDraftAttachments"),
    input: ListDraftAttachmentsInput,
  }),
  Schema.Struct({
    _tag: Schema.Literal("CompleteDraftAttachment"),
    input: CompleteDraftAttachmentInput,
  }),
  Schema.Struct({
    _tag: Schema.Literal("UpdateDraft"),
    input: UpdateDraftInput,
  }),
  Schema.Struct({
    _tag: Schema.Literal("ScheduleOutbound"),
    input: PrivateScheduleOutboundInput,
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
    input: CommitInboundMessage,
  }),
  Schema.Struct({
    _tag: Schema.Literal("RecordInboundProcessing"),
    input: RecordInboundProcessing,
  }),
  Schema.Struct({
    _tag: Schema.Literal("PrepareInboundReplay"),
    input: ReplayInboundInput,
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
    _tag: Schema.Literal("ContactsSearched"),
    value: ContactSearchResult,
  }),
  Schema.Struct({ _tag: Schema.Literal("ContactFound"), value: ContactDetail }),
  Schema.Struct({ _tag: Schema.Literal("ContactSaved"), value: ContactDetail }),
  Schema.Struct({
    _tag: Schema.Literal("ContactRemoved"),
    value: RemoveContactResult,
  }),
  Schema.Struct({
    _tag: Schema.Literal("MessageFound"),
    value: GetMessageResult,
  }),
  Schema.Struct({
    _tag: Schema.Literal("AttachmentBlobFound"),
    value: AttachmentBlobLocation,
  }),
  Schema.Struct({
    _tag: Schema.Literal("InboundAttachmentBlobFound"),
    value: InboundAttachmentBlobLocation,
  }),
  Schema.Struct({
    _tag: Schema.Literal("ThreadFound"),
    value: GetThreadResult,
  }),
  Schema.Struct({
    _tag: Schema.Literal("MessageMutated"),
    value: MessageMutationResult,
  }),
  Schema.Struct({
    _tag: Schema.Literal("MessagesBatchMutated"),
    value: BatchMessageMutationsResult,
  }),
  Schema.Struct({
    _tag: Schema.Literal("ThreadReadSet"),
    value: SetThreadReadResult,
  }),
  Schema.Struct({ _tag: Schema.Literal("DraftCreated"), value: DraftResult }),
  Schema.Struct({
    _tag: Schema.Literal("ReplyDraftCreated"),
    value: DraftResult,
  }),
  Schema.Struct({
    _tag: Schema.Literal("ReplyDraftOperationRead"),
    value: ReplyDraftOperationResult,
  }),
  Schema.Struct({ _tag: Schema.Literal("DraftFound"), value: DraftResult }),
  Schema.Struct({ _tag: Schema.Literal("DraftsListed"), value: DraftPage }),
  Schema.Struct({ _tag: Schema.Literal("DraftUpdated"), value: DraftResult }),
  Schema.Struct({
    _tag: Schema.Literal("DraftAttachmentReserved"),
    value: DraftAttachmentReservationSchema,
  }),
  Schema.Struct({
    _tag: Schema.Literal("DraftAttachmentFound"),
    value: DraftAttachmentReservationSchema,
  }),
  Schema.Struct({
    _tag: Schema.Literal("DraftAttachmentsListed"),
    value: DraftAttachmentList,
  }),
  Schema.Struct({
    _tag: Schema.Literal("DraftAttachmentCompleted"),
    value: DraftAttachmentUploadResult,
  }),
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
  Schema.Struct({
    _tag: Schema.Literal("InboundProcessingRecorded"),
    value: InboundProcessingResult,
  }),
  Schema.Struct({
    _tag: Schema.Literal("InboundReplayPrepared"),
    value: PreparedInboundReplayV1,
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
  SearchContacts: {
    operation: "search-contacts",
    kind: "read",
    responseTag: "ContactsSearched",
  },
  GetContact: {
    operation: "get-contact",
    kind: "read",
    responseTag: "ContactFound",
  },
  SaveContact: {
    operation: "save-contact",
    kind: "write",
    responseTag: "ContactSaved",
  },
  RemoveContact: {
    operation: "remove-contact",
    kind: "write",
    responseTag: "ContactRemoved",
  },
  GetMessage: {
    operation: "get-message",
    kind: "read",
    responseTag: "MessageFound",
  },
  GetAttachmentBlob: {
    operation: "get-attachment",
    kind: "read",
    responseTag: "AttachmentBlobFound",
  },
  GetInboundAttachmentBlob: {
    operation: "get-attachment",
    kind: "read",
    responseTag: "InboundAttachmentBlobFound",
  },
  GetThread: {
    operation: "get-thread",
    kind: "read",
    responseTag: "ThreadFound",
  },
  SetThreadRead: {
    operation: "mutate-message",
    kind: "write",
    responseTag: "ThreadReadSet",
  },
  BatchMutateMessages: {
    operation: "mutate-message",
    kind: "write",
    responseTag: "MessagesBatchMutated",
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
  CreateReplyDraft: {
    operation: "create-reply-draft",
    kind: "write",
    responseTag: "ReplyDraftCreated",
  },
  ReadReplyDraftOperation: {
    operation: "create-reply-draft",
    kind: "read",
    responseTag: "ReplyDraftOperationRead",
  },
  GetDraft: {
    operation: "get-draft",
    kind: "read",
    responseTag: "DraftFound",
  },
  ListDrafts: {
    operation: "list-drafts",
    kind: "read",
    responseTag: "DraftsListed",
  },
  UpdateDraft: {
    operation: "update-draft",
    kind: "write",
    responseTag: "DraftUpdated",
  },
  ReserveDraftAttachment: {
    operation: "reserve-draft-attachment",
    kind: "write",
    responseTag: "DraftAttachmentReserved",
  },
  GetDraftAttachment: {
    operation: "get-draft-attachment",
    kind: "read",
    responseTag: "DraftAttachmentFound",
  },
  ListDraftAttachments: {
    operation: "list-draft-attachments",
    kind: "read",
    responseTag: "DraftAttachmentsListed",
  },
  CompleteDraftAttachment: {
    operation: "complete-draft-attachment",
    kind: "write",
    responseTag: "DraftAttachmentCompleted",
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
  RecordInboundProcessing: {
    operation: "record-inbound",
    kind: "write",
    responseTag: "InboundProcessingRecorded",
  },
  PrepareInboundReplay: {
    operation: "replay-inbound",
    kind: "write",
    responseTag: "InboundReplayPrepared",
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
