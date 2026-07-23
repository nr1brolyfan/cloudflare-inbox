import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  ContentId,
  FileName,
  MailAddress,
  MessageSubject,
  MimeType,
} from "#/mailboxes/core";
import type {
  DeliveryIndeterminateError,
  DeliveryProviderUnavailableError,
  DeliveryRejectedError,
  DeliveryTemporaryFailureError,
} from "#/mailboxes/errors";
import {
  OutboundProviderMessageId,
  outboundMaxRecipientCount,
} from "#/mailboxes/outbound";

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
  | DeliveryProviderUnavailableError
  | DeliveryRejectedError
  | DeliveryTemporaryFailureError;

export interface OutboundEmailProviderService {
  readonly send: (
    message: OutboundEmailMessage
  ) => Effect.Effect<OutboundProviderAcceptance, OutboundEmailProviderError>;
}

export class OutboundEmailProvider extends Context.Service<
  OutboundEmailProvider,
  OutboundEmailProviderService
>()("cloudflare-inbox/OutboundEmailProvider") {}
