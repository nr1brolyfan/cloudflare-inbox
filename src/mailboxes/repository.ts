import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import {
  AttachmentId,
  DraftId,
  FolderId,
  MailboxId,
  MessageId,
  RuleId,
} from "./core";
import type {
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
  Folder,
  Label,
} from "./directory";
import type {
  CreateDraftInput,
  DraftResult,
  GetDraftInput,
  UpdateDraftInput,
} from "./drafts";
import type { MailboxDomainError, MailboxRepositoryError } from "./errors";
import type {
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
  SetMessageReadInput,
  SetMessageStarredInput,
} from "./messages";
import type {
  CancelOutboundDeliveryInput,
  GetOutboundDeliveryInput,
  OutboundDeliveryResult,
  ResendOutboundInput,
  ResendOutboundResult,
  ScheduleOutboundInput,
  ScheduleOutboundResult,
} from "./outbound";

export const FolderLocation = Schema.Struct({
  _tag: Schema.Literal("Folder"),
  mailboxId: MailboxId,
  folderId: FolderId,
});
export type FolderLocation = Schema.Schema.Type<typeof FolderLocation>;

export const MessageLocation = Schema.Struct({
  _tag: Schema.Literal("Message"),
  mailboxId: MailboxId,
  folderId: FolderId,
  messageId: MessageId,
});
export type MessageLocation = Schema.Schema.Type<typeof MessageLocation>;

export const DraftLocation = Schema.Struct({
  _tag: Schema.Literal("Draft"),
  mailboxId: MailboxId,
  draftId: DraftId,
});
export type DraftLocation = Schema.Schema.Type<typeof DraftLocation>;

export const RuleLocation = Schema.Struct({
  _tag: Schema.Literal("Rule"),
  mailboxId: MailboxId,
  ruleId: RuleId,
});
export type RuleLocation = Schema.Schema.Type<typeof RuleLocation>;

export const AttachmentLocation = Schema.Struct({
  _tag: Schema.Literal("Attachment"),
  mailboxId: MailboxId,
  folderId: FolderId,
  messageId: MessageId,
  attachmentId: AttachmentId,
});
export type AttachmentLocation = Schema.Schema.Type<typeof AttachmentLocation>;

export const MailboxResourceLookup = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("Folder"),
    mailboxId: MailboxId,
    folderId: FolderId,
  }),
  Schema.Struct({
    _tag: Schema.Literal("Message"),
    mailboxId: MailboxId,
    messageId: MessageId,
  }),
  Schema.Struct({
    _tag: Schema.Literal("Draft"),
    mailboxId: MailboxId,
    draftId: DraftId,
  }),
  Schema.Struct({
    _tag: Schema.Literal("Rule"),
    mailboxId: MailboxId,
    ruleId: RuleId,
  }),
  Schema.Struct({
    _tag: Schema.Literal("Attachment"),
    mailboxId: MailboxId,
    attachmentId: AttachmentId,
  }),
]);
export type MailboxResourceLookup = Schema.Schema.Type<
  typeof MailboxResourceLookup
>;

export const MailboxResourceLookupResult = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal("NotFound") }),
  FolderLocation,
  MessageLocation,
  DraftLocation,
  RuleLocation,
  AttachmentLocation,
]);
export type MailboxResourceLookupResult = Schema.Schema.Type<
  typeof MailboxResourceLookupResult
>;

export interface MailboxRepository {
  readonly addMessageLabel: (
    input: AddMessageLabelInput
  ) => Effect.Effect<
    MessageMutationResult,
    MailboxDomainError | MailboxRepositoryError
  >;
  readonly cancelOutboundDelivery: (
    input: CancelOutboundDeliveryInput
  ) => Effect.Effect<
    OutboundDeliveryResult,
    MailboxDomainError | MailboxRepositoryError
  >;
  readonly createFolder: (
    input: CreateFolderInput
  ) => Effect.Effect<Folder, MailboxDomainError | MailboxRepositoryError>;
  readonly createLabel: (
    input: CreateLabelInput
  ) => Effect.Effect<Label, MailboxDomainError | MailboxRepositoryError>;
  readonly createDraft: (
    input: CreateDraftInput
  ) => Effect.Effect<DraftResult, MailboxDomainError | MailboxRepositoryError>;
  readonly deleteFolder: (
    input: DeleteFolderInput
  ) => Effect.Effect<
    DeleteFolderResult,
    MailboxDomainError | MailboxRepositoryError
  >;
  readonly deleteLabel: (
    input: DeleteLabelInput
  ) => Effect.Effect<
    DeleteLabelResult,
    MailboxDomainError | MailboxRepositoryError
  >;
  readonly findAttachmentLocation: (input: {
    readonly mailboxId: MailboxId;
    readonly attachmentId: AttachmentId;
  }) => Effect.Effect<
    Option.Option<AttachmentLocation>,
    MailboxRepositoryError
  >;
  readonly findDraftLocation: (input: {
    readonly mailboxId: MailboxId;
    readonly draftId: DraftId;
  }) => Effect.Effect<Option.Option<DraftLocation>, MailboxRepositoryError>;
  readonly findFolderLocation: (input: {
    readonly mailboxId: MailboxId;
    readonly folderId: FolderId;
  }) => Effect.Effect<Option.Option<FolderLocation>, MailboxRepositoryError>;
  readonly findMessageLocation: (input: {
    readonly mailboxId: MailboxId;
    readonly messageId: MessageId;
  }) => Effect.Effect<Option.Option<MessageLocation>, MailboxRepositoryError>;
  readonly findRuleLocation: (input: {
    readonly mailboxId: MailboxId;
    readonly ruleId: RuleId;
  }) => Effect.Effect<Option.Option<RuleLocation>, MailboxRepositoryError>;
  readonly getDraft: (
    input: GetDraftInput
  ) => Effect.Effect<DraftResult, MailboxDomainError | MailboxRepositoryError>;
  readonly getMessage: (
    input: GetMessageInput
  ) => Effect.Effect<
    GetMessageResult,
    MailboxDomainError | MailboxRepositoryError
  >;
  readonly getOutboundDelivery: (
    input: GetOutboundDeliveryInput
  ) => Effect.Effect<
    OutboundDeliveryResult,
    MailboxDomainError | MailboxRepositoryError
  >;
  readonly getThread: (
    input: GetThreadInput
  ) => Effect.Effect<
    GetThreadResult,
    MailboxDomainError | MailboxRepositoryError
  >;
  readonly listFolders: (
    input: ListFoldersInput
  ) => Effect.Effect<FolderList, MailboxDomainError | MailboxRepositoryError>;
  readonly listLabels: (
    input: ListLabelsInput
  ) => Effect.Effect<LabelList, MailboxDomainError | MailboxRepositoryError>;
  readonly listMessages: (
    input: ListMessagesInput
  ) => Effect.Effect<MessagePage, MailboxDomainError | MailboxRepositoryError>;
  readonly moveMessage: (
    input: MoveMessageInput
  ) => Effect.Effect<
    MessageMutationResult,
    MailboxDomainError | MailboxRepositoryError
  >;
  readonly removeMessageLabel: (
    input: RemoveMessageLabelInput
  ) => Effect.Effect<
    MessageMutationResult,
    MailboxDomainError | MailboxRepositoryError
  >;
  readonly renameFolder: (
    input: RenameFolderInput
  ) => Effect.Effect<Folder, MailboxDomainError | MailboxRepositoryError>;
  readonly renameLabel: (
    input: RenameLabelInput
  ) => Effect.Effect<Label, MailboxDomainError | MailboxRepositoryError>;
  readonly resendOutbound: (
    input: ResendOutboundInput
  ) => Effect.Effect<
    ResendOutboundResult,
    MailboxDomainError | MailboxRepositoryError
  >;
  readonly scheduleOutbound: (
    input: ScheduleOutboundInput
  ) => Effect.Effect<
    ScheduleOutboundResult,
    MailboxDomainError | MailboxRepositoryError
  >;
  readonly setMessageRead: (
    input: SetMessageReadInput
  ) => Effect.Effect<
    MessageMutationResult,
    MailboxDomainError | MailboxRepositoryError
  >;
  readonly setMessageStarred: (
    input: SetMessageStarredInput
  ) => Effect.Effect<
    MessageMutationResult,
    MailboxDomainError | MailboxRepositoryError
  >;
  readonly updateDraft: (
    input: UpdateDraftInput
  ) => Effect.Effect<DraftResult, MailboxDomainError | MailboxRepositoryError>;
}

/** Trusted mailbox resource ancestry independent of its storage transport. */
export const MailboxRepository = Context.Service<MailboxRepository>(
  "cloudflare-inbox/MailboxRepository"
);
