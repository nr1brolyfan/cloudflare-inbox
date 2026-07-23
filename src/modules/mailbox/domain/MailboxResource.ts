import * as Schema from "effect/Schema";

import {
  AttachmentId,
  DraftId,
  FolderId,
  MailboxId,
  MessageId,
  RuleId,
} from "./Mailbox";

export const MailboxLocation = Schema.Struct({
  _tag: Schema.Literal("Mailbox"),
  mailboxId: MailboxId,
});
export type MailboxLocation = Schema.Schema.Type<typeof MailboxLocation>;

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

// Every mailboxId here is a lookup hint. Only a resolved location is authority.
export const FolderLookup = Schema.Struct({
  _tag: Schema.Literal("Folder"),
  mailboxId: MailboxId,
  folderId: FolderId,
});
export type FolderLookup = Schema.Schema.Type<typeof FolderLookup>;

export const MessageLookup = Schema.Struct({
  _tag: Schema.Literal("Message"),
  mailboxId: MailboxId,
  messageId: MessageId,
});
export type MessageLookup = Schema.Schema.Type<typeof MessageLookup>;

export const DraftLookup = Schema.Struct({
  _tag: Schema.Literal("Draft"),
  mailboxId: MailboxId,
  draftId: DraftId,
});
export type DraftLookup = Schema.Schema.Type<typeof DraftLookup>;

export const RuleLookup = Schema.Struct({
  _tag: Schema.Literal("Rule"),
  mailboxId: MailboxId,
  ruleId: RuleId,
});
export type RuleLookup = Schema.Schema.Type<typeof RuleLookup>;

export const AttachmentLookup = Schema.Struct({
  _tag: Schema.Literal("Attachment"),
  mailboxId: MailboxId,
  attachmentId: AttachmentId,
});
export type AttachmentLookup = Schema.Schema.Type<typeof AttachmentLookup>;

export const MailboxResourceLookup = Schema.Union([
  FolderLookup,
  MessageLookup,
  DraftLookup,
  RuleLookup,
  AttachmentLookup,
]);
export type MailboxResourceLookup = Schema.Schema.Type<
  typeof MailboxResourceLookup
>;

export type ResolvableMailResourceLookup = MailboxResourceLookup;

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
