/* oxlint-disable max-classes-per-file -- Send binding and transport clients form one Cloudflare adapter. */
import type * as CloudflareWorkers from "@cloudflare/workers-types";
import { RuntimeContext } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import {
  DeliveryIndeterminateError,
  DeliveryRejectedError,
  DeliveryTemporaryFailureError,
  OutboundEmailProvider,
  OutboundProviderAcceptance,
} from "#/modules/mailbox/ports/OutboundEmailProvider";
import type {
  DeliveryProviderUnavailableError,
  OutboundEmailAttachment,
  OutboundEmailMessage,
} from "#/modules/mailbox/ports/OutboundEmailProvider";
import type { MailAddress } from "#/shared/MailAddress";

export interface MailboxEmailSendClientService {
  readonly send: (
    message: CloudflareWorkers.EmailMessageBuilder
  ) => Effect.Effect<
    CloudflareWorkers.EmailSendResult,
    Cloudflare.Email.SendEmailError | DeliveryProviderUnavailableError
  >;
}

export class MailboxEmailSendClient extends Context.Service<
  MailboxEmailSendClient,
  MailboxEmailSendClientService
>()("cloudflare-inbox/MailboxEmailSendClient") {}

export class MailboxEmailSendBindingClient extends Context.Service<
  MailboxEmailSendBindingClient,
  Cloudflare.Email.SendClient
>()("cloudflare-inbox/MailboxEmailSendBindingClient") {}

/** Adapts an explicitly acquired production send_email binding. */
export const MailboxEmailSendClientCloudflareLayer = Layer.effect(
  MailboxEmailSendClient,
  Effect.gen(function* () {
    const client = yield* MailboxEmailSendBindingClient;

    return MailboxEmailSendClient.of({
      send: (message) =>
        client.raw.pipe(
          Effect.provide(RuntimeContext.phantom),
          Effect.flatMap((binding) =>
            Effect.tryPromise({
              try: () => binding.send(message),
              catch: (cause) =>
                new Cloudflare.Email.SendEmailError({
                  cause,
                  message:
                    cause instanceof Error
                      ? cause.message
                      : "Unknown send_email error",
                }),
            })
          )
        ),
    });
  })
);

const mailAddress = (
  value: MailAddress
): string | CloudflareWorkers.EmailAddress =>
  value.displayName === undefined
    ? value.address
    : { email: value.address, name: value.displayName };

const mailAddresses = (values: readonly MailAddress[]) =>
  values.map(mailAddress);

const attachment = (
  value: OutboundEmailAttachment
): CloudflareWorkers.EmailAttachment =>
  value.disposition === "inline" && value.contentId !== undefined
    ? {
        content: value.content,
        contentId: value.contentId,
        disposition: "inline",
        filename: value.fileName,
        type: value.mimeType,
      }
    : {
        content: value.content,
        disposition: "attachment",
        filename: value.fileName,
        type: value.mimeType,
      };

const emailMessageBuilder = (
  message: OutboundEmailMessage
): CloudflareWorkers.EmailMessageBuilder => {
  const cc = message.cc.length === 0 ? {} : { cc: mailAddresses(message.cc) };
  const bcc =
    message.bcc.length === 0 ? {} : { bcc: mailAddresses(message.bcc) };
  const recipients =
    message.to.length > 0
      ? { ...bcc, ...cc, to: mailAddresses(message.to) }
      : message.cc.length > 0
        ? { ...bcc, cc: mailAddresses(message.cc) }
        : { bcc: mailAddresses(message.bcc) };

  return {
    ...recipients,
    ...(message.attachments.length === 0
      ? {}
      : { attachments: message.attachments.map(attachment) }),
    ...(message.html === undefined ? {} : { html: message.html }),
    ...(message.text === undefined ? {} : { text: message.text }),
    from: mailAddress(message.sender),
    subject: message.subject,
  };
};

const invalidMessageCodes = new Set([
  "E_VALIDATION_ERROR",
  "E_FIELD_MISSING",
  "E_TOO_MANY_RECIPIENTS",
  "E_TOO_MANY_ATTACHMENTS",
  "E_HEADER_NOT_ALLOWED",
  "E_HEADER_USE_API_FIELD",
  "E_HEADER_VALUE_INVALID",
  "E_HEADER_VALUE_TOO_LONG",
  "E_HEADER_NAME_INVALID",
  "E_HEADERS_TOO_LARGE",
  "E_HEADERS_TOO_MANY",
]);
const invalidSenderCodes = new Set([
  "E_SENDER_NOT_VERIFIED",
  "E_SENDER_DOMAIN_NOT_AVAILABLE",
]);
const providerRejectedCodes = new Set([
  "E_RECIPIENT_NOT_ALLOWED",
  "E_DELIVERY_FAILED",
]);
const temporaryFailureCodes = new Set([
  "E_RATE_LIMIT_EXCEEDED",
  "E_DAILY_LIMIT_EXCEEDED",
]);

const errorCode = (
  error: Cloudflare.Email.SendEmailError
): string | undefined => {
  const { cause } = error;
  if (typeof cause !== "object" || cause === null || !("code" in cause)) {
    return undefined;
  }
  return typeof cause.code === "string" ? cause.code : undefined;
};

const deliveryError = (error: Cloudflare.Email.SendEmailError) => {
  const code = errorCode(error);
  if (code !== undefined && invalidMessageCodes.has(code)) {
    return new DeliveryRejectedError({
      cause: error,
      message: "Email provider rejected an invalid message",
      reason: "invalid-message",
    });
  }
  if (code === "E_CONTENT_TOO_LARGE") {
    return new DeliveryRejectedError({
      cause: error,
      message: "Email provider rejected a message that is too large",
      reason: "message-too-large",
    });
  }
  if (code !== undefined && invalidSenderCodes.has(code)) {
    return new DeliveryRejectedError({
      cause: error,
      message: "Email provider rejected the sender",
      reason: "invalid-sender",
    });
  }
  if (code === "E_RECIPIENT_SUPPRESSED") {
    return new DeliveryRejectedError({
      cause: error,
      message: "Email provider suppressed a recipient",
      reason: "recipient-suppressed",
    });
  }
  if (code !== undefined && providerRejectedCodes.has(code)) {
    return new DeliveryRejectedError({
      cause: error,
      message: "Email provider rejected delivery",
      reason: "provider-rejected",
    });
  }
  if (code !== undefined && temporaryFailureCodes.has(code)) {
    return new DeliveryTemporaryFailureError({
      cause: error,
      message: "Email provider sending limit was reached",
    });
  }
  return new DeliveryIndeterminateError({
    cause: error,
    message: "Email provider outcome is indeterminate",
  });
};

const providerError = (
  error: Cloudflare.Email.SendEmailError | DeliveryProviderUnavailableError
) =>
  error._tag === "DeliveryProviderUnavailableError"
    ? error
    : deliveryError(error);

const malformedAcceptance = (cause: unknown) =>
  new DeliveryIndeterminateError({
    cause,
    message: "Email provider returned a malformed acceptance",
  });

export const OutboundEmailProviderCloudflareLayer = Layer.effect(
  OutboundEmailProvider,
  Effect.gen(function* () {
    const client = yield* MailboxEmailSendClient;

    return OutboundEmailProvider.of({
      send: (message) =>
        client.send(emailMessageBuilder(message)).pipe(
          Effect.mapError(providerError),
          Effect.flatMap((result) =>
            Schema.decodeUnknownEffect(OutboundProviderAcceptance)({
              providerMessageId: result.messageId,
            }).pipe(Effect.mapError(malformedAcceptance))
          )
        ),
    });
  })
);
