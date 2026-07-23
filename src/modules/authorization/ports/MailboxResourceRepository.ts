import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Option from "effect/Option";

import type {
  AttachmentId,
  DraftId,
  FolderId,
  MailboxId,
  MessageId,
  RuleId,
} from "#/modules/mailbox/domain/Mailbox";
import type {
  AttachmentLocation,
  DraftLocation,
  FolderLocation,
  MessageLocation,
  RuleLocation,
} from "#/modules/mailbox/domain/MailboxResource";
import type { MailboxRepositoryError } from "#/modules/mailbox/ports/MailboxRepositoryError";

export interface MailboxResourceRepositoryService {
  readonly findAttachmentLocation: (input: {
    readonly attachmentId: AttachmentId;
    readonly mailboxId: MailboxId;
  }) => Effect.Effect<
    Option.Option<AttachmentLocation>,
    MailboxRepositoryError
  >;
  readonly findDraftLocation: (input: {
    readonly draftId: DraftId;
    readonly mailboxId: MailboxId;
  }) => Effect.Effect<Option.Option<DraftLocation>, MailboxRepositoryError>;
  readonly findFolderLocation: (input: {
    readonly folderId: FolderId;
    readonly mailboxId: MailboxId;
  }) => Effect.Effect<Option.Option<FolderLocation>, MailboxRepositoryError>;
  readonly findMessageLocation: (input: {
    readonly mailboxId: MailboxId;
    readonly messageId: MessageId;
  }) => Effect.Effect<Option.Option<MessageLocation>, MailboxRepositoryError>;
  readonly findRuleLocation: (input: {
    readonly mailboxId: MailboxId;
    readonly ruleId: RuleId;
  }) => Effect.Effect<Option.Option<RuleLocation>, MailboxRepositoryError>;
}

/** Trusted mailbox ancestry required by authorization resource resolution. */
export class MailboxResourceRepository extends Context.Service<
  MailboxResourceRepository,
  MailboxResourceRepositoryService
>()("cloudflare-inbox/MailboxResourceRepository") {}
