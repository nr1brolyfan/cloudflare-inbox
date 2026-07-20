import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import {
  ContentId,
  FileName,
  MailAddress,
  MessageSubject,
  MimeType,
} from "./core";
import type {
  DeliveryIndeterminateError,
  DeliveryRejectedError,
  DeliveryTemporaryFailureError,
} from "./errors";
import { DeliveryIndeterminateError as IndeterminateError } from "./errors";
import { outboundMaxRecipientCount } from "./outbound";

export const OutboundProviderMessageId = Schema.Trimmed.pipe(
  Schema.check(Schema.isLengthBetween(1, 998)),
  Schema.brand("cloudflare-inbox/OutboundProviderMessageId")
);
export type OutboundProviderMessageId = Schema.Schema.Type<
  typeof OutboundProviderMessageId
>;

export const OutboundEmailAttachment = Schema.Struct({
  content: Schema.Uint8Array,
  contentId: Schema.optional(ContentId),
  disposition: Schema.Literals(["attachment", "inline"]),
  fileName: FileName,
  mimeType: MimeType,
}).check(
  Schema.makeFilter((attachment) =>
    (attachment.disposition === "inline") ===
    (attachment.contentId !== undefined)
      ? undefined
      : "contentId must be present exactly for inline attachments"
  )
);
export type OutboundEmailAttachment = Schema.Schema.Type<
  typeof OutboundEmailAttachment
>;

export const OutboundEmailMessage = Schema.Struct({
  attachments: Schema.Array(OutboundEmailAttachment),
  bcc: Schema.Array(MailAddress),
  cc: Schema.Array(MailAddress),
  html: Schema.optional(Schema.String),
  sender: MailAddress,
  subject: MessageSubject,
  text: Schema.optional(Schema.String),
  to: Schema.Array(MailAddress),
}).check(
  Schema.makeFilter((message) => {
    const recipientCount =
      message.to.length + message.cc.length + message.bcc.length;
    if (recipientCount === 0) {
      return "an outbound email requires at least one recipient";
    }
    if (recipientCount > outboundMaxRecipientCount) {
      return `an outbound email cannot contain more than ${outboundMaxRecipientCount} recipients`;
    }
    return message.text !== undefined || message.html !== undefined
      ? undefined
      : "an outbound email requires a text or HTML body";
  })
);
export type OutboundEmailMessage = Schema.Schema.Type<
  typeof OutboundEmailMessage
>;

export const OutboundProviderAcceptance = Schema.Struct({
  providerMessageId: OutboundProviderMessageId,
});
export type OutboundProviderAcceptance = Schema.Schema.Type<
  typeof OutboundProviderAcceptance
>;

export type OutboundEmailProviderError =
  | DeliveryIndeterminateError
  | DeliveryRejectedError
  | DeliveryTemporaryFailureError;

export interface OutboundEmailProvider {
  readonly send: (
    message: OutboundEmailMessage
  ) => Effect.Effect<OutboundProviderAcceptance, OutboundEmailProviderError>;
}

export const OutboundEmailProvider = Context.Service<OutboundEmailProvider>(
  "cloudflare-inbox/OutboundEmailProvider"
);

/** Explicit failure for runtimes where no outbound transport is configured. */
export const OutboundEmailProviderUnavailableLive = Layer.succeed(
  OutboundEmailProvider,
  OutboundEmailProvider.of({
    send: () =>
      Effect.fail(
        new IndeterminateError({
          cause: new Error("Outbound email provider is not configured"),
          message: "Outbound email provider is unavailable",
        })
      ),
  })
);
