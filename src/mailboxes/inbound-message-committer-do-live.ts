import { RuntimeContext } from "alchemy";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import type { MailboxDomainError } from "#/modules/mailbox/domain/MailboxError";
import { MailboxRepositoryError } from "#/modules/mailbox/ports/MailboxRepositoryError";

import { MailboxDoNamespace } from "./do-client";
import {
  decodeMailboxDomainError,
  MailDataRpcRequest,
  MailDataRpcResponse,
  mailDataResponseMatchesRequest,
} from "./do-protocol";
import { InboundMessageCommitter } from "./inbound";
import type { InboundProcessingResult } from "./inbound";

const repositoryError = (
  message: string,
  cause: unknown,
  commitState: "not-committed" | "unknown",
  transient: boolean
) =>
  new MailboxRepositoryError({
    cause,
    commitState,
    message,
    operation: "write",
    transient,
  });

/** Durable Object adapter for the Workflow's trusted final inbound commit. */
export const InboundMessageCommitterDoLive = Layer.effect(
  InboundMessageCommitter,
  Effect.gen(function* () {
    const namespace = yield* MailboxDoNamespace;

    return InboundMessageCommitter.of({
      commit: (input) => {
        const request = { _tag: "CommitInbound" as const, input };
        return Schema.encodeEffect(MailDataRpcRequest)(request).pipe(
          Effect.mapError((cause) =>
            repositoryError(
              "Invalid inbound commit request",
              cause,
              "not-committed",
              false
            )
          ),
          Effect.flatMap((encoded) =>
            Effect.try({
              try: () =>
                namespace.getByName(input.mailboxId).executeMailData(encoded),
              catch: (cause) =>
                repositoryError(
                  "Inbound commit RPC failed",
                  cause,
                  "unknown",
                  true
                ),
            }).pipe(
              Effect.flatMap((rpc) =>
                rpc.pipe(
                  Effect.provide(RuntimeContext.phantom),
                  Effect.mapError((cause) =>
                    repositoryError(
                      "Inbound commit RPC failed",
                      cause,
                      "unknown",
                      true
                    )
                  ),
                  Effect.catchDefect((cause) =>
                    Effect.fail(
                      repositoryError(
                        "Inbound commit RPC failed",
                        cause,
                        "unknown",
                        true
                      )
                    )
                  )
                )
              )
            )
          ),
          Effect.flatMap((response) =>
            Schema.decodeUnknownEffect(MailDataRpcResponse)(response).pipe(
              Effect.mapError((cause) =>
                repositoryError(
                  "Inbound commit RPC returned invalid data",
                  cause,
                  "unknown",
                  false
                )
              )
            )
          ),
          Effect.flatMap(
            (
              response
            ): Effect.Effect<
              InboundProcessingResult,
              MailboxDomainError | MailboxRepositoryError
            > => {
              if (
                !mailDataResponseMatchesRequest(request, response) ||
                (response._tag !== "DomainError" &&
                  response._tag !== "InboundCommitted")
              ) {
                return Effect.fail(
                  repositoryError(
                    "Inbound commit RPC returned the wrong response type",
                    response,
                    "unknown",
                    false
                  )
                );
              }
              if (response._tag === "DomainError") {
                return Effect.fail(decodeMailboxDomainError(response));
              }
              if (
                response.value.id !== input.inboundIngestId ||
                response.value.mailboxId !== input.mailboxId ||
                response.value.status !== "ready" ||
                response.value.messageId === undefined
              ) {
                return Effect.fail(
                  repositoryError(
                    "Inbound commit RPC returned an unrelated result",
                    response,
                    "unknown",
                    false
                  )
                );
              }
              return Effect.succeed(response.value);
            }
          )
        );
      },
    });
  })
);
