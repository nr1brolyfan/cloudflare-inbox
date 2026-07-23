import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { MailboxResourceRepository } from "#/modules/authorization/ports/MailboxResourceRepository";
import type { MailboxDomainError } from "#/modules/mailbox/domain/MailboxError";
import type { MessageMutationResult } from "#/modules/mailbox/domain/MailboxMessage";
import { MailboxDirectoryRepository } from "#/modules/mailbox/ports/MailboxDirectoryRepository";
import { MailboxDraftRepository } from "#/modules/mailbox/ports/MailboxDraftRepository";
import { MailboxMessageRepository } from "#/modules/mailbox/ports/MailboxMessageRepository";
import { MailboxOutboundDeliveryRepository } from "#/modules/mailbox/ports/MailboxOutboundDeliveryRepository";
import { MailboxOutboundSendingRepository } from "#/modules/mailbox/ports/MailboxOutboundSendingRepository";
import { MailboxRepositoryError } from "#/modules/mailbox/ports/MailboxRepositoryError";

import { MailboxDoClient } from "./MailboxDoClient";
import { decodeMailboxDomainError } from "./MailboxDoProtocol";
import type {
  DirectoryRpcResponse,
  MailDataRpcRequest,
  MailDataRpcResponse,
  MailboxDomainErrorDto,
} from "./MailboxDoProtocol";

type RepositoryError = MailboxDomainError | MailboxRepositoryError;

const domainFailure = (
  response: MailboxDomainErrorDto
): Effect.Effect<never, RepositoryError> =>
  Effect.fail(decodeMailboxDomainError(response));

const directoryProtocolError = (
  response: DirectoryRpcResponse,
  mutation: boolean
): Effect.Effect<never, RepositoryError> =>
  Effect.fail(
    new MailboxRepositoryError({
      cause: response,
      commitState: mutation ? "unknown" : "not-committed",
      message: "Mailbox directory RPC returned the wrong response type",
      operation: mutation ? "write" : "read",
    })
  );

const mailDataProtocolError = (
  response: MailDataRpcResponse,
  mutation: boolean
): Effect.Effect<never, RepositoryError> =>
  Effect.fail(
    new MailboxRepositoryError({
      cause: response,
      commitState: mutation ? "unknown" : "not-committed",
      message: "Mail data RPC returned the wrong response type",
      operation: mutation ? "write" : "read",
    })
  );

const wrongResource = (result: unknown) =>
  Effect.fail(
    new MailboxRepositoryError({
      cause: result,
      commitState: "not-committed",
      message: "Mailbox lookup returned the wrong resource type",
      operation: "read",
    })
  );

/** Direct Durable Object implementation of mailbox directory persistence. */
export const MailboxDirectoryRepositoryDoLayer = Layer.effect(
  MailboxDirectoryRepository,
  Effect.gen(function* () {
    const client = yield* MailboxDoClient;
    return MailboxDirectoryRepository.of({
      createFolder: (input) =>
        client
          .executeDirectory({ _tag: "CreateFolder", input })
          .pipe(
            Effect.flatMap((response) =>
              response._tag === "DomainError"
                ? domainFailure(response)
                : response._tag === "FolderCreated"
                  ? Effect.succeed(response.value)
                  : directoryProtocolError(response, true)
            )
          ),
      createLabel: (input) =>
        client
          .executeDirectory({ _tag: "CreateLabel", input })
          .pipe(
            Effect.flatMap((response) =>
              response._tag === "DomainError"
                ? domainFailure(response)
                : response._tag === "LabelCreated"
                  ? Effect.succeed(response.value)
                  : directoryProtocolError(response, true)
            )
          ),
      deleteFolder: (input) =>
        client
          .executeDirectory({ _tag: "DeleteFolder", input })
          .pipe(
            Effect.flatMap((response) =>
              response._tag === "DomainError"
                ? domainFailure(response)
                : response._tag === "FolderDeleted"
                  ? Effect.succeed(response.value)
                  : directoryProtocolError(response, true)
            )
          ),
      deleteLabel: (input) =>
        client
          .executeDirectory({ _tag: "DeleteLabel", input })
          .pipe(
            Effect.flatMap((response) =>
              response._tag === "DomainError"
                ? domainFailure(response)
                : response._tag === "LabelDeleted"
                  ? Effect.succeed(response.value)
                  : directoryProtocolError(response, true)
            )
          ),
      listFolders: (input) =>
        client
          .executeDirectory({ _tag: "ListFolders", input })
          .pipe(
            Effect.flatMap((response) =>
              response._tag === "DomainError"
                ? domainFailure(response)
                : response._tag === "FoldersListed"
                  ? Effect.succeed(response.value)
                  : directoryProtocolError(response, false)
            )
          ),
      listLabels: (input) =>
        client
          .executeDirectory({ _tag: "ListLabels", input })
          .pipe(
            Effect.flatMap((response) =>
              response._tag === "DomainError"
                ? domainFailure(response)
                : response._tag === "LabelsListed"
                  ? Effect.succeed(response.value)
                  : directoryProtocolError(response, false)
            )
          ),
      renameFolder: (input) =>
        client
          .executeDirectory({ _tag: "RenameFolder", input })
          .pipe(
            Effect.flatMap((response) =>
              response._tag === "DomainError"
                ? domainFailure(response)
                : response._tag === "FolderRenamed"
                  ? Effect.succeed(response.value)
                  : directoryProtocolError(response, true)
            )
          ),
      renameLabel: (input) =>
        client
          .executeDirectory({ _tag: "RenameLabel", input })
          .pipe(
            Effect.flatMap((response) =>
              response._tag === "DomainError"
                ? domainFailure(response)
                : response._tag === "LabelRenamed"
                  ? Effect.succeed(response.value)
                  : directoryProtocolError(response, true)
            )
          ),
    });
  })
);

/** Direct Durable Object implementation of mailbox message persistence. */
export const MailboxMessageRepositoryDoLayer = Layer.effect(
  MailboxMessageRepository,
  Effect.gen(function* () {
    const client = yield* MailboxDoClient;
    type MessageMutationRequest = Extract<
      MailDataRpcRequest,
      {
        readonly _tag:
          | "AddMessageLabel"
          | "MoveMessage"
          | "RemoveMessageLabel"
          | "SetMessageRead"
          | "SetMessageStarred";
      }
    >;
    const mutation = (
      request: MessageMutationRequest
    ): Effect.Effect<MessageMutationResult, RepositoryError> =>
      client
        .executeMailData(request)
        .pipe(
          Effect.flatMap((response) =>
            response._tag === "DomainError"
              ? domainFailure(response)
              : response._tag === "MessageMutated"
                ? Effect.succeed(response.value)
                : mailDataProtocolError(response, true)
          )
        );

    return MailboxMessageRepository.of({
      addMessageLabel: (input) => mutation({ _tag: "AddMessageLabel", input }),
      getAttachmentBlob: (input) =>
        client
          .executeMailData({ _tag: "GetAttachmentBlob", input })
          .pipe(
            Effect.flatMap((response) =>
              response._tag === "DomainError"
                ? domainFailure(response)
                : response._tag === "AttachmentBlobFound"
                  ? Effect.succeed(response.value)
                  : mailDataProtocolError(response, false)
            )
          ),
      getMessage: (input) =>
        client
          .executeMailData({ _tag: "GetMessage", input })
          .pipe(
            Effect.flatMap((response) =>
              response._tag === "DomainError"
                ? domainFailure(response)
                : response._tag === "MessageFound"
                  ? Effect.succeed(response.value)
                  : mailDataProtocolError(response, false)
            )
          ),
      getThread: (input) =>
        client
          .executeMailData({ _tag: "GetThread", input })
          .pipe(
            Effect.flatMap((response) =>
              response._tag === "DomainError"
                ? domainFailure(response)
                : response._tag === "ThreadFound"
                  ? Effect.succeed(response.value)
                  : mailDataProtocolError(response, false)
            )
          ),
      listMessages: (input) =>
        client
          .executeMailData({ _tag: "ListMessages", input })
          .pipe(
            Effect.flatMap((response) =>
              response._tag === "DomainError"
                ? domainFailure(response)
                : response._tag === "MessagesListed"
                  ? Effect.succeed(response.value)
                  : mailDataProtocolError(response, false)
            )
          ),
      moveMessage: (input) => mutation({ _tag: "MoveMessage", input }),
      removeMessageLabel: (input) =>
        mutation({ _tag: "RemoveMessageLabel", input }),
      searchMessages: (input) =>
        client
          .executeMailData({ _tag: "SearchMessages", input })
          .pipe(
            Effect.flatMap((response) =>
              response._tag === "DomainError"
                ? domainFailure(response)
                : response._tag === "MessagesSearched"
                  ? Effect.succeed(response.value)
                  : mailDataProtocolError(response, false)
            )
          ),
      setMessageRead: (input) => mutation({ _tag: "SetMessageRead", input }),
      setMessageStarred: (input) =>
        mutation({ _tag: "SetMessageStarred", input }),
    });
  })
);

/** Direct Durable Object implementation of mailbox draft persistence. */
export const MailboxDraftRepositoryDoLayer = Layer.effect(
  MailboxDraftRepository,
  Effect.gen(function* () {
    const client = yield* MailboxDoClient;
    return MailboxDraftRepository.of({
      completeDraftAttachment: (input) =>
        client
          .executeMailData({ _tag: "CompleteDraftAttachment", input })
          .pipe(
            Effect.flatMap((response) =>
              response._tag === "DomainError"
                ? domainFailure(response)
                : response._tag === "DraftAttachmentCompleted"
                  ? Effect.succeed(response.value)
                  : mailDataProtocolError(response, true)
            )
          ),
      createDraft: (input) =>
        client
          .executeMailData({ _tag: "CreateDraft", input })
          .pipe(
            Effect.flatMap((response) =>
              response._tag === "DomainError"
                ? domainFailure(response)
                : response._tag === "DraftCreated"
                  ? Effect.succeed(response.value)
                  : mailDataProtocolError(response, true)
            )
          ),
      getDraft: (input) =>
        client
          .executeMailData({ _tag: "GetDraft", input })
          .pipe(
            Effect.flatMap((response) =>
              response._tag === "DomainError"
                ? domainFailure(response)
                : response._tag === "DraftFound"
                  ? Effect.succeed(response.value)
                  : mailDataProtocolError(response, false)
            )
          ),
      getDraftAttachment: (input) =>
        client
          .executeMailData({ _tag: "GetDraftAttachment", input })
          .pipe(
            Effect.flatMap((response) =>
              response._tag === "DomainError"
                ? domainFailure(response)
                : response._tag === "DraftAttachmentFound"
                  ? Effect.succeed(response.value)
                  : mailDataProtocolError(response, false)
            )
          ),
      listDraftAttachments: (input) =>
        client
          .executeMailData({ _tag: "ListDraftAttachments", input })
          .pipe(
            Effect.flatMap((response) =>
              response._tag === "DomainError"
                ? domainFailure(response)
                : response._tag === "DraftAttachmentsListed"
                  ? Effect.succeed(response.value)
                  : mailDataProtocolError(response, false)
            )
          ),
      listDrafts: (input) =>
        client
          .executeMailData({ _tag: "ListDrafts", input })
          .pipe(
            Effect.flatMap((response) =>
              response._tag === "DomainError"
                ? domainFailure(response)
                : response._tag === "DraftsListed"
                  ? Effect.succeed(response.value)
                  : mailDataProtocolError(response, false)
            )
          ),
      reserveDraftAttachment: (input) =>
        client
          .executeMailData({ _tag: "ReserveDraftAttachment", input })
          .pipe(
            Effect.flatMap((response) =>
              response._tag === "DomainError"
                ? domainFailure(response)
                : response._tag === "DraftAttachmentReserved"
                  ? Effect.succeed(response.value)
                  : mailDataProtocolError(response, true)
            )
          ),
      updateDraft: (input) =>
        client
          .executeMailData({ _tag: "UpdateDraft", input })
          .pipe(
            Effect.flatMap((response) =>
              response._tag === "DomainError"
                ? domainFailure(response)
                : response._tag === "DraftUpdated"
                  ? Effect.succeed(response.value)
                  : mailDataProtocolError(response, true)
            )
          ),
    });
  })
);

export const MailboxOutboundDeliveryRepositoryDoLayer = Layer.effect(
  MailboxOutboundDeliveryRepository,
  Effect.gen(function* () {
    const client = yield* MailboxDoClient;
    return MailboxOutboundDeliveryRepository.of({
      getOutboundDelivery: (input) =>
        client
          .executeMailData({ _tag: "GetOutboundDelivery", input })
          .pipe(
            Effect.flatMap((response) =>
              response._tag === "DomainError"
                ? domainFailure(response)
                : response._tag === "OutboundFound"
                  ? Effect.succeed(response.value)
                  : mailDataProtocolError(response, false)
            )
          ),
    });
  })
);

export const MailboxOutboundSendingRepositoryDoLayer = Layer.effect(
  MailboxOutboundSendingRepository,
  Effect.gen(function* () {
    const client = yield* MailboxDoClient;
    return MailboxOutboundSendingRepository.of({
      cancelOutboundDelivery: (input) =>
        client
          .executeMailData({ _tag: "CancelOutboundDelivery", input })
          .pipe(
            Effect.flatMap((response) =>
              response._tag === "DomainError"
                ? domainFailure(response)
                : response._tag === "OutboundCancelled"
                  ? Effect.succeed(response.value)
                  : mailDataProtocolError(response, true)
            )
          ),
      resendOutbound: (input) =>
        client
          .executeMailData({ _tag: "ResendOutbound", input })
          .pipe(
            Effect.flatMap((response) =>
              response._tag === "DomainError"
                ? domainFailure(response)
                : response._tag === "OutboundResent"
                  ? Effect.succeed(response.value)
                  : mailDataProtocolError(response, true)
            )
          ),
      scheduleOutbound: (input) =>
        client
          .executeMailData({ _tag: "ScheduleOutbound", input })
          .pipe(
            Effect.flatMap((response) =>
              response._tag === "DomainError"
                ? domainFailure(response)
                : response._tag === "OutboundScheduled"
                  ? Effect.succeed(response.value)
                  : mailDataProtocolError(response, true)
            )
          ),
    });
  })
);

/** Direct Durable Object implementation of trusted authorization ancestry. */
export const MailboxResourceRepositoryDoLayer = Layer.effect(
  MailboxResourceRepository,
  Effect.gen(function* () {
    const client = yield* MailboxDoClient;

    return MailboxResourceRepository.of({
      findAttachmentLocation: (input) =>
        client
          .resolveMailResource({ _tag: "Attachment", ...input })
          .pipe(
            Effect.flatMap((result) =>
              result._tag === "NotFound"
                ? Effect.succeed(Option.none())
                : result._tag === "Attachment"
                  ? Effect.succeed(Option.some(result))
                  : wrongResource(result)
            )
          ),
      findDraftLocation: (input) =>
        client
          .resolveMailResource({ _tag: "Draft", ...input })
          .pipe(
            Effect.flatMap((result) =>
              result._tag === "NotFound"
                ? Effect.succeed(Option.none())
                : result._tag === "Draft"
                  ? Effect.succeed(Option.some(result))
                  : wrongResource(result)
            )
          ),
      findFolderLocation: (input) =>
        client
          .resolveMailResource({ _tag: "Folder", ...input })
          .pipe(
            Effect.flatMap((result) =>
              result._tag === "NotFound"
                ? Effect.succeed(Option.none())
                : result._tag === "Folder"
                  ? Effect.succeed(Option.some(result))
                  : wrongResource(result)
            )
          ),
      findMessageLocation: (input) =>
        client
          .resolveMailResource({ _tag: "Message", ...input })
          .pipe(
            Effect.flatMap((result) =>
              result._tag === "NotFound"
                ? Effect.succeed(Option.none())
                : result._tag === "Message"
                  ? Effect.succeed(Option.some(result))
                  : wrongResource(result)
            )
          ),
      findRuleLocation: (input) =>
        client
          .resolveMailResource({ _tag: "Rule", ...input })
          .pipe(
            Effect.flatMap((result) =>
              result._tag === "NotFound"
                ? Effect.succeed(Option.none())
                : result._tag === "Rule"
                  ? Effect.succeed(Option.some(result))
                  : wrongResource(result)
            )
          ),
    });
  })
);
