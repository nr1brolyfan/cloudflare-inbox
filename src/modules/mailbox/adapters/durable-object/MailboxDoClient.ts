/* oxlint-disable max-classes-per-file -- Namespace binding and transport service form one adapter. */
import { RuntimeContext } from "alchemy";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import type { MailboxId } from "#/modules/mailbox/domain/Mailbox";
import { MailboxDomainError } from "#/modules/mailbox/domain/MailboxError";
import {
  MailboxResourceLookup,
  MailboxResourceLookupResult,
} from "#/modules/mailbox/domain/MailboxResource";
import type {
  MailboxResourceLookup as MailboxResourceLookupType,
  MailboxResourceLookupResult as MailboxResourceLookupResultType,
} from "#/modules/mailbox/domain/MailboxResource";
import { MailboxRepositoryError } from "#/modules/mailbox/ports/MailboxRepositoryError";
import { MailboxRegistry } from "#/modules/organization/ports/MailboxRegistry";

import {
  DirectoryRpcRequest,
  DirectoryRpcResponse,
  directoryRequestMetadata,
  directoryResponseMatchesRequest,
  MailDataRpcRequest,
  MailDataRpcResponse,
  mailDataRequestMetadata,
  mailDataResponseMatchesRequest,
} from "./MailboxDoProtocol";
import type {
  DirectoryRpcRequest as DirectoryRpcRequestType,
  DirectoryRpcResponse as DirectoryRpcResponseType,
  MailDataRpcRequest as MailDataRpcRequestType,
  MailDataRpcResponse as MailDataRpcResponseType,
} from "./MailboxDoProtocol";

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

export interface MailboxDoNamespaceService {
  readonly getByName: (name: string) => MailboxDoStub;
}

/** Typed Cloudflare namespace used by concrete Durable Object adapters. */
export class MailboxDoNamespace extends Context.Service<
  MailboxDoNamespace,
  MailboxDoNamespaceService
>()("cloudflare-inbox/MailboxDoNamespace") {}

type ClientError = MailboxDomainError | MailboxRepositoryError;

export interface MailboxDoClientService {
  readonly executeDirectory: (
    request: DirectoryRpcRequestType
  ) => Effect.Effect<DirectoryRpcResponseType, ClientError>;
  readonly executeMailData: (
    request: MailDataRpcRequestType
  ) => Effect.Effect<MailDataRpcResponseType, ClientError>;
  readonly resolveMailResource: (
    request: MailboxResourceLookupType
  ) => Effect.Effect<MailboxResourceLookupResultType, MailboxRepositoryError>;
}

/** Registry-gated, schema-validating transport to mailbox Durable Objects. */
export class MailboxDoClient extends Context.Service<
  MailboxDoClient,
  MailboxDoClientService
>()("cloudflare-inbox/MailboxDoClient") {}

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

export const MailboxDoClientLayer = Layer.effect(
  MailboxDoClient,
  Effect.gen(function* () {
    const registry = yield* MailboxRegistry;
    const namespace = yield* MailboxDoNamespace;
    const notFound: MailboxResourceLookupResultType = { _tag: "NotFound" };

    const mailboxExists = (mailboxId: MailboxId, operation: "read" | "write") =>
      registry.exists(mailboxId).pipe(
        Effect.mapError((cause) =>
          repositoryError("Mailbox registry lookup failed", cause, operation)
        ),
        Effect.catchDefect((cause) =>
          Effect.fail(
            repositoryError("Mailbox registry lookup failed", cause, operation)
          )
        )
      );

    const invokeRpc = (
      mailboxId: MailboxId,
      operation: MailboxDomainError["operation"],
      repositoryOperation: "read" | "write",
      commitState: "not-committed" | "unknown",
      message: string,
      invoke: (
        stub: MailboxDoStub
      ) => Effect.Effect<unknown, unknown, RuntimeContext>
    ): Effect.Effect<unknown, ClientError> =>
      mailboxExists(mailboxId, repositoryOperation).pipe(
        Effect.flatMap(
          (exists): Effect.Effect<unknown, ClientError> =>
            exists
              ? Effect.suspend(() =>
                  invoke(namespace.getByName(mailboxId))
                ).pipe(
                  // Alchemy's generated adapter requires this marker at the concrete call site.
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
    ): Effect.Effect<DirectoryRpcResponseType, ClientError> => {
      const metadata = directoryRequestMetadata(request);
      const commitState =
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
            commitState,
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
                commitState
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
                commitState
              )
            );
          }
          return directoryResponseMatchesRequest(request, response)
            ? Effect.succeed(response)
            : Effect.fail(
                repositoryError(
                  "Mailbox directory RPC returned the wrong response type",
                  response,
                  metadata.kind,
                  commitState
                )
              );
        })
      );
    };

    const executeMailData = (
      request: MailDataRpcRequestType
    ): Effect.Effect<MailDataRpcResponseType, ClientError> => {
      const metadata = mailDataRequestMetadata(request);
      const commitState =
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
            commitState,
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
                commitState
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
                commitState
              )
            );
          }
          return mailDataResponseMatchesRequest(request, response)
            ? Effect.succeed(response)
            : Effect.fail(
                repositoryError(
                  "Mail data RPC returned the wrong response type",
                  response,
                  metadata.kind,
                  commitState
                )
              );
        })
      );
    };

    const resolveMailResource = (
      request: MailboxResourceLookupType
    ): Effect.Effect<MailboxResourceLookupResultType, MailboxRepositoryError> =>
      Schema.encodeEffect(MailboxResourceLookup)(request).pipe(
        Effect.mapError((cause) =>
          repositoryError("Invalid mailbox lookup", cause)
        ),
        Effect.flatMap((encoded) =>
          mailboxExists(request.mailboxId, "read").pipe(
            Effect.flatMap((exists) =>
              exists
                ? Effect.suspend(() =>
                    namespace
                      .getByName(request.mailboxId)
                      .resolveMailResource(encoded)
                  ).pipe(
                    Effect.provide(RuntimeContext.phantom),
                    Effect.mapError((cause) =>
                      repositoryError("Mailbox resource lookup failed", cause)
                    ),
                    Effect.catchDefect((cause) =>
                      Effect.fail(
                        repositoryError("Mailbox resource lookup failed", cause)
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

    return MailboxDoClient.of({
      executeDirectory,
      executeMailData,
      resolveMailResource,
    });
  })
);
