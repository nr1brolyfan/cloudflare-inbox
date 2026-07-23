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
import { InboundProcessingRecorder } from "./inbound";
import type { InboundProcessingResult } from "./inbound";

const checkpointRank = {
  raw_stored: 1,
  parsing: 2,
  attachments_stored: 3,
} as const;

const stateMatchesRecord = (
  input: Parameters<InboundProcessingRecorder["record"]>[0],
  result: InboundProcessingResult
) => {
  if (input._tag === "Failure") {
    return result.status === "failed" || result.status === "ready";
  }
  if (result.status === "failed" || result.status === "ready") {
    return true;
  }
  if (result.status === "received") {
    return false;
  }
  return checkpointRank[result.status] >= checkpointRank[input.status];
};

const repositoryError = (message: string, cause: unknown, transient: boolean) =>
  new MailboxRepositoryError({
    cause,
    commitState: transient ? "unknown" : "not-committed",
    message,
    operation: "write",
    transient,
  });

/** Durable Object adapter for monotonic inbound checkpoints and failures. */
export const InboundProcessingRecorderDoLive = Layer.effect(
  InboundProcessingRecorder,
  Effect.gen(function* () {
    const namespace = yield* MailboxDoNamespace;

    return InboundProcessingRecorder.of({
      record: (input) => {
        const request = { _tag: "RecordInboundProcessing" as const, input };
        return Schema.encodeEffect(MailDataRpcRequest)(request).pipe(
          Effect.mapError((cause) =>
            repositoryError("Invalid inbound processing record", cause, false)
          ),
          Effect.flatMap((encoded) =>
            Effect.try({
              try: () =>
                namespace.getByName(input.mailboxId).executeMailData(encoded),
              catch: (cause) =>
                repositoryError("Inbound processing RPC failed", cause, true),
            }).pipe(
              Effect.flatMap((rpc) =>
                rpc.pipe(
                  Effect.provide(RuntimeContext.phantom),
                  Effect.mapError((cause) =>
                    repositoryError(
                      "Inbound processing RPC failed",
                      cause,
                      true
                    )
                  ),
                  Effect.catchDefect((cause) =>
                    Effect.fail(
                      repositoryError(
                        "Inbound processing RPC failed",
                        cause,
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
                  "Inbound processing RPC returned invalid data",
                  cause,
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
                  response._tag !== "InboundProcessingRecorded")
              ) {
                return Effect.fail(
                  repositoryError(
                    "Inbound processing RPC returned the wrong response type",
                    response,
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
                !stateMatchesRecord(input, response.value)
              ) {
                return Effect.fail(
                  repositoryError(
                    "Inbound processing RPC returned an unrelated result",
                    response,
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
