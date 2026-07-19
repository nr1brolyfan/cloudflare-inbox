import { RuntimeContext } from "alchemy";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { DirectoryRpcRequest, DirectoryRpcResponse } from "./directory-rpc";
import type {
  DirectoryRpcRequest as DirectoryRpcRequestType,
  DirectoryRpcResponse as DirectoryRpcResponseType,
  MailboxDomainErrorDto,
} from "./directory-rpc";
import { MailboxDomainError } from "./errors/mailbox-domain-error";
import { MailboxRepositoryError } from "./errors/mailbox-repository-error";
import type { MailDataRpcResponse as MailDataRpcResponseType } from "./mail-data-rpc";
import { executeMailDataRpc } from "./mail-data-rpc-client";
import {
  MailboxRepository,
  MailboxResourceLookup,
  MailboxResourceLookupResult,
} from "./mailbox-repository";
import type {
  MailboxResourceLookup as MailboxResourceLookupType,
  MailboxResourceLookupResult as MailboxResourceLookupResultType,
} from "./mailbox-repository";

export interface MailboxRepositoryDoConfig {
  readonly mailboxExists: (
    mailboxId: MailboxResourceLookupType["mailboxId"]
  ) => Effect.Effect<boolean, unknown>;
  readonly namespace: {
    readonly getByName: (name: string) => {
      readonly executeMailData: (
        input: unknown
      ) => Effect.Effect<unknown, unknown, RuntimeContext>;
      readonly executeDirectory: (
        input: unknown
      ) => Effect.Effect<unknown, unknown, RuntimeContext>;
      readonly resolveMailResource: (
        input: unknown
      ) => Effect.Effect<unknown, unknown, RuntimeContext>;
    };
  };
}

/** Cloudflare namespace used by the Worker-side repository adapter. */
export const MailboxRepositoryDoConfig =
  Context.Service<MailboxRepositoryDoConfig>(
    "cloudflare-inbox/MailboxRepositoryDoConfig"
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

const reconstructDomainError = (error: MailboxDomainErrorDto) =>
  new MailboxDomainError({
    operation: error.operation,
    reason: error.reason,
    message: error.message,
    resourceType: error.resourceType,
    resourceId: error.resourceId,
    expectedVersion: error.expectedVersion,
    actualVersion: error.actualVersion,
  });

const directoryOperation = (
  request: DirectoryRpcRequestType
): MailboxDomainError["operation"] => {
  switch (request._tag) {
    case "ListFolders": {
      return "list-folders";
    }
    case "CreateFolder": {
      return "create-folder";
    }
    case "RenameFolder": {
      return "rename-folder";
    }
    case "DeleteFolder": {
      return "delete-folder";
    }
    case "ListLabels": {
      return "list-labels";
    }
    case "CreateLabel": {
      return "create-label";
    }
    case "RenameLabel": {
      return "rename-label";
    }
    case "DeleteLabel": {
      return "delete-label";
    }
    default: {
      const exhaustive: never = request;
      return exhaustive;
    }
  }
};

const isDirectoryMutation = (request: DirectoryRpcRequestType) =>
  request._tag !== "ListFolders" && request._tag !== "ListLabels";

/** Routes trusted mailbox operations to the SQLite database owned by each MailboxDO. */
export const MailboxRepositoryDoLive = Layer.effect(
  MailboxRepository,
  Effect.gen(function* () {
    const config = yield* MailboxRepositoryDoConfig;
    const notFound: MailboxResourceLookupResultType = { _tag: "NotFound" };
    const executeDirectory = (
      request: DirectoryRpcRequestType
    ): Effect.Effect<
      DirectoryRpcResponseType,
      MailboxDomainError | MailboxRepositoryError
    > => {
      const operation = directoryOperation(request);
      const mutation = isDirectoryMutation(request);
      const repositoryOperation = mutation ? "write" : "read";
      const rpcCommitState = mutation ? "unknown" : "not-committed";
      return Schema.encodeEffect(DirectoryRpcRequest)(request).pipe(
        Effect.mapError((cause) =>
          repositoryError(
            "Invalid mailbox directory request",
            cause,
            repositoryOperation
          )
        ),
        Effect.flatMap((encoded) =>
          config.mailboxExists(request.input.mailboxId).pipe(
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
              > => {
                if (!exists) {
                  return Effect.fail(
                    new MailboxDomainError({
                      operation,
                      reason: "not-found",
                      message: "Mailbox was not found",
                      resourceType: "mailbox",
                      resourceId: request.input.mailboxId,
                    })
                  );
                }
                return config.namespace
                  .getByName(request.input.mailboxId)
                  .executeDirectory(encoded)
                  .pipe(
                    Effect.provide(RuntimeContext.phantom),
                    Effect.mapError((cause) =>
                      repositoryError(
                        "Mailbox directory RPC failed",
                        cause,
                        repositoryOperation,
                        rpcCommitState
                      )
                    ),
                    Effect.catchDefect((cause) =>
                      Effect.fail(
                        repositoryError(
                          "Mailbox directory RPC failed",
                          cause,
                          repositoryOperation,
                          rpcCommitState
                        )
                      )
                    )
                  );
              }
            )
          )
        ),
        Effect.flatMap((response) =>
          Schema.decodeUnknownEffect(DirectoryRpcResponse)(response).pipe(
            Effect.mapError((cause) =>
              repositoryError(
                "Mailbox directory RPC returned invalid data",
                cause,
                repositoryOperation,
                rpcCommitState
              )
            )
          )
        ),
        Effect.flatMap((response) => {
          if (
            response._tag === "DomainError" &&
            response.operation !== operation
          ) {
            return Effect.fail(
              repositoryError(
                "Mailbox directory RPC returned the wrong operation",
                response,
                repositoryOperation,
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
    const domainFailure = (
      response: MailboxDomainErrorDto
    ): Effect.Effect<never, MailboxDomainError | MailboxRepositoryError> =>
      Effect.fail(reconstructDomainError(response));
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
          config.mailboxExists(request.mailboxId).pipe(
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
                ? config.namespace
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
        executeMailDataRpc(config, { _tag: "AddMessageLabel", input }).pipe(
          Effect.flatMap((response) =>
            response._tag === "DomainError"
              ? domainFailure(response)
              : response._tag === "MessageMutated"
                ? Effect.succeed(response.value)
                : mailDataProtocolError(response, true)
          )
        ),
      cancelOutboundDelivery: (input) =>
        executeMailDataRpc(config, {
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
        executeMailDataRpc(config, { _tag: "CreateDraft", input }).pipe(
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
        executeMailDataRpc(config, { _tag: "GetDraft", input }).pipe(
          Effect.flatMap((response) =>
            response._tag === "DomainError"
              ? domainFailure(response)
              : response._tag === "DraftFound"
                ? Effect.succeed(response.value)
                : mailDataProtocolError(response, false)
          )
        ),
      getMessage: (input) =>
        executeMailDataRpc(config, { _tag: "GetMessage", input }).pipe(
          Effect.flatMap((response) =>
            response._tag === "DomainError"
              ? domainFailure(response)
              : response._tag === "MessageFound"
                ? Effect.succeed(response.value)
                : mailDataProtocolError(response, false)
          )
        ),
      getOutboundDelivery: (input) =>
        executeMailDataRpc(config, { _tag: "GetOutboundDelivery", input }).pipe(
          Effect.flatMap((response) =>
            response._tag === "DomainError"
              ? domainFailure(response)
              : response._tag === "OutboundFound"
                ? Effect.succeed(response.value)
                : mailDataProtocolError(response, false)
          )
        ),
      getThread: (input) =>
        executeMailDataRpc(config, { _tag: "GetThread", input }).pipe(
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
        executeMailDataRpc(config, { _tag: "ListMessages", input }).pipe(
          Effect.flatMap((response) =>
            response._tag === "DomainError"
              ? domainFailure(response)
              : response._tag === "MessagesListed"
                ? Effect.succeed(response.value)
                : mailDataProtocolError(response, false)
          )
        ),
      moveMessage: (input) =>
        executeMailDataRpc(config, { _tag: "MoveMessage", input }).pipe(
          Effect.flatMap((response) =>
            response._tag === "DomainError"
              ? domainFailure(response)
              : response._tag === "MessageMutated"
                ? Effect.succeed(response.value)
                : mailDataProtocolError(response, true)
          )
        ),
      removeMessageLabel: (input) =>
        executeMailDataRpc(config, { _tag: "RemoveMessageLabel", input }).pipe(
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
        executeMailDataRpc(config, { _tag: "ResendOutbound", input }).pipe(
          Effect.flatMap((response) =>
            response._tag === "DomainError"
              ? domainFailure(response)
              : response._tag === "OutboundResent"
                ? Effect.succeed(response.value)
                : mailDataProtocolError(response, true)
          )
        ),
      scheduleOutbound: (input) =>
        executeMailDataRpc(config, { _tag: "ScheduleOutbound", input }).pipe(
          Effect.flatMap((response) =>
            response._tag === "DomainError"
              ? domainFailure(response)
              : response._tag === "OutboundScheduled"
                ? Effect.succeed(response.value)
                : mailDataProtocolError(response, true)
          )
        ),
      setMessageRead: (input) =>
        executeMailDataRpc(config, { _tag: "SetMessageRead", input }).pipe(
          Effect.flatMap((response) =>
            response._tag === "DomainError"
              ? domainFailure(response)
              : response._tag === "MessageMutated"
                ? Effect.succeed(response.value)
                : mailDataProtocolError(response, true)
          )
        ),
      setMessageStarred: (input) =>
        executeMailDataRpc(config, { _tag: "SetMessageStarred", input }).pipe(
          Effect.flatMap((response) =>
            response._tag === "DomainError"
              ? domainFailure(response)
              : response._tag === "MessageMutated"
                ? Effect.succeed(response.value)
                : mailDataProtocolError(response, true)
          )
        ),
      updateDraft: (input) =>
        executeMailDataRpc(config, { _tag: "UpdateDraft", input }).pipe(
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
