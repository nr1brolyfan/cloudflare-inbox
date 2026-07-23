import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type { MailboxDomainError } from "#/modules/mailbox/domain/MailboxError";
import type {
  AddMessageLabelInput,
  AttachmentBlobLocation,
  GetAttachmentBlobInput,
  GetMessageInput,
  GetMessageResult,
  GetThreadInput,
  GetThreadResult,
  ListMessagesInput,
  MessageMutationResult,
  MessagePage,
  MoveMessageInput,
  RemoveMessageLabelInput,
  SearchMessagesInput,
  SetMessageReadInput,
  SetMessageStarredInput,
} from "#/modules/mailbox/domain/MailboxMessage";
import type { MailboxRepositoryError } from "#/modules/mailbox/ports/MailboxRepositoryError";

type RepositoryError = MailboxDomainError | MailboxRepositoryError;

export interface MailboxMessageRepositoryService {
  readonly addMessageLabel: (
    input: AddMessageLabelInput
  ) => Effect.Effect<MessageMutationResult, RepositoryError>;
  readonly getAttachmentBlob: (
    input: GetAttachmentBlobInput
  ) => Effect.Effect<AttachmentBlobLocation, RepositoryError>;
  readonly getMessage: (
    input: GetMessageInput
  ) => Effect.Effect<GetMessageResult, RepositoryError>;
  readonly getThread: (
    input: GetThreadInput
  ) => Effect.Effect<GetThreadResult, RepositoryError>;
  readonly listMessages: (
    input: ListMessagesInput
  ) => Effect.Effect<MessagePage, RepositoryError>;
  readonly moveMessage: (
    input: MoveMessageInput
  ) => Effect.Effect<MessageMutationResult, RepositoryError>;
  readonly removeMessageLabel: (
    input: RemoveMessageLabelInput
  ) => Effect.Effect<MessageMutationResult, RepositoryError>;
  readonly searchMessages: (
    input: SearchMessagesInput
  ) => Effect.Effect<MessagePage, RepositoryError>;
  readonly setMessageRead: (
    input: SetMessageReadInput
  ) => Effect.Effect<MessageMutationResult, RepositoryError>;
  readonly setMessageStarred: (
    input: SetMessageStarredInput
  ) => Effect.Effect<MessageMutationResult, RepositoryError>;
}

/** Message persistence capability required by mailbox application services. */
export class MailboxMessageRepository extends Context.Service<
  MailboxMessageRepository,
  MailboxMessageRepositoryService
>()("cloudflare-inbox/MailboxMessageRepository") {}
