import { and, asc, eq, isNull } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { MailboxDatabase } from "#/modules/mailbox/adapters/sqlite/MailboxSqliteDatabase";
import {
  attachment,
  message,
  outboundDelivery,
} from "#/modules/mailbox/adapters/sqlite/MailboxSqliteSchema";
import { MailboxArchiveRecipient } from "#/modules/mailbox/contracts/MailboxArchiveConfig";
import type { OutboundDeliveryId } from "#/modules/mailbox/domain/Mailbox";
import { RfcMessageId } from "#/modules/mailbox/domain/Mailbox";
import { MailboxIdentity } from "#/modules/mailbox/ports/MailboxIdentity";
import {
  MailboxOutboundDispatchStore,
  OutboundDispatchSnapshotError,
  OutboundDispatchSnapshotSchema,
} from "#/modules/mailbox/ports/MailboxOutboundDispatchStore";
import { MailAddress } from "#/shared/MailAddress";

const AddressList = Schema.Array(MailAddress);
const RfcMessageIdList = Schema.Array(RfcMessageId);

const snapshotError = (
  outboundDeliveryId: OutboundDeliveryId,
  reason: OutboundDispatchSnapshotError["reason"],
  cause?: unknown
) =>
  new OutboundDispatchSnapshotError({
    cause,
    message:
      reason === "not-found"
        ? "Outbound dispatch snapshot was not found"
        : reason === "invalid-snapshot"
          ? "Outbound dispatch snapshot is inconsistent"
          : "Failed to load outbound dispatch snapshot",
    outboundDeliveryId,
    reason,
  });

const decodeJson = <A>(schema: Schema.Decoder<A>, value: string): A =>
  Schema.decodeUnknownSync(schema)(JSON.parse(value));

const decodeArchiveRecipient = (value: string | null) => {
  if (value === null) {
    return;
  }
  return Schema.decodeUnknownSync(MailboxArchiveRecipient)(value);
};

export const MailboxOutboundDispatchStoreSqliteLayer = Layer.effect(
  MailboxOutboundDispatchStore,
  Effect.gen(function* () {
    const db = yield* MailboxDatabase;
    const { mailboxId } = yield* MailboxIdentity;

    return MailboxOutboundDispatchStore.of({
      load: (outboundDeliveryId) =>
        db
          .select({
            attachmentContentId: attachment.contentId,
            attachmentContentSha256: attachment.contentSha256,
            attachmentDisposition: attachment.disposition,
            attachmentDraftAttachmentId: attachment.draftAttachmentId,
            attachmentFileName: attachment.fileName,
            attachmentId: attachment.id,
            attachmentMimeType: attachment.mimeType,
            attachmentSize: attachment.size,
            deliveryId: outboundDelivery.id,
            deliveryArchiveRecipient: outboundDelivery.archiveRecipient,
            deliveryMessageId: outboundDelivery.messageId,
            messageBccJson: message.bccJson,
            messageCcJson: message.ccJson,
            messageDirection: message.direction,
            messageHtmlBody: message.htmlBody,
            messageId: message.id,
            messageInReplyTo: message.inReplyTo,
            messageOutboundDeliveryId: message.outboundDeliveryId,
            messageSenderJson: message.senderJson,
            messageSubject: message.subject,
            messageReferencesJson: message.referencesJson,
            messageTextBody: message.textBody,
            messageToJson: message.toJson,
          })
          .from(outboundDelivery)
          .innerJoin(message, eq(message.id, outboundDelivery.messageId))
          .leftJoin(
            attachment,
            and(
              eq(attachment.messageId, message.id),
              isNull(attachment.deletedAt)
            )
          )
          .where(
            and(
              eq(outboundDelivery.id, outboundDeliveryId),
              isNull(outboundDelivery.deletedAt),
              isNull(message.deletedAt)
            )
          )
          .orderBy(asc(attachment.id))
          .pipe(
            Effect.mapError((cause) =>
              snapshotError(outboundDeliveryId, "storage", cause)
            ),
            Effect.flatMap((rows) => {
              const [first] = rows;
              if (first === undefined) {
                return Effect.fail(
                  snapshotError(outboundDeliveryId, "not-found")
                );
              }

              return Effect.try({
                try: () => {
                  if (
                    first.deliveryMessageId !== first.messageId ||
                    first.messageDirection !== "outbound" ||
                    first.messageOutboundDeliveryId !== first.deliveryId ||
                    first.messageSenderJson === null
                  ) {
                    throw new Error(
                      "Outbound delivery and message identity do not match"
                    );
                  }
                  const references = decodeJson(
                    RfcMessageIdList,
                    first.messageReferencesJson
                  );
                  if (
                    first.messageInReplyTo === null &&
                    references.length > 0
                  ) {
                    throw new Error(
                      "Outbound References cannot exist without In-Reply-To"
                    );
                  }

                  return Schema.decodeUnknownSync(
                    OutboundDispatchSnapshotSchema
                  )({
                    attachments: rows.flatMap((row) => {
                      if (row.attachmentId === null) {
                        return [];
                      }
                      return [
                        {
                          attachmentId: row.attachmentId,
                          contentId: row.attachmentContentId ?? undefined,
                          disposition: row.attachmentDisposition,
                          fileName: row.attachmentFileName,
                          location: {
                            contentSha256: row.attachmentContentSha256,
                            draftAttachmentId: row.attachmentDraftAttachmentId,
                            mailboxId,
                            mimeType: row.attachmentMimeType,
                            size: row.attachmentSize,
                          },
                        },
                      ];
                    }),
                    archiveRecipient: decodeArchiveRecipient(
                      first.deliveryArchiveRecipient
                    ),
                    bcc: decodeJson(AddressList, first.messageBccJson),
                    cc: decodeJson(AddressList, first.messageCcJson),
                    html: first.messageHtmlBody ?? undefined,
                    mailboxId,
                    messageId: first.messageId,
                    outboundDeliveryId: first.deliveryId,
                    sender: decodeJson(MailAddress, first.messageSenderJson),
                    subject: first.messageSubject,
                    text: first.messageTextBody ?? undefined,
                    ...(first.messageInReplyTo === null
                      ? {}
                      : {
                          threading: {
                            inReplyTo: first.messageInReplyTo,
                            references,
                          },
                        }),
                    to: decodeJson(AddressList, first.messageToJson),
                  });
                },
                catch: () =>
                  snapshotError(outboundDeliveryId, "invalid-snapshot"),
              });
            }),
            Effect.catchDefect((cause) =>
              Effect.fail(snapshotError(outboundDeliveryId, "storage", cause))
            )
          ),
    });
  })
);
