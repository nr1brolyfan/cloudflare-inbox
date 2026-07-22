import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type {
  MailboxDomainError,
  MailboxRepositoryError,
} from "#/mailboxes/errors";
import type {
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
  SearchMessagesInput,
  SetMessageReadInput,
  SetMessageStarredInput,
} from "#/mailboxes/messages";

type RepositoryError = MailboxDomainError | MailboxRepositoryError;

export interface MailboxMessageRepositoryService {
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
