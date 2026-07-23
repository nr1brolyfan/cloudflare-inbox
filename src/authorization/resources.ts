import * as Context from "effect/Context";
import * as Data from "effect/Data";
import type * as Effect from "effect/Effect";

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
