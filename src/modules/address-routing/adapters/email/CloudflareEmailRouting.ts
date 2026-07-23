import type * as CloudflareWorkers from "@cloudflare/workers-types";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { EmailAddress } from "#/modules/address-routing/domain/EmailAddress";
import {
  InboundMailboxResolver,
  InboundEmailRejected,
} from "#/modules/address-routing/ports/InboundMailboxResolver";
import { MailboxInboundEmailIngress } from "#/modules/mailbox/application/MailboxInboundEmailIngress";
import { ByteSize } from "#/modules/mailbox/domain/Mailbox";
import type { ReceiveInboundEmailInput as ReceiveInboundEmailInputType } from "#/modules/mailbox/domain/MailboxInbound";
import { ReceiveInboundEmailInput } from "#/modules/mailbox/domain/MailboxInbound";

type ForwardableEmailMessage = CloudflareWorkers.ForwardableEmailMessage;
const emptyEnvelope: Partial<ReceiveInboundEmailInputType> = {};

export const MailboxInboundEmailIngressUnavailableLayer = Layer.succeed(
  MailboxInboundEmailIngress,
  MailboxInboundEmailIngress.of({
    receive: () =>
      Effect.fail(
        new InboundEmailRejected({
          message: "Inbound email processing is not available",
          reason: "processing-unavailable",
        })
      ),
  })
);

const reject = (message: ForwardableEmailMessage, reason: string) =>
  Effect.sync(() => message.setReject(reason));

const rejectInboundEmail =
  (message: ForwardableEmailMessage) => (error: InboundEmailRejected) =>
    reject(message, error.message);

const decodeEnvelopeAddress = (
  value: string,
  failureMessage: string
): Effect.Effect<
  ReceiveInboundEmailInputType["envelopeTo"],
  InboundEmailRejected
> =>
  Schema.decodeUnknownEffect(EmailAddress)(value).pipe(
    Effect.mapError(
      (cause) =>
        new InboundEmailRejected({
          cause,
          message: failureMessage,
          reason: "invalid-envelope",
        })
    )
  );

const decodeEnvelopeSender = (
  value: string
): Effect.Effect<
  ReceiveInboundEmailInputType["envelopeFrom"],
  InboundEmailRejected
> =>
  value.trim().length === 0
    ? Effect.succeed(emptyEnvelope.envelopeFrom)
    : decodeEnvelopeAddress(value, "Invalid envelope sender");

const decodeRawSize = (
  value: number
): Effect.Effect<
  ReceiveInboundEmailInputType["rawSize"],
  InboundEmailRejected
> =>
  Schema.decodeUnknownEffect(ByteSize)(value).pipe(
    Effect.mapError(
      (cause) =>
        new InboundEmailRejected({
          cause,
          message: "Invalid raw message size",
          reason: "invalid-envelope",
        })
    )
  );

const decodeEnvelope = (message: ForwardableEmailMessage) =>
  Effect.gen(function* () {
    const envelope = {
      envelopeFrom: yield* decodeEnvelopeSender(message.from),
      envelopeTo: yield* decodeEnvelopeAddress(
        message.to,
        "Invalid envelope recipient"
      ),
      rawSize: yield* decodeRawSize(message.rawSize),
    };

    return yield* Schema.decodeUnknownEffect(ReceiveInboundEmailInput)(
      envelope
    ).pipe(
      Effect.mapError(
        (cause) =>
          new InboundEmailRejected({
            cause,
            message: "Invalid inbound email envelope",
            reason: "invalid-envelope",
          })
      )
    );
  });

export const handleCloudflareEmailRoutingMessage = (
  message: ForwardableEmailMessage
) =>
  Effect.gen(function* () {
    const envelope = yield* decodeEnvelope(message);
    const resolver = yield* InboundMailboxResolver;
    const mailboxId = yield* resolver.resolve(envelope.envelopeTo);
    const ingress = yield* MailboxInboundEmailIngress;

    yield* ingress.receive({
      envelope,
      headers: message.headers as unknown as Headers,
      mailboxId,
      raw: message.raw as unknown as ReadableStream<Uint8Array>,
    });
  }).pipe(Effect.catchTag("InboundEmailRejected", rejectInboundEmail(message)));
