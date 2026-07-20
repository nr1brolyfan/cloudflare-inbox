import { RuntimeContext } from "alchemy";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { MailboxId } from "./core";
import {
  decodeMailboxDomainError,
  DirectoryRpcRequest,
  DirectoryRpcResponse,
  directoryRequestMetadata,
  directoryResponseMatchesRequest,
  MailDataRpcRequest,
  MailDataRpcResponse,
  mailDataRequestMetadata,
  mailDataResponseMatchesRequest,
} from "./do-protocol";
import type {
  DirectoryRpcRequest as DirectoryRpcRequestType,
  DirectoryRpcResponse as DirectoryRpcResponseType,
  MailDataRpcRequest as MailDataRpcRequestType,
  MailDataRpcResponse as MailDataRpcResponseType,
  MailboxDomainErrorDto,
} from "./do-protocol";
import { MailboxDomainError, MailboxRepositoryError } from "./errors";
import { MailboxRepository } from "./repository";
import {
  MailboxResourceLookup,
  MailboxResourceLookupResult,
} from "./resource-location";
import type {
  MailboxResourceLookup as MailboxResourceLookupType,
  MailboxResourceLookupResult as MailboxResourceLookupResultType,
} from "./resource-location";

export interface MailboxRegistry {
  readonly exists: (mailboxId: MailboxId) => Effect.Effect<boolean, unknown>;
}

/** Control-plane existence check performed before a mailbox DO is materialized. */
export const MailboxRegistry = Context.Service<MailboxRegistry>(
  "cloudflare-inbox/MailboxRegistry"
);

export interface MailboxDoStub {
  readonly executeDirectory: (
    input: unknown
  ) => Effect.Effect<unknown, unknown, RuntimeContext>;
  readonly executeMailData: (
    input: unknown
  ) => Effect.Effect<unknown, unknown, RuntimeContext>;
  readonly resolveMailResource: (
    input: unknown
  ) => Effect.Effect<unknown, unknown, RuntimeContext>;
}

export interface MailboxDoNamespace {
  readonly getByName: (name: string) => MailboxDoStub;
}

/** Typed Cloudflare namespace used by the concrete Worker-side adapter. */
export const MailboxDoNamespace = Context.Service<MailboxDoNamespace>(
  "cloudflare-inbox/MailboxDoNamespace"
);

const repositoryError = (
  message: string,
  cause: unknown,
  operation: "read" | "write" = "read",
  commitState: "not-committed" | "unknown" = "not-committed"
) =>
  new MailboxRepositoryError({
    cause,
    commitState,
    message,
    operation,
  });

const domainFailure = (
  response: MailboxDomainErrorDto
): Effect.Effect<never, MailboxDomainError | MailboxRepositoryError> =>
  Effect.fail(decodeMailboxDomainError(response));

/** Routes trusted mailbox operations to the SQLite database owned by each MailboxDO. */
export const MailboxRepositoryDoLive = Layer.effect(
  MailboxRepository,
  Effect.gen(function* () {
    const registry = yield* MailboxRegistry;
    const namespace = yield* MailboxDoNamespace;
    const notFound: MailboxResourceLookupResultType = { _tag: "NotFound" };
    const invokeRpc = (
      mailboxId: MailboxId,
      operation: MailboxDomainError["operation"],
      repositoryOperation: "read" | "write",
      commitState: "not-committed" | "unknown",
      message: string,
      invoke: (
        stub: ReturnType<MailboxDoNamespace["getByName"]>
      ) => Effect.Effect<unknown, unknown, RuntimeContext>
    ): Effect.Effect<unknown, MailboxDomainError | MailboxRepositoryError> =>
      registry.exists(mailboxId).pipe(
        Effect.mapError((cause) =>
          repositoryError(
            "Mailbox registry lookup failed",
            cause,
            repositoryOperation
          )
        ),
        Effect.catchDefect((cause) =>
          Effect.fail(
            repositoryError(
              "Mailbox registry lookup failed",
              cause,
              repositoryOperation
            )
          )
        ),
        Effect.flatMap(
          (
            exists
          ): Effect.Effect<
            unknown,
            MailboxDomainError | MailboxRepositoryError
          > =>
            exists
              ? invoke(namespace.getByName(mailboxId)).pipe(
                  // Alchemy's generated adapter requires this phantom runtime only at its call site.
                  Effect.provide(RuntimeContext.phantom),
                  Effect.mapError((cause) =>
                    repositoryError(
                      message,
                      cause,
                      repositoryOperation,
                      commitState
                    )
                  ),
                  Effect.catchDefect((cause) =>
                    Effect.fail(
                      repositoryError(
                        message,
                        cause,
                        repositoryOperation,
                        commitState
                      )
                    )
                  )
                )
              : Effect.fail(
                  new MailboxDomainError({
                    operation,
                    reason: "not-found",
                    message: "Mailbox was not found",
                    resourceType: "mailbox",
                    resourceId: mailboxId,
                  })
                )
        )
      );
    const executeDirectory = (
      request: DirectoryRpcRequestType
    ): Effect.Effect<
      DirectoryRpcResponseType,
      MailboxDomainError | MailboxRepositoryError
    > => {
      const metadata = directoryRequestMetadata(request);
      const rpcCommitState =
        metadata.kind === "write" ? "unknown" : "not-committed";
      return Schema.encodeEffect(DirectoryRpcRequest)(request).pipe(
        Effect.mapError((cause) =>
          repositoryError(
            "Invalid mailbox directory request",
            cause,
            metadata.kind
          )
        ),
        Effect.flatMap((encoded) =>
          invokeRpc(
            request.input.mailboxId,
            metadata.operation,
            metadata.kind,
            rpcCommitState,
            "Mailbox directory RPC failed",
            (stub) => stub.executeDirectory(encoded)
          )
        ),
        Effect.flatMap((response) =>
          Schema.decodeUnknownEffect(DirectoryRpcResponse)(response).pipe(
            Effect.mapError((cause) =>
              repositoryError(
                "Mailbox directory RPC returned invalid data",
                cause,
                metadata.kind,
                rpcCommitState
              )
            )
          )
        ),
        Effect.flatMap((response) => {
          if (
            response._tag === "DomainError" &&
            response.operation !== metadata.operation
          ) {
            return Effect.fail(
              repositoryError(
                "Mailbox directory RPC returned the wrong operation",
                response,
                metadata.kind,
                rpcCommitState
              )
            );
          }
          if (!directoryResponseMatchesRequest(request, response)) {
            return Effect.fail(
              repositoryError(
                "Mailbox directory RPC returned the wrong response type",
                response,
                metadata.kind,
                rpcCommitState
              )
            );
          }
          return Effect.succeed(response);
        })
      );
    };
    const executeMailData = (
      request: MailDataRpcRequestType
    ): Effect.Effect<
      MailDataRpcResponseType,
      MailboxDomainError | MailboxRepositoryError
    > => {
      const metadata = mailDataRequestMetadata(request);
      const rpcCommitState =
        metadata.kind === "write" ? "unknown" : "not-committed";
      return Schema.encodeEffect(MailDataRpcRequest)(request).pipe(
        Effect.mapError((cause) =>
          repositoryError("Invalid mail data request", cause, metadata.kind)
        ),
        Effect.flatMap((encoded) =>
          invokeRpc(
            request.input.mailboxId,
            metadata.operation,
            metadata.kind,
            rpcCommitState,
            "Mail data RPC failed",
            (stub) => stub.executeMailData(encoded)
          )
        ),
        Effect.flatMap((response) =>
          Schema.decodeUnknownEffect(MailDataRpcResponse)(response).pipe(
            Effect.mapError((cause) =>
              repositoryError(
                "Mail data RPC returned invalid data",
                cause,
                metadata.kind,
                rpcCommitState
              )
            )
          )
        ),
        Effect.flatMap((response) => {
          if (
            response._tag === "DomainError" &&
            response.operation !== metadata.operation
          ) {
            return Effect.fail(
              repositoryError(
                "Mail data RPC returned the wrong operation",
                response,
                metadata.kind,
                rpcCommitState
              )
            );
          }
          if (!mailDataResponseMatchesRequest(request, response)) {
            return Effect.fail(
              repositoryError(
                "Mail data RPC returned the wrong response type",
                response,
                metadata.kind,
                rpcCommitState
              )
            );
          }
          return Effect.succeed(response);
        })
      );
    };
    const protocolError = (
      response: DirectoryRpcResponseType,
      mutation: boolean
    ): Effect.Effect<never, MailboxDomainError | MailboxRepositoryError> =>
      Effect.fail(
        repositoryError(
          "Mailbox directory RPC returned the wrong response type",
          response,
          mutation ? "write" : "read",
          mutation ? "unknown" : "not-committed"
        )
      );
    const mailDataProtocolError = (
      response: MailDataRpcResponseType,
      mutation: boolean
    ): Effect.Effect<never, MailboxDomainError | MailboxRepositoryError> =>
      Effect.fail(
        repositoryError(
          "Mail data RPC returned the wrong response type",
          response,
          mutation ? "write" : "read",
          mutation ? "unknown" : "not-committed"
        )
      );
    const lookup = (request: MailboxResourceLookupType) =>
      Schema.encodeEffect(MailboxResourceLookup)(request).pipe(
        Effect.mapError((cause) =>
          repositoryError("Invalid mailbox lookup", cause)
        ),
        Effect.flatMap((encoded) =>
          registry.exists(request.mailboxId).pipe(
            Effect.mapError((cause) =>
              repositoryError("Mailbox registry lookup failed", cause)
            ),
            Effect.catchDefect((cause) =>
              Effect.fail(
                repositoryError("Mailbox registry lookup failed", cause)
              )
            ),
            Effect.flatMap((exists) =>
              exists
                ? namespace
                    .getByName(request.mailboxId)
                    .resolveMailResource(encoded)
                    .pipe(
                      Effect.provide(RuntimeContext.phantom),
                      Effect.mapError((cause) =>
                        repositoryError("Mailbox resource lookup failed", cause)
                      ),
                      Effect.catchDefect((cause) =>
                        Effect.fail(
                          repositoryError(
                            "Mailbox resource lookup failed",
                            cause
                          )
                        )
                      )
                    )
                : Effect.succeed(notFound)
            )
          )
        ),
        Effect.flatMap((response) =>
          Schema.decodeUnknownEffect(MailboxResourceLookupResult)(
            response
          ).pipe(
            Effect.mapError((cause) =>
              repositoryError("Mailbox lookup returned invalid data", cause)
            )
          )
        )
      );
    const wrongResource = (result: unknown) =>
      Effect.fail(
        repositoryError(
          "Mailbox lookup returned the wrong resource type",
          result
        )
      );

    return MailboxRepository.of({
      addMessageLabel: (input) =>
        executeMailData({ _tag: "AddMessageLabel", input }).pipe(
          Effect.flatMap((response) =>
            response._tag === "DomainError"
              ? domainFailure(response)
              : response._tag === "MessageMutated"
                ? Effect.succeed(response.value)
                : mailDataProtocolError(response, true)
          )
        ),
      cancelOutboundDelivery: (input) =>
        executeMailData({
          _tag: "CancelOutboundDelivery",
          input,
        }).pipe(
          Effect.flatMap((response) =>
            response._tag === "DomainError"
              ? domainFailure(response)
              : response._tag === "OutboundCancelled"
                ? Effect.succeed(response.value)
                : mailDataProtocolError(response, true)
          )
        ),
      createDraft: (input) =>
        executeMailData({ _tag: "CreateDraft", input }).pipe(
          Effect.flatMap((response) =>
            response._tag === "DomainError"
              ? domainFailure(response)
              : response._tag === "DraftCreated"
                ? Effect.succeed(response.value)
                : mailDataProtocolError(response, true)
          )
        ),
      createFolder: (input) =>
        executeDirectory({ _tag: "CreateFolder", input }).pipe(
          Effect.flatMap((response) => {
            if (response._tag === "DomainError") {
              return domainFailure(response);
            }
            return response._tag === "FolderCreated"
              ? Effect.succeed(response.value)
              : protocolError(response, true);
          })
        ),
      createLabel: (input) =>
        executeDirectory({ _tag: "CreateLabel", input }).pipe(
          Effect.flatMap((response) => {
            if (response._tag === "DomainError") {
              return domainFailure(response);
            }
            return response._tag === "LabelCreated"
              ? Effect.succeed(response.value)
              : protocolError(response, true);
          })
        ),
      deleteFolder: (input) =>
        executeDirectory({ _tag: "DeleteFolder", input }).pipe(
          Effect.flatMap((response) => {
            if (response._tag === "DomainError") {
              return domainFailure(response);
            }
            return response._tag === "FolderDeleted"
              ? Effect.succeed(response.value)
              : protocolError(response, true);
          })
        ),
      deleteLabel: (input) =>
        executeDirectory({ _tag: "DeleteLabel", input }).pipe(
          Effect.flatMap((response) => {
            if (response._tag === "DomainError") {
              return domainFailure(response);
            }
            return response._tag === "LabelDeleted"
              ? Effect.succeed(response.value)
              : protocolError(response, true);
          })
        ),
      findAttachmentLocation: (input) =>
        lookup({ _tag: "Attachment", ...input }).pipe(
          Effect.flatMap((result) => {
            if (result._tag === "NotFound") {
              return Effect.succeed(Option.none());
            }
            return result._tag === "Attachment"
              ? Effect.succeed(Option.some(result))
              : wrongResource(result);
          })
        ),
      findDraftLocation: (input) =>
        lookup({ _tag: "Draft", ...input }).pipe(
          Effect.flatMap((result) => {
            if (result._tag === "NotFound") {
              return Effect.succeed(Option.none());
            }
            return result._tag === "Draft"
              ? Effect.succeed(Option.some(result))
              : wrongResource(result);
          })
        ),
      findFolderLocation: (input) =>
        lookup({ _tag: "Folder", ...input }).pipe(
          Effect.flatMap((result) => {
            if (result._tag === "NotFound") {
              return Effect.succeed(Option.none());
            }
            return result._tag === "Folder"
              ? Effect.succeed(Option.some(result))
              : wrongResource(result);
          })
        ),
      findMessageLocation: (input) =>
        lookup({ _tag: "Message", ...input }).pipe(
          Effect.flatMap((result) => {
            if (result._tag === "NotFound") {
              return Effect.succeed(Option.none());
            }
            return result._tag === "Message"
              ? Effect.succeed(Option.some(result))
              : wrongResource(result);
          })
        ),
      findRuleLocation: (input) =>
        lookup({ _tag: "Rule", ...input }).pipe(
          Effect.flatMap((result) => {
            if (result._tag === "NotFound") {
              return Effect.succeed(Option.none());
            }
            return result._tag === "Rule"
              ? Effect.succeed(Option.some(result))
              : wrongResource(result);
          })
        ),
      getDraft: (input) =>
        executeMailData({ _tag: "GetDraft", input }).pipe(
          Effect.flatMap((response) =>
            response._tag === "DomainError"
              ? domainFailure(response)
              : response._tag === "DraftFound"
                ? Effect.succeed(response.value)
                : mailDataProtocolError(response, false)
          )
        ),
      getAttachmentBlob: (input) =>
        executeMailData({ _tag: "GetAttachmentBlob", input }).pipe(
          Effect.flatMap((response) =>
            response._tag === "DomainError"
              ? domainFailure(response)
              : response._tag === "AttachmentBlobFound"
                ? Effect.succeed(response.value)
                : mailDataProtocolError(response, false)
          )
        ),
      getMessage: (input) =>
        executeMailData({ _tag: "GetMessage", input }).pipe(
          Effect.flatMap((response) =>
            response._tag === "DomainError"
              ? domainFailure(response)
              : response._tag === "MessageFound"
                ? Effect.succeed(response.value)
                : mailDataProtocolError(response, false)
          )
        ),
      getOutboundDelivery: (input) =>
        executeMailData({ _tag: "GetOutboundDelivery", input }).pipe(
          Effect.flatMap((response) =>
            response._tag === "DomainError"
              ? domainFailure(response)
              : response._tag === "OutboundFound"
                ? Effect.succeed(response.value)
                : mailDataProtocolError(response, false)
          )
        ),
      getThread: (input) =>
        executeMailData({ _tag: "GetThread", input }).pipe(
          Effect.flatMap((response) =>
            response._tag === "DomainError"
              ? domainFailure(response)
              : response._tag === "ThreadFound"
                ? Effect.succeed(response.value)
                : mailDataProtocolError(response, false)
          )
        ),
      listFolders: (input) =>
        executeDirectory({ _tag: "ListFolders", input }).pipe(
          Effect.flatMap((response) => {
            if (response._tag === "DomainError") {
              return domainFailure(response);
            }
            return response._tag === "FoldersListed"
              ? Effect.succeed(response.value)
              : protocolError(response, false);
          })
        ),
      listLabels: (input) =>
        executeDirectory({ _tag: "ListLabels", input }).pipe(
          Effect.flatMap((response) => {
            if (response._tag === "DomainError") {
              return domainFailure(response);
            }
            return response._tag === "LabelsListed"
              ? Effect.succeed(response.value)
              : protocolError(response, false);
          })
        ),
      listMessages: (input) =>
        executeMailData({ _tag: "ListMessages", input }).pipe(
          Effect.flatMap((response) =>
            response._tag === "DomainError"
              ? domainFailure(response)
              : response._tag === "MessagesListed"
                ? Effect.succeed(response.value)
                : mailDataProtocolError(response, false)
          )
        ),
      searchMessages: (input) =>
        executeMailData({ _tag: "SearchMessages", input }).pipe(
          Effect.flatMap((response) =>
            response._tag === "DomainError"
              ? domainFailure(response)
              : response._tag === "MessagesSearched"
                ? Effect.succeed(response.value)
                : mailDataProtocolError(response, false)
          )
        ),
      moveMessage: (input) =>
        executeMailData({ _tag: "MoveMessage", input }).pipe(
          Effect.flatMap((response) =>
            response._tag === "DomainError"
              ? domainFailure(response)
              : response._tag === "MessageMutated"
                ? Effect.succeed(response.value)
                : mailDataProtocolError(response, true)
          )
        ),
      removeMessageLabel: (input) =>
        executeMailData({ _tag: "RemoveMessageLabel", input }).pipe(
          Effect.flatMap((response) =>
            response._tag === "DomainError"
              ? domainFailure(response)
              : response._tag === "MessageMutated"
                ? Effect.succeed(response.value)
                : mailDataProtocolError(response, true)
          )
        ),
      renameFolder: (input) =>
        executeDirectory({ _tag: "RenameFolder", input }).pipe(
          Effect.flatMap((response) => {
            if (response._tag === "DomainError") {
              return domainFailure(response);
            }
            return response._tag === "FolderRenamed"
              ? Effect.succeed(response.value)
              : protocolError(response, true);
          })
        ),
      renameLabel: (input) =>
        executeDirectory({ _tag: "RenameLabel", input }).pipe(
          Effect.flatMap((response) => {
            if (response._tag === "DomainError") {
              return domainFailure(response);
            }
            return response._tag === "LabelRenamed"
              ? Effect.succeed(response.value)
              : protocolError(response, true);
          })
        ),
      resendOutbound: (input) =>
        executeMailData({ _tag: "ResendOutbound", input }).pipe(
          Effect.flatMap((response) =>
            response._tag === "DomainError"
              ? domainFailure(response)
              : response._tag === "OutboundResent"
                ? Effect.succeed(response.value)
                : mailDataProtocolError(response, true)
          )
        ),
      scheduleOutbound: (input) =>
        executeMailData({ _tag: "ScheduleOutbound", input }).pipe(
          Effect.flatMap((response) =>
            response._tag === "DomainError"
              ? domainFailure(response)
              : response._tag === "OutboundScheduled"
                ? Effect.succeed(response.value)
                : mailDataProtocolError(response, true)
          )
        ),
      setMessageRead: (input) =>
        executeMailData({ _tag: "SetMessageRead", input }).pipe(
          Effect.flatMap((response) =>
            response._tag === "DomainError"
              ? domainFailure(response)
              : response._tag === "MessageMutated"
                ? Effect.succeed(response.value)
                : mailDataProtocolError(response, true)
          )
        ),
      setMessageStarred: (input) =>
        executeMailData({ _tag: "SetMessageStarred", input }).pipe(
          Effect.flatMap((response) =>
            response._tag === "DomainError"
              ? domainFailure(response)
              : response._tag === "MessageMutated"
                ? Effect.succeed(response.value)
                : mailDataProtocolError(response, true)
          )
        ),
      updateDraft: (input) =>
        executeMailData({ _tag: "UpdateDraft", input }).pipe(
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
