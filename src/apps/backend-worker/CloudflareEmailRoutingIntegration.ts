import type * as CloudflareWorkers from "@cloudflare/workers-types";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { InboundMailboxResolver } from "#/modules/address-routing/ports/InboundMailboxResolver";
import { MailboxInboundEmailIngress } from "#/modules/mailbox/application/MailboxInboundEmailIngress";
import { MailboxArchiveConfig } from "#/modules/mailbox/contracts/MailboxArchiveConfig";
import { ByteSize } from "#/modules/mailbox/domain/Mailbox";
import type { ReceiveInboundEmailInput as ReceiveInboundEmailInputType } from "#/modules/mailbox/domain/MailboxInbound";
import {
  isInboundRawSizeAllowed,
  MAXIMUM_INBOUND_RAW_BYTES,
  ReceiveInboundEmailInput,
} from "#/modules/mailbox/domain/MailboxInbound";
import { InboundEmailRejected } from "#/modules/mailbox/ports/InboundEmailIngress";
import { EmailAddress } from "#/shared/EmailAddress";

type ForwardableEmailMessage = CloudflareWorkers.ForwardableEmailMessage;
const emptyEnvelope: Partial<ReceiveInboundEmailInputType> = {};

class InboundArchiveTransportError extends Data.TaggedError(
  "InboundArchiveTransportError"
)<Record<never, never>> {}

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
    Effect.annotateCurrentSpan({
      "email.rejection_reason": error.reason,
      ...(error.reason === "message-too-large"
        ? { "email.maximum_raw_bytes": MAXIMUM_INBOUND_RAW_BYTES }
        : {}),
    }).pipe(Effect.andThen(reject(message, error.message)));

const rejectUnavailableArchive = (message: ForwardableEmailMessage) =>
  Effect.annotateCurrentSpan({
    "email.rejection_reason": "archive-unavailable",
  }).pipe(
    Effect.andThen(reject(message, "Inbound email archive is not available"))
  );

const cannotBeForwarded = (message: ForwardableEmailMessage): boolean => {
  try {
    const candidate = message as unknown as {
      readonly canBeForwarded?: unknown;
    };
    if (!("canBeForwarded" in candidate)) {
      return false;
    }
    const value = candidate.canBeForwarded;
    return typeof value !== "boolean" || !value;
  } catch {
    return true;
  }
};

const forwardToArchive = (
  message: ForwardableEmailMessage,
  recipient: string
): Effect.Effect<void, InboundArchiveTransportError> =>
  Effect.tryPromise({
    try: () => message.forward(recipient),
    catch: () => new InboundArchiveTransportError(),
  }).pipe(Effect.asVoid);

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
  Effect.gen(function* () {
    const rawSize = yield* Schema.decodeUnknownEffect(ByteSize)(value).pipe(
      Effect.mapError(
        (cause) =>
          new InboundEmailRejected({
            cause,
            message: "Invalid raw message size",
            reason: "invalid-envelope",
          })
      )
    );

    if (!isInboundRawSizeAllowed(rawSize)) {
      return yield* Effect.fail(
        new InboundEmailRejected({
          message: "Message too large",
          reason: "message-too-large",
        })
      );
    }

    return rawSize;
  });

const decodeEnvelope = (message: ForwardableEmailMessage) =>
  Effect.gen(function* () {
    const rawSize = yield* decodeRawSize(message.rawSize);
    const envelope = {
      envelopeFrom: yield* decodeEnvelopeSender(message.from),
      envelopeTo: yield* decodeEnvelopeAddress(
        message.to,
        "Invalid envelope recipient"
      ),
      rawSize,
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
    if (cannotBeForwarded(message)) {
      return yield* new InboundArchiveTransportError();
    }
    const envelope = yield* decodeEnvelope(message);
    const resolver = yield* InboundMailboxResolver;
    const mailboxId = yield* resolver.resolve(envelope.envelopeTo);
    const ingress = yield* MailboxInboundEmailIngress;

    // Admission trusts validated Cloudflare transport metadata without reading
    // raw; FixedLengthStream verifies declared versus actual bytes during R2 put.
    yield* ingress.receive({
      envelope,
      headers: message.headers as unknown as Headers,
      mailboxId,
      raw: message.raw as unknown as ReadableStream<Uint8Array>,
    });
    const archiveConfig = yield* MailboxArchiveConfig;
    yield* forwardToArchive(message, archiveConfig.recipient);
  }).pipe(
    Effect.catchTags({
      InboundArchiveTransportError: () => rejectUnavailableArchive(message),
      InboundEmailRejected: rejectInboundEmail(message),
    })
  );
