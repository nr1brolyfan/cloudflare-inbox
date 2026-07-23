import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type {
  CreateDraftInput,
  DraftPage,
  DraftResult,
  GetDraftInput,
  ListDraftsInput,
  UpdateDraftInput,
} from "#/modules/mailbox/domain/MailboxDraft";
import type {
  CompleteDraftAttachmentInput,
  DraftAttachmentList,
  DraftAttachmentReservation,
  DraftAttachmentUploadResult,
  GetDraftAttachmentInput,
  ListDraftAttachmentsInput,
  ReserveDraftAttachmentCommand,
} from "#/modules/mailbox/domain/MailboxDraftAttachment";
import type { MailboxDomainError } from "#/modules/mailbox/domain/MailboxError";
import type { MailboxRepositoryError } from "#/modules/mailbox/ports/MailboxRepositoryError";

type RepositoryError = MailboxDomainError | MailboxRepositoryError;

export interface MailboxDraftRepositoryService {
  readonly completeDraftAttachment: (
    input: CompleteDraftAttachmentInput
  ) => Effect.Effect<DraftAttachmentUploadResult, RepositoryError>;
  readonly createDraft: (
    input: CreateDraftInput
  ) => Effect.Effect<DraftResult, RepositoryError>;
  readonly getDraft: (
    input: GetDraftInput
  ) => Effect.Effect<DraftResult, RepositoryError>;
  readonly getDraftAttachment: (
    input: GetDraftAttachmentInput
  ) => Effect.Effect<DraftAttachmentReservation, RepositoryError>;
  readonly listDraftAttachments: (
    input: ListDraftAttachmentsInput
  ) => Effect.Effect<DraftAttachmentList, RepositoryError>;
  readonly listDrafts: (
    input: ListDraftsInput
  ) => Effect.Effect<DraftPage, RepositoryError>;
  readonly reserveDraftAttachment: (
    input: ReserveDraftAttachmentCommand
  ) => Effect.Effect<DraftAttachmentReservation, RepositoryError>;
  readonly updateDraft: (
    input: UpdateDraftInput
  ) => Effect.Effect<DraftResult, RepositoryError>;
}

/** Draft persistence capability required by mailbox application services. */
export class MailboxDraftRepository extends Context.Service<
  MailboxDraftRepository,
  MailboxDraftRepositoryService
>()("cloudflare-inbox/MailboxDraftRepository") {}
