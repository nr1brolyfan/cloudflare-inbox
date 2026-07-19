import { RuntimeContext } from "alchemy";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { MailboxDomainError } from "./errors/mailbox-domain-error";
import { MailboxRepositoryError } from "./errors/mailbox-repository-error";
import { MailDataRpcRequest, MailDataRpcResponse } from "./mail-data-rpc";
import type {
  MailDataRpcRequest as MailDataRpcRequestType,
  MailDataRpcResponse as MailDataRpcResponseType,
} from "./mail-data-rpc";
import type { MailboxRepositoryDoConfig } from "./mailbox-repository-do";

const repositoryError = (
  message: string,
  cause: unknown,
  operation: "read" | "write",
  commitState: "not-committed" | "unknown"
) => new MailboxRepositoryError({ cause, commitState, message, operation });

const mailDataOperations = {
  ListMessages: "list-messages",
  GetMessage: "get-message",
  GetThread: "get-thread",
  SetMessageRead: "mutate-message",
  SetMessageStarred: "mutate-message",
  MoveMessage: "mutate-message",
  AddMessageLabel: "mutate-message",
  RemoveMessageLabel: "mutate-message",
  CreateDraft: "create-draft",
  GetDraft: "get-draft",
  UpdateDraft: "update-draft",
  ScheduleOutbound: "schedule-outbound",
  GetOutboundDelivery: "get-outbound",
  CancelOutboundDelivery: "cancel-outbound",
  ResendOutbound: "resend-outbound",
} satisfies Record<
  MailDataRpcRequestType["_tag"],
  MailboxDomainError["operation"]
>;

export const mailDataOperation = (
  request: MailDataRpcRequestType
): MailboxDomainError["operation"] => mailDataOperations[request._tag];

export const isMailDataMutation = (request: MailDataRpcRequestType) =>
  !new Set([
    "ListMessages",
    "GetMessage",
    "GetThread",
    "GetDraft",
    "GetOutboundDelivery",
  ]).has(request._tag);

export const executeMailDataRpc = (
  config: MailboxRepositoryDoConfig,
  request: MailDataRpcRequestType
): Effect.Effect<
  MailDataRpcResponseType,
  MailboxDomainError | MailboxRepositoryError
> => {
  const operation = mailDataOperation(request);
  const mutation = isMailDataMutation(request);
  const repositoryOperation = mutation ? "write" : "read";
  const commitState = mutation ? "unknown" : "not-committed";
  return Schema.encodeEffect(MailDataRpcRequest)(request).pipe(
    Effect.mapError((cause) =>
      repositoryError(
        "Invalid mail data request",
        cause,
        repositoryOperation,
        "not-committed"
      )
    ),
    Effect.flatMap((encoded) =>
      config.mailboxExists(request.input.mailboxId).pipe(
        Effect.mapError((cause) =>
          repositoryError(
            "Mailbox registry lookup failed",
            cause,
            repositoryOperation,
            "not-committed"
          )
        ),
        Effect.catchDefect((cause) =>
          Effect.fail(
            repositoryError(
              "Mailbox registry lookup failed",
              cause,
              repositoryOperation,
              "not-committed"
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
              ? config.namespace
                  .getByName(request.input.mailboxId)
                  .executeMailData(encoded)
                  .pipe(
                    Effect.provide(RuntimeContext.phantom),
                    Effect.mapError((cause) =>
                      repositoryError(
                        "Mail data RPC failed",
                        cause,
                        repositoryOperation,
                        commitState
                      )
                    ),
                    Effect.catchDefect((cause) =>
                      Effect.fail(
                        repositoryError(
                          "Mail data RPC failed",
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
                    resourceId: request.input.mailboxId,
                  })
                )
        )
      )
    ),
    Effect.flatMap((response) =>
      Schema.decodeUnknownEffect(MailDataRpcResponse)(response).pipe(
        Effect.mapError((cause) =>
          repositoryError(
            "Mail data RPC returned invalid data",
            cause,
            repositoryOperation,
            commitState
          )
        )
      )
    ),
    Effect.flatMap((response) =>
      response._tag === "DomainError" && response.operation !== operation
        ? Effect.fail(
            repositoryError(
              "Mail data RPC returned the wrong operation",
              response,
              repositoryOperation,
              commitState
            )
          )
        : Effect.succeed(response)
    )
  );
};
