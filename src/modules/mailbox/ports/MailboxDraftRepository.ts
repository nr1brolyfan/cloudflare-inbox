import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type {
  DraftAttachmentList,
  ListDraftAttachmentsInput,
} from "#/mailboxes/draft-attachments";
import type {
  CreateDraftInput,
  DraftPage,
  DraftResult,
  GetDraftInput,
  ListDraftsInput,
  UpdateDraftInput,
} from "#/mailboxes/drafts";
import type {
  MailboxDomainError,
  MailboxRepositoryError,
} from "#/mailboxes/errors";

type RepositoryError = MailboxDomainError | MailboxRepositoryError;

export interface MailboxDraftRepositoryService {
  readonly createDraft: (
    input: CreateDraftInput
  ) => Effect.Effect<DraftResult, RepositoryError>;
  readonly getDraft: (
    input: GetDraftInput
  ) => Effect.Effect<DraftResult, RepositoryError>;
  readonly listDraftAttachments: (
    input: ListDraftAttachmentsInput
  ) => Effect.Effect<DraftAttachmentList, RepositoryError>;
  readonly listDrafts: (
    input: ListDraftsInput
  ) => Effect.Effect<DraftPage, RepositoryError>;
  readonly updateDraft: (
    input: UpdateDraftInput
  ) => Effect.Effect<DraftResult, RepositoryError>;
}

/** Draft persistence capability required by mailbox application services. */
export class MailboxDraftRepository extends Context.Service<
  MailboxDraftRepository,
  MailboxDraftRepositoryService
>()("cloudflare-inbox/MailboxDraftRepository") {}
