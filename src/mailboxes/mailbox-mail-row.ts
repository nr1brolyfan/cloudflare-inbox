import { and, asc, eq, isNull } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { AttachmentMetadata } from "./attachment-metadata";
import { DraftSchema } from "./draft";
import type { MailboxId } from "./identifiers";
import { MailAddress } from "./mail-address";
import type { MailboxDatabase } from "./mailbox-database";
import {
  attachment,
  label,
  messageLabel,
  outboundDelivery,
} from "./mailbox-schema";
import type { draft, message } from "./mailbox-schema";
import { MessageDetailSchema } from "./message-detail";
import { MessageSummarySchema } from "./message-summary";
import { OutboundDeliverySchema } from "./outbound-delivery";
import { OutboundDeliveryFailure } from "./outbound-delivery-failure";
import { OutboundFailureCode } from "./outbound-failure-code";

const AddressList = Schema.Array(MailAddress);
const StringList = Schema.Array(Schema.String);

export const encodeJson = <A, I>(schema: Schema.Codec<A, I>, value: A) =>
  JSON.stringify(Schema.encodeSync(schema)(value));

const decodeJson = <A>(schema: Schema.Decoder<A>, value: string) =>
  Schema.decodeUnknownSync(schema)(JSON.parse(value));

const optionalAddress = (value: string | null) =>
  value === null ? undefined : decodeJson(MailAddress, value);

export const readOutboundDeliveryRow = (
  row: typeof outboundDelivery.$inferSelect,
  mailboxId: MailboxId
) =>
  Schema.decodeUnknownSync(OutboundDeliverySchema)({
    id: row.id,
    resendOf: row.resendOf ?? undefined,
    mailboxId,
    messageId: row.messageId,
    status: row.status,
    sendAt: row.sendAt,
    acceptedAt: row.acceptedAt ?? undefined,
    deliveredAt: row.deliveredAt ?? undefined,
    bouncedAt: row.bouncedAt ?? undefined,
    cancelledAt: row.cancelledAt ?? undefined,
    failure:
      row.failureCode === null
        ? undefined
        : Schema.decodeUnknownSync(OutboundDeliveryFailure)({
            code: Schema.decodeUnknownSync(OutboundFailureCode)(
              row.failureCode
            ),
            failedAt: row.failureAt,
          }),
    attemptCount: row.attemptCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    version: row.version,
  });

export const readDraftRow = (
  row: typeof draft.$inferSelect,
  mailboxId: MailboxId
) =>
  Schema.decodeUnknownSync(DraftSchema)({
    id: row.id,
    mailboxId,
    threadId: row.threadId ?? undefined,
    inReplyToMessageId: row.inReplyToMessageId ?? undefined,
    to: decodeJson(AddressList, row.toJson),
    cc: decodeJson(AddressList, row.ccJson),
    bcc: decodeJson(AddressList, row.bccJson),
    subject: row.subject,
    textBody: row.textBody ?? undefined,
    htmlBody: row.htmlBody ?? undefined,
    attachmentIds: decodeJson(StringList, row.attachmentIdsJson),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    version: row.version,
  });

export const readMessageDetailRow = (
  db: Omit<MailboxDatabase, "$client">,
  row: typeof message.$inferSelect,
  mailboxId: MailboxId
) =>
  Effect.gen(function* () {
    const [labelRows, attachmentRows, deliveryRows] = yield* Effect.all([
      db
        .select({ labelId: messageLabel.labelId })
        .from(messageLabel)
        .innerJoin(label, eq(label.id, messageLabel.labelId))
        .where(and(eq(messageLabel.messageId, row.id), isNull(label.deletedAt)))
        .orderBy(asc(messageLabel.labelId)),
      db
        .select()
        .from(attachment)
        .where(
          and(eq(attachment.messageId, row.id), isNull(attachment.deletedAt))
        )
        .orderBy(asc(attachment.id)),
      row.outboundDeliveryId === null
        ? Effect.succeed([])
        : db
            .select()
            .from(outboundDelivery)
            .where(
              and(
                eq(outboundDelivery.id, row.outboundDeliveryId),
                isNull(outboundDelivery.deletedAt)
              )
            )
            .limit(1),
    ]);
    const attachments = attachmentRows.map((item) =>
      Schema.decodeUnknownSync(AttachmentMetadata)({
        id: item.id,
        messageId: item.messageId,
        fileName: item.fileName,
        mimeType: item.mimeType,
        size: item.size,
        contentId: item.contentId ?? undefined,
        disposition: item.disposition,
      })
    );

    return Schema.decodeUnknownSync(MessageDetailSchema)({
      id: row.id,
      mailboxId,
      folderId: row.folderId,
      threadId: row.threadId,
      direction: row.direction,
      outboundDeliveryId: row.outboundDeliveryId ?? undefined,
      deliveryStatus: deliveryRows[0]?.status,
      subject: row.subject,
      sender: optionalAddress(row.senderJson),
      recipients: decodeJson(AddressList, row.recipientsJson),
      snippet: row.snippet,
      activityAt: row.activityAt,
      read: row.read === 1,
      starred: row.starred === 1,
      hasAttachments: attachments.length > 0,
      labelIds: labelRows.map((item) => item.labelId),
      size: row.size,
      version: row.version,
      rfcMessageId: row.rfcMessageId ?? undefined,
      inReplyTo: row.inReplyTo ?? undefined,
      references: decodeJson(StringList, row.referencesJson),
      to: decodeJson(AddressList, row.toJson),
      cc: decodeJson(AddressList, row.ccJson),
      bcc: decodeJson(AddressList, row.bccJson),
      textBody: row.textBody ?? undefined,
      htmlBody: row.htmlBody ?? undefined,
      headerDate: row.headerDate ?? undefined,
      receivedAt: row.receivedAt ?? undefined,
      scheduledAt: row.scheduledAt ?? undefined,
      acceptedAt: row.acceptedAt ?? undefined,
      attachments,
    });
  });

export const readMessageSummaryRow = (
  detail: Schema.Schema.Type<typeof MessageDetailSchema>
) => Schema.decodeUnknownSync(MessageSummarySchema)(detail);
