import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import PostalMime from "postal-mime";
import type {
  Address as PostalAddress,
  Attachment as PostalAttachment,
  Mailbox as PostalMailbox,
} from "postal-mime";

import {
  ContentId,
  FileName,
  MailAddress,
  MimeType,
  RfcMessageId,
  UnixMillis,
} from "./core";
import { MimeParseError } from "./errors";
import { InboundMimeParser, ParsedInboundMessageV1 } from "./inbound";
import type { ParsedInboundMessageV1 as ParsedInboundMessageV1Type } from "./inbound";

export interface InboundMimeParserConfig {
  readonly maximumAddresses: number;
  readonly maximumAttachments: number;
  readonly maximumHeadersBytes: number;
  readonly maximumNestingDepth: number;
  readonly maximumRawBytes: number;
  readonly maximumReferences: number;
  readonly maximumWorkflowResultBytes: number;
}

export const InboundMimeParserConfig = Context.Service<InboundMimeParserConfig>(
  "cloudflare-inbox/InboundMimeParserConfig"
);

export const InboundMimeParserConfigLive = Layer.succeed(
  InboundMimeParserConfig,
  InboundMimeParserConfig.of({
    maximumAddresses: 256,
    maximumAttachments: 256,
    maximumHeadersBytes: 256 * 1024,
    maximumNestingDepth: 64,
    maximumRawBytes: 10 * 1024 * 1024,
    maximumReferences: 100,
    maximumWorkflowResultBytes: 768 * 1024,
  })
);

const parseError = (
  reason: MimeParseError["reason"],
  message: string,
  cause?: unknown
) => new MimeParseError({ cause, message, reason });

const decodeOptional = <A>(schema: Schema.Decoder<A>, input: unknown) => {
  const result = Schema.decodeUnknownExit(schema)(input);
  return Exit.isSuccess(result) ? result.value : undefined;
};

const flattenAddresses = (
  addresses: readonly PostalAddress[] | undefined
): readonly PostalMailbox[] =>
  (addresses ?? []).flatMap((address) =>
    address.group === undefined ? [address] : address.group
  );

const decodeAddress = (mailbox: PostalMailbox) =>
  decodeOptional(MailAddress, {
    address: mailbox.address,
    ...(mailbox.name.trim().length === 0 ? {} : { displayName: mailbox.name }),
  });

const decodeAddresses = (addresses: readonly PostalAddress[] | undefined) =>
  flattenAddresses(addresses).flatMap((mailbox) => {
    const decoded = decodeAddress(mailbox);
    return decoded === undefined ? [] : [decoded];
  });

const messageIds = (value: string | undefined) =>
  (value?.match(/<[^>]+>|[^\s,]+/gu) ?? []).flatMap((candidate) => {
    const decoded = decodeOptional(RfcMessageId, candidate);
    return decoded === undefined ? [] : [decoded];
  });

const attachmentSize = (content: PostalAttachment["content"]): number =>
  typeof content === "string"
    ? new TextEncoder().encode(content).byteLength
    : content.byteLength;

const attachmentContentId = (contentId: string | undefined) => {
  if (contentId === undefined) {
    return;
  }
  const normalized = contentId.replaceAll(/^<|>$/gu, "");
  return decodeOptional(ContentId, normalized);
};

const attachmentManifest = (attachment: PostalAttachment, index: number) => ({
  index,
  fileName:
    attachment.filename === null
      ? undefined
      : decodeOptional(FileName, attachment.filename),
  mimeType:
    decodeOptional(MimeType, attachment.mimeType) ??
    Schema.decodeUnknownSync(MimeType)("application/octet-stream"),
  size: attachmentSize(attachment.content),
  contentId: attachmentContentId(attachment.contentId),
  disposition:
    attachment.disposition === "inline" || attachment.related === true
      ? "inline"
      : "attachment",
});

const headerDate = (value: string | undefined) => {
  if (value === undefined) {
    return;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp >= 0
    ? decodeOptional(UnixMillis, timestamp)
    : undefined;
};

const manifestSize = (manifest: ParsedInboundMessageV1Type) =>
  new TextEncoder().encode(
    JSON.stringify(Schema.encodeSync(ParsedInboundMessageV1)(manifest))
  ).byteLength;

/** PostalMime adapter that emits a bounded durable manifest without content bytes. */
export const InboundMimeParserPostalMimeLive = Layer.effect(
  InboundMimeParser,
  Effect.gen(function* () {
    const config = yield* InboundMimeParserConfig;

    return InboundMimeParser.of({
      parse: (raw) =>
        Effect.gen(function* () {
          if (raw.byteLength > config.maximumRawBytes) {
            return yield* Effect.fail(
              parseError(
                "message-too-large",
                "Inbound message exceeds the MIME parser limit"
              )
            );
          }

          const parsed = yield* Effect.tryPromise({
            try: () =>
              new PostalMime({
                attachmentEncoding: "arraybuffer",
                forceRfc822Attachments: true,
                maxHeadersSize: config.maximumHeadersBytes,
                maxNestingDepth: config.maximumNestingDepth,
              }).parse(raw),
            catch: (cause) =>
              parseError(
                "malformed-message",
                "Inbound MIME could not be parsed",
                cause
              ),
          });
          const to = decodeAddresses(parsed.to);
          const cc = decodeAddresses(parsed.cc);
          const bcc = decodeAddresses(parsed.bcc);
          const [senderMailbox] = flattenAddresses(
            parsed.from === undefined ? undefined : [parsed.from]
          );
          const references = messageIds(parsed.references);
          const [rfcMessageId] = messageIds(parsed.messageId);
          const [inReplyTo] = messageIds(parsed.inReplyTo);
          const addressCount =
            flattenAddresses(parsed.to).length +
            flattenAddresses(parsed.cc).length +
            flattenAddresses(parsed.bcc).length;

          if (
            addressCount > config.maximumAddresses ||
            parsed.attachments.length > config.maximumAttachments ||
            references.length > config.maximumReferences
          ) {
            return yield* Effect.fail(
              parseError(
                "unsupported-message",
                "Inbound MIME exceeds supported structural limits"
              )
            );
          }

          const manifest = yield* Schema.decodeUnknownEffect(
            ParsedInboundMessageV1
          )({
            formatVersion: 1,
            subject: parsed.subject ?? "",
            sender:
              senderMailbox === undefined
                ? undefined
                : decodeAddress(senderMailbox),
            to,
            cc,
            bcc,
            rfcMessageId,
            inReplyTo,
            references,
            textBody: parsed.text,
            htmlBody: parsed.html,
            headerDate: headerDate(parsed.date),
            attachments: parsed.attachments.map(attachmentManifest),
          }).pipe(
            Effect.mapError((cause) =>
              parseError(
                "malformed-message",
                "Parsed MIME data is invalid",
                cause
              )
            )
          );

          if (manifestSize(manifest) > config.maximumWorkflowResultBytes) {
            return yield* Effect.fail(
              parseError(
                "message-too-large",
                "Parsed MIME exceeds the durable result limit"
              )
            );
          }
          return manifest;
        }),
    });
  })
);
