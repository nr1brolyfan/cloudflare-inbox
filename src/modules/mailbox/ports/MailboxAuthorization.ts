/* oxlint-disable max-classes-per-file -- The capability and its resolution error form one port contract. */
import type * as AuthPermission from "@effect-auth/core/Permission";
import type * as AuthPolicy from "@effect-auth/core/Policy";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type {
  AttachmentLocation,
  AttachmentLookup,
  DraftLocation,
  DraftLookup,
  FolderLocation,
  FolderLookup,
  MailboxLocation,
  MessageLocation,
  MessageLookup,
  ResolvableMailResourceLookup,
  RuleLocation,
  RuleLookup,
} from "#/modules/mailbox/domain/MailboxResource";

export const MailboxAction = Schema.Literals([
  "read",
  "modify",
  "send",
  "manage-settings",
  "manage-members",
]);
export type MailboxAction = Schema.Schema.Type<typeof MailboxAction>;
export const FolderAction = Schema.Literals(["read", "modify"]);
export type FolderAction = Schema.Schema.Type<typeof FolderAction>;
export const MessageAction = Schema.Literals(["read", "modify"]);
export type MessageAction = Schema.Schema.Type<typeof MessageAction>;
export const DraftAction = Schema.Literals(["edit", "send"]);
export type DraftAction = Schema.Schema.Type<typeof DraftAction>;

export type MailboxRef = MailboxLocation;
export type FolderRef = FolderLookup;
export type MessageRef = MessageLookup;
export type DraftRef = DraftLookup;
export type RuleRef = RuleLookup;
export type AttachmentRef = AttachmentLookup;
export type ResolvableMailResourceRef = ResolvableMailResourceLookup;
export type TrustedMailboxLocation = MailboxLocation;
export type TrustedFolderLocation = FolderLocation;
export type TrustedMessageLocation = MessageLocation;
export type TrustedDraftLocation = DraftLocation;
export type TrustedRuleLocation = RuleLocation;
export type TrustedAttachmentLocation = AttachmentLocation;

export class MailResourceResolveError extends Data.TaggedError(
  "MailResourceResolveError"
)<{
  readonly cause?: unknown;
  readonly message: string;
  readonly reason: "not-found" | "storage";
  readonly resource: ResolvableMailResourceRef;
}> {}

export type MailboxMessageReadAccess =
  | {
      readonly _tag: "MailboxMessageRead";
      readonly mailboxId: TrustedMailboxLocation["mailboxId"];
    }
  | {
      readonly _tag: "FolderMessageRead";
      readonly folderId: TrustedFolderLocation["folderId"];
      readonly mailboxId: TrustedFolderLocation["mailboxId"];
    };

export type MailboxAuthorizationError =
  | AuthPolicy.AuthorizationError
  | AuthPermission.PermissionCheckError
  | MailResourceResolveError;

type MailboxPolicy<A, E = never> = Effect.Effect<
  A,
  AuthPolicy.AuthorizationError | AuthPermission.PermissionCheckError | E,
  AuthPermission.CurrentPrincipal
>;

export interface MailboxAuthorizationService {
  readonly requireAttachmentRead: (input: {
    readonly resource: AttachmentRef;
  }) => MailboxPolicy<TrustedAttachmentLocation, MailResourceResolveError>;
  readonly requireInboundAttachmentDownload: (input: {
    readonly resource: AttachmentRef;
  }) => MailboxPolicy<TrustedAttachmentLocation, MailResourceResolveError>;
  readonly requireAttachmentUpload: (input: {
    readonly resource: DraftRef;
  }) => MailboxPolicy<TrustedDraftLocation, MailResourceResolveError>;
  readonly requireDraft: (input: {
    readonly action: DraftAction;
    readonly resource: DraftRef;
  }) => MailboxPolicy<TrustedDraftLocation, MailResourceResolveError>;
  readonly requireDraftCreate: (input: {
    readonly resource: MailboxRef;
  }) => MailboxPolicy<TrustedMailboxLocation>;
  readonly requireExport: (input: {
    readonly resource: MailboxRef;
  }) => MailboxPolicy<TrustedMailboxLocation>;
  readonly requireFolder: (input: {
    readonly action: FolderAction;
    readonly resource: FolderRef;
  }) => MailboxPolicy<TrustedFolderLocation, MailResourceResolveError>;
  readonly requireFolderMessageRead: (input: {
    readonly resource: FolderRef;
  }) => MailboxPolicy<MailboxMessageReadAccess, MailResourceResolveError>;
  readonly requireMailbox: (input: {
    readonly action: MailboxAction;
    readonly resource: MailboxRef;
  }) => MailboxPolicy<TrustedMailboxLocation>;
  readonly requireMailboxDraftSend: (input: {
    readonly resource: MailboxRef;
  }) => MailboxPolicy<TrustedMailboxLocation>;
  readonly requireMailboxMessageRead: (input: {
    readonly resource: MailboxRef;
  }) => MailboxPolicy<TrustedMailboxLocation>;
  readonly requireMailboxMessageModify: (input: {
    readonly resource: MailboxRef;
  }) => MailboxPolicy<TrustedMailboxLocation>;
  readonly requireMessage: (input: {
    readonly action: MessageAction;
    readonly resource: MessageRef;
  }) => MailboxPolicy<TrustedMessageLocation, MailResourceResolveError>;
  readonly requireRuleManage: (input: {
    readonly resource: RuleRef;
  }) => MailboxPolicy<TrustedRuleLocation, MailResourceResolveError>;
}

/** Consumer-owned capability for authorized mailbox resource access. */
export class MailboxAuthorization extends Context.Service<
  MailboxAuthorization,
  MailboxAuthorizationService
>()("cloudflare-inbox/MailboxAuthorization") {}
