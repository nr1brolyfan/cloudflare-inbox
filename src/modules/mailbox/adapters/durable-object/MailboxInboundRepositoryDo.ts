import { RuntimeContext } from "alchemy";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import {
  MailboxDoClient,
  MailboxDoNamespace,
} from "#/modules/mailbox/adapters/durable-object/MailboxDoClient";
import type { MailboxDomainError } from "#/modules/mailbox/domain/MailboxError";
import type { InboundProcessingResult } from "#/modules/mailbox/domain/MailboxInbound";
import {
  decodeMailboxDomainError,
  MailDataRpcRequest,
  MailDataRpcResponse,
  mailDataResponseMatchesRequest,
} from "#/modules/mailbox/ports/MailboxDoProtocol";
import {
  InboundMessageCommitter,
  InboundProcessingRecorder,
  InboundReplayPreparer,
} from "#/modules/mailbox/ports/MailboxInboundRepository";
import type { InboundProcessingRecorderService } from "#/modules/mailbox/ports/MailboxInboundRepository";
import { MailboxRepositoryError } from "#/modules/mailbox/ports/MailboxRepositoryError";

const commitRepositoryError = (
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
export const InboundMessageCommitterDoLayer = Layer.effect(
  InboundMessageCommitter,
  Effect.gen(function* () {
    const namespace = yield* MailboxDoNamespace;

    return InboundMessageCommitter.of({
      commit: (input) => {
        const request = { _tag: "CommitInbound" as const, input };
        return Schema.encodeEffect(MailDataRpcRequest)(request).pipe(
          Effect.mapError((cause) =>
            commitRepositoryError(
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
                commitRepositoryError(
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
                    commitRepositoryError(
                      "Inbound commit RPC failed",
                      cause,
                      "unknown",
                      true
                    )
                  ),
                  Effect.catchDefect((cause) =>
                    Effect.fail(
                      commitRepositoryError(
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
                commitRepositoryError(
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
                  commitRepositoryError(
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
                  commitRepositoryError(
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

const checkpointRank = {
  raw_stored: 1,
  parsing: 2,
  attachments_stored: 3,
} as const;

const stateMatchesRecord = (
  input: Parameters<InboundProcessingRecorderService["record"]>[0],
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

const recordRepositoryError = (
  message: string,
  cause: unknown,
  transient: boolean
) =>
  new MailboxRepositoryError({
    cause,
    commitState: transient ? "unknown" : "not-committed",
    message,
    operation: "write",
    transient,
  });

/** Durable Object adapter for monotonic inbound checkpoints and failures. */
export const InboundProcessingRecorderDoLayer = Layer.effect(
  InboundProcessingRecorder,
  Effect.gen(function* () {
    const namespace = yield* MailboxDoNamespace;

    return InboundProcessingRecorder.of({
      record: (input) => {
        const request = { _tag: "RecordInboundProcessing" as const, input };
        return Schema.encodeEffect(MailDataRpcRequest)(request).pipe(
          Effect.mapError((cause) =>
            recordRepositoryError(
              "Invalid inbound processing record",
              cause,
              false
            )
          ),
          Effect.flatMap((encoded) =>
            Effect.try({
              try: () =>
                namespace.getByName(input.mailboxId).executeMailData(encoded),
              catch: (cause) =>
                recordRepositoryError(
                  "Inbound processing RPC failed",
                  cause,
                  true
                ),
            }).pipe(
              Effect.flatMap((rpc) =>
                rpc.pipe(
                  Effect.provide(RuntimeContext.phantom),
                  Effect.mapError((cause) =>
                    recordRepositoryError(
                      "Inbound processing RPC failed",
                      cause,
                      true
                    )
                  ),
                  Effect.catchDefect((cause) =>
                    Effect.fail(
                      recordRepositoryError(
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
                recordRepositoryError(
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
                  recordRepositoryError(
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
                  recordRepositoryError(
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

/** Registry-gated Durable Object adapter that atomically claims replay attempts. */
export const InboundReplayPreparerDoLayer = Layer.effect(
  InboundReplayPreparer,
  Effect.gen(function* () {
    const client = yield* MailboxDoClient;
    return InboundReplayPreparer.of({
      claim: (input) => {
        const request = { _tag: "PrepareInboundReplay" as const, input };
        return client.executeMailData(request).pipe(
          Effect.flatMap((response) => {
            if (response._tag === "DomainError") {
              return Effect.fail(decodeMailboxDomainError(response));
            }
            if (
              response._tag !== "InboundReplayPrepared" ||
              response.value.processing.id !== input.inboundIngestId ||
              response.value.processing.mailboxId !== input.mailboxId
            ) {
              return Effect.die(
                new Error("Replay RPC returned unrelated data")
              );
            }
            return Effect.succeed(response.value);
          })
        );
      },
    });
  })
);
