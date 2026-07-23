import { RuntimeContext } from "alchemy";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { MailboxDomainError } from "#/modules/mailbox/domain/MailboxError";
import { MailboxRepositoryError } from "#/modules/mailbox/ports/MailboxRepositoryError";

import { MailboxDoNamespace, MailboxRegistry } from "./do-client";
import {
  decodeMailboxDomainError,
  MailDataRpcRequest,
  MailDataRpcResponse,
  mailDataResponseMatchesRequest,
} from "./do-protocol";
import {
  InboundReplay,
  InboundReplayPreparer,
  InboundWorkflowStarter,
} from "./inbound";
import type { PreparedInboundReplayV1 } from "./inbound";

const repositoryError = (message: string, cause: unknown) =>
  new MailboxRepositoryError({
    cause,
    commitState: "unknown",
    message,
    operation: "write",
    transient: true,
  });

export const InboundReplayPreparerDoLive = Layer.effect(
  InboundReplayPreparer,
  Effect.gen(function* () {
    const namespace = yield* MailboxDoNamespace;
    const registry = yield* MailboxRegistry;
    return InboundReplayPreparer.of({
      claim: (input) => {
        const request = { _tag: "PrepareInboundReplay" as const, input };
        const invoke = Schema.encodeEffect(MailDataRpcRequest)(request).pipe(
          Effect.mapError((cause) =>
            repositoryError("Invalid replay request", cause)
          ),
          Effect.flatMap((encoded) =>
            Effect.try({
              try: () =>
                namespace.getByName(input.mailboxId).executeMailData(encoded),
              catch: (cause) => repositoryError("Replay RPC failed", cause),
            }).pipe(
              Effect.flatMap((rpc) =>
                rpc.pipe(
                  Effect.provide(RuntimeContext.phantom),
                  Effect.mapError((cause) =>
                    repositoryError("Replay RPC failed", cause)
                  ),
                  Effect.catchDefect((cause) =>
                    Effect.fail(repositoryError("Replay RPC failed", cause))
                  )
                )
              )
            )
          ),
          Effect.flatMap((response) =>
            Schema.decodeUnknownEffect(MailDataRpcResponse)(response).pipe(
              Effect.mapError((cause) =>
                repositoryError("Replay RPC returned invalid data", cause)
              )
            )
          ),
          Effect.flatMap(
            (
              response
            ): Effect.Effect<
              PreparedInboundReplayV1,
              MailboxDomainError | MailboxRepositoryError
            > => {
              if (!mailDataResponseMatchesRequest(request, response)) {
                return Effect.fail(
                  repositoryError(
                    "Replay RPC returned the wrong response",
                    response
                  )
                );
              }
              if (response._tag === "DomainError") {
                return Effect.fail(decodeMailboxDomainError(response));
              }
              if (
                response._tag !== "InboundReplayPrepared" ||
                response.value.processing.id !== input.inboundIngestId ||
                response.value.processing.mailboxId !== input.mailboxId
              ) {
                return Effect.fail(
                  repositoryError(
                    "Replay RPC returned unrelated data",
                    response
                  )
                );
              }
              return Effect.succeed(response.value);
            }
          )
        );
        return registry.exists(input.mailboxId).pipe(
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
              ? invoke
              : Effect.fail(
                  new MailboxDomainError({
                    message: "Mailbox was not found",
                    operation: "replay-inbound",
                    reason: "not-found",
                    resourceId: input.mailboxId,
                    resourceType: "mailbox",
                  })
                )
          )
        );
      },
    });
  })
);

export const InboundReplayLive = Layer.effect(
  InboundReplay,
  Effect.gen(function* () {
    const preparer = yield* InboundReplayPreparer;
    const starter = yield* InboundWorkflowStarter;
    return InboundReplay.of({
      replay: (input) =>
        preparer.claim(input).pipe(
          Effect.tap((prepared) => starter.start(prepared.workflow)),
          Effect.map((prepared) => prepared.processing)
        ),
    });
  })
);
