/* oxlint-disable max-classes-per-file -- Ingress and its clock/identity capability form one use case. */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import type { MailboxId } from "#/modules/mailbox/domain/Mailbox";
import { InboundIngestId } from "#/modules/mailbox/domain/Mailbox";
import type { ReceiveInboundEmailInput } from "#/modules/mailbox/domain/MailboxInbound";
import { isInboundRawSizeAllowed } from "#/modules/mailbox/domain/MailboxInbound";
import { InboundEmailRejected } from "#/modules/mailbox/ports/InboundEmailIngress";
import { InboundRawMessageStore } from "#/modules/mailbox/ports/InboundRawMessageStore";
import { InboundWorkflowStarter } from "#/modules/mailbox/ports/InboundWorkflowStarter";
import { BlobStoreError } from "#/modules/mailbox/ports/MailboxBlobStore";
import { MailboxInboundEmailIngressRuntime } from "#/modules/mailbox/ports/MailboxInboundEmailIngressRuntime";
import { UnixMillis } from "#/shared/Temporal";

export interface InboundEmailRoutingMessage {
  readonly envelope: ReceiveInboundEmailInput;
  readonly headers: Headers;
  readonly mailboxId: MailboxId;
  readonly raw: ReadableStream<Uint8Array>;
}

export interface MailboxInboundEmailIngressService {
  readonly receive: (
    message: InboundEmailRoutingMessage
  ) => Effect.Effect<void, InboundEmailRejected>;
}

const rejectStorageFailure = (cause: unknown) =>
  new InboundEmailRejected({
    cause:
      cause instanceof BlobStoreError
        ? cause
        : new BlobStoreError({
            cause,
            message: "Failed to store inbound raw message",
            objectType: "raw-message",
            operation: "write",
            retryable: true,
          }),
    message: "Inbound email processing is not available",
    reason: "processing-unavailable",
  });

const rejectWorkflowFailure = (cause: unknown) =>
  new InboundEmailRejected({
    cause,
    message: "Inbound email processing is not available",
    reason: "processing-unavailable",
  });

export class MailboxInboundEmailIngress extends Context.Service<
  MailboxInboundEmailIngress,
  MailboxInboundEmailIngressService
>()("cloudflare-inbox/InboundEmailIngress", {
  make: Effect.gen(function* () {
    const rawMessages = yield* InboundRawMessageStore;
    const runtime = yield* MailboxInboundEmailIngressRuntime;
    const workflow = yield* InboundWorkflowStarter;

    return {
      receive: (message) =>
        Effect.gen(function* () {
          if (!isInboundRawSizeAllowed(message.envelope.rawSize)) {
            return yield* Effect.fail(
              new InboundEmailRejected({
                message: "Message too large",
                reason: "message-too-large",
              })
            );
          }

          const inboundIngestId = yield* Schema.decodeUnknownEffect(
            InboundIngestId
          )(runtime.randomId()).pipe(Effect.mapError(rejectStorageFailure));
          const receivedAt = yield* Schema.decodeUnknownEffect(UnixMillis)(
            runtime.now()
          ).pipe(Effect.mapError(rejectStorageFailure));

          yield* rawMessages
            .store({
              envelope: message.envelope,
              inboundIngestId,
              mailboxId: message.mailboxId,
              raw: message.raw,
              receivedAt,
            })
            .pipe(Effect.mapError(rejectStorageFailure));

          yield* workflow
            .start({
              envelope: message.envelope,
              formatVersion: 1,
              inboundIngestId,
              mailboxId: message.mailboxId,
              receivedAt,
            })
            .pipe(Effect.mapError(rejectWorkflowFailure));
        }),
    } satisfies MailboxInboundEmailIngressService;
  }),
}) {
  static readonly layerNoDeps = Layer.effect(this, this.make);
}
