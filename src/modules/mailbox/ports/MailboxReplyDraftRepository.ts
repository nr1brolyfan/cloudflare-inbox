import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type {
  CreateReplyDraftInput,
  DraftResult,
  ReplyDraftOperationResult,
} from "#/modules/mailbox/domain/MailboxDraft";
import type { MailboxDomainError } from "#/modules/mailbox/domain/MailboxError";
import type { MailboxRepositoryError } from "#/modules/mailbox/ports/MailboxRepositoryError";

export interface MailboxReplyDraftRepositoryService {
  readonly createReplyDraft: (
    input: CreateReplyDraftInput
  ) => Effect.Effect<DraftResult, MailboxDomainError | MailboxRepositoryError>;
  readonly readReplyDraftOperation: (
    input: CreateReplyDraftInput
  ) => Effect.Effect<
    ReplyDraftOperationResult,
    MailboxDomainError | MailboxRepositoryError
  >;
}

export class MailboxReplyDraftRepository extends Context.Service<
  MailboxReplyDraftRepository,
  MailboxReplyDraftRepositoryService
>()("cloudflare-inbox/MailboxReplyDraftRepository") {}
