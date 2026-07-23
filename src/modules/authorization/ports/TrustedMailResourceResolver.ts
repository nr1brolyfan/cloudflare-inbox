import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type {
  AttachmentRef,
  DraftRef,
  FolderRef,
  MailResourceResolveError,
  MessageRef,
  RuleRef,
  TrustedAttachmentLocation,
  TrustedDraftLocation,
  TrustedFolderLocation,
  TrustedMessageLocation,
  TrustedRuleLocation,
} from "#/modules/mailbox/ports/MailboxAuthorization";

export interface TrustedMailResourceResolverService {
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

/** Resolves mailbox ancestry from trusted storage rather than caller claims. */
export class TrustedMailResourceResolver extends Context.Service<
  TrustedMailResourceResolver,
  TrustedMailResourceResolverService
>()("cloudflare-inbox/TrustedMailResourceResolver") {}
