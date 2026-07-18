import * as Context from "effect/Context";
import * as Data from "effect/Data";
import type * as Effect from "effect/Effect";

export interface MailboxRouteHint {
  /** Selects a MailboxDO but is never authorization evidence. */
  readonly mailboxId: string;
}

export interface MailboxRef {
  readonly _tag: "Mailbox";
  readonly mailboxId: string;
}

export interface FolderRef {
  readonly _tag: "Folder";
  readonly folderId: string;
  readonly route: MailboxRouteHint;
}

export interface MessageRef {
  readonly _tag: "Message";
  readonly messageId: string;
  readonly route: MailboxRouteHint;
}

export interface DraftRef {
  readonly _tag: "Draft";
  readonly draftId: string;
  readonly route: MailboxRouteHint;
}

export interface RuleRef {
  readonly _tag: "Rule";
  readonly route: MailboxRouteHint;
  readonly ruleId: string;
}

export interface AttachmentRef {
  readonly _tag: "Attachment";
  readonly attachmentId: string;
  readonly route: MailboxRouteHint;
}

export type ResolvableMailResourceRef =
  | FolderRef
  | MessageRef
  | DraftRef
  | RuleRef
  | AttachmentRef;

export interface TrustedMailboxLocation {
  readonly mailboxId: string;
}

export interface TrustedFolderLocation extends TrustedMailboxLocation {
  readonly folderId: string;
}

export interface TrustedMessageLocation extends TrustedFolderLocation {
  readonly messageId: string;
}

export interface TrustedDraftLocation extends TrustedMailboxLocation {
  readonly draftId: string;
}

export interface TrustedRuleLocation extends TrustedMailboxLocation {
  readonly ruleId: string;
}

export interface TrustedAttachmentLocation extends TrustedMessageLocation {
  readonly attachmentId: string;
}

export class MailResourceResolveError extends Data.TaggedError(
  "MailResourceResolveError"
)<{
  readonly cause?: unknown;
  readonly message: string;
  readonly reason: "not-found" | "storage";
  readonly resource: ResolvableMailResourceRef;
}> {}

export interface MailResourceResolver {
  readonly resolveAttachment: (
    resource: AttachmentRef
  ) => Effect.Effect<TrustedAttachmentLocation, MailResourceResolveError>;
  readonly resolveDraft: (
    resource: DraftRef
  ) => Effect.Effect<TrustedDraftLocation, MailResourceResolveError>;
  readonly resolveFolder: (
    resource: FolderRef
  ) => Effect.Effect<TrustedFolderLocation, MailResourceResolveError>;
  readonly resolveMessage: (
    resource: MessageRef
  ) => Effect.Effect<TrustedMessageLocation, MailResourceResolveError>;
  readonly resolveRule: (
    resource: RuleRef
  ) => Effect.Effect<TrustedRuleLocation, MailResourceResolveError>;
}

export const MailResourceResolver = Context.Service<MailResourceResolver>(
  "cloudflare-inbox/MailResourceResolver"
);
