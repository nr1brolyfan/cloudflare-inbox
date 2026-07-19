import { and, eq, isNull, sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { MailboxDomainError } from "./errors/mailbox-domain-error";
import type { MailboxId } from "./identifiers";
import { MailboxDatabase } from "./mailbox-database";
import type { MailboxDirectoryRuntime } from "./mailbox-directory-runtime";
import {
  AddressList,
  decodeJson,
  readOutboundDeliveryRow,
  StringList,
} from "./mailbox-mail-row";
import {
  replayMailboxOperation,
  storeMailboxOperation,
} from "./mailbox-operation-sqlite";
import { attachment, draft, message, outboundDelivery } from "./mailbox-schema";
import type {
  CancelOutboundDeliveryInput,
  GetOutboundDeliveryInput,
} from "./outbound-contract";
import {
  ResendOutboundInput,
  ResendOutboundResult,
  ScheduleOutboundInput,
  ScheduleOutboundResult,
} from "./outbound-contract";
import { Version } from "./primitives";

const deliveryNotFound = (
  operation: MailboxDomainError["operation"],
  id: string
) =>
  new MailboxDomainError({
    operation,
    reason: "not-found",
    message: "Outbound delivery was not found",
    resourceType: "outbound",
    resourceId: id,
  });

const versionConflict = (
  operation: MailboxDomainError["operation"],
  id: string,
  expectedVersion: Schema.Schema.Type<typeof Version>,
  actualVersion: unknown
) =>
  new MailboxDomainError({
    operation,
    reason: "version-conflict",
    message: "Outbound delivery version does not match",
    resourceType: "outbound",
    resourceId: id,
    expectedVersion,
    actualVersion: Schema.decodeUnknownSync(Version)(actualVersion),
  });

export const getOutboundDelivery = (
  mailboxId: MailboxId,
  input: GetOutboundDeliveryInput
) =>
  Effect.gen(function* () {
    const db = yield* MailboxDatabase;
    const [row] = yield* db
      .select()
      .from(outboundDelivery)
      .where(
        and(
          eq(outboundDelivery.id, input.outboundDeliveryId),
          isNull(outboundDelivery.deletedAt)
        )
      )
      .limit(1);
    if (row === undefined) {
      return yield* deliveryNotFound("get-outbound", input.outboundDeliveryId);
    }
    return readOutboundDeliveryRow(row, mailboxId);
  });

export const scheduleOutbound = (
  mailboxId: MailboxId,
  input: ScheduleOutboundInput,
  runtime: MailboxDirectoryRuntime
) =>
  Effect.gen(function* () {
    const db = yield* MailboxDatabase;
    return yield* db.transaction((tx) =>
      Effect.gen(function* () {
        const requestKey = JSON.stringify(
          Schema.encodeSync(ScheduleOutboundInput)(input)
        );
        const previous = yield* replayMailboxOperation(
          input.operationId,
          "schedule-outbound",
          "schedule-outbound",
          requestKey,
          ScheduleOutboundResult
        );
        if (previous !== undefined) {
          if (Result.isFailure(previous)) {
            return yield* previous.failure;
          }
          return previous.success;
        }
        const [sourceDraft] = yield* tx
          .select()
          .from(draft)
          .where(and(eq(draft.id, input.draftId), isNull(draft.deletedAt)))
          .limit(1);
        if (sourceDraft === undefined) {
          return yield* new MailboxDomainError({
            operation: "schedule-outbound",
            reason: "not-found",
            message: "Draft was not found",
            resourceType: "draft",
            resourceId: input.draftId,
          });
        }
        if (sourceDraft.version !== input.expectedVersion) {
          return yield* new MailboxDomainError({
            operation: "schedule-outbound",
            reason: "version-conflict",
            message: "Draft version does not match",
            resourceType: "draft",
            resourceId: input.draftId,
            expectedVersion: input.expectedVersion,
            actualVersion: Schema.decodeUnknownSync(Version)(
              sourceDraft.version
            ),
          });
        }
        const now = runtime.now();
        if (input.sendAt < now) {
          return yield* new MailboxDomainError({
            operation: "schedule-outbound",
            reason: "validation",
            message: "sendAt cannot be earlier than server time",
            resourceType: "draft",
            resourceId: input.draftId,
          });
        }
        const recipients = [
          ...decodeJson(AddressList, sourceDraft.toJson),
          ...decodeJson(AddressList, sourceDraft.ccJson),
          ...decodeJson(AddressList, sourceDraft.bccJson),
        ];
        if (recipients.length === 0) {
          return yield* new MailboxDomainError({
            operation: "schedule-outbound",
            reason: "validation",
            message: "At least one recipient is required",
            resourceType: "draft",
            resourceId: input.draftId,
          });
        }
        const attachmentIds = decodeJson(
          StringList,
          sourceDraft.attachmentIdsJson
        );
        const attachments = yield* Effect.all(
          attachmentIds.map((attachmentId) =>
            tx
              .select()
              .from(attachment)
              .where(
                and(
                  eq(attachment.id, attachmentId),
                  isNull(attachment.deletedAt)
                )
              )
              .limit(1)
              .pipe(Effect.map((rows) => rows[0]))
          )
        );
        if (attachments.some((item) => item === undefined)) {
          return yield* new MailboxDomainError({
            operation: "schedule-outbound",
            reason: "validation",
            message: "Draft contains an unavailable attachment",
            resourceType: "draft",
            resourceId: input.draftId,
          });
        }

        const messageId = runtime.randomId();
        const deliveryId = runtime.randomId();
        const threadId = sourceDraft.threadId ?? runtime.randomId();
        const body = sourceDraft.textBody ?? "";
        yield* tx.insert(message).values({
          id: messageId,
          folderId: "scheduled",
          threadId,
          direction: "outbound",
          outboundDeliveryId: deliveryId,
          subject: sourceDraft.subject,
          recipientsJson: JSON.stringify(recipients),
          snippet: body.slice(0, 500),
          activityAt: input.sendAt,
          size: body.length,
          referencesJson: "[]",
          toJson: sourceDraft.toJson,
          ccJson: sourceDraft.ccJson,
          bccJson: sourceDraft.bccJson,
          textBody: sourceDraft.textBody,
          htmlBody: sourceDraft.htmlBody,
          scheduledAt: input.sendAt,
          createdAt: now,
          updatedAt: now,
        });
        for (const source of attachments) {
          if (source !== undefined) {
            yield* tx.insert(attachment).values({
              id: runtime.randomId(),
              messageId,
              fileName: source.fileName,
              mimeType: source.mimeType,
              size: source.size,
              contentId: source.contentId,
              disposition: source.disposition,
            });
          }
        }
        const [deliveryRow] = yield* tx
          .insert(outboundDelivery)
          .values({
            id: deliveryId,
            messageId,
            status: "scheduled",
            sendAt: input.sendAt,
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        if (deliveryRow === undefined) {
          return yield* Effect.die("Outbound delivery insert returned no row");
        }
        const updatedDraft = yield* tx
          .update(draft)
          .set({
            deletedAt: now,
            updatedAt: sql`max(${draft.updatedAt}, ${now})`,
            version: sql`${draft.version} + 1`,
          })
          .where(
            and(
              eq(draft.id, input.draftId),
              eq(draft.version, input.expectedVersion)
            )
          )
          .returning({ id: draft.id });
        if (updatedDraft.length !== 1) {
          return yield* new MailboxDomainError({
            operation: "schedule-outbound",
            reason: "version-conflict",
            message: "Draft version does not match",
            resourceType: "draft",
            resourceId: input.draftId,
            expectedVersion: input.expectedVersion,
            actualVersion: Schema.decodeUnknownSync(Version)(
              sourceDraft.version
            ),
          });
        }
        const result = Schema.decodeUnknownSync(ScheduleOutboundResult)({
          delivery: readOutboundDeliveryRow(deliveryRow, mailboxId),
          serverNow: now,
        });
        yield* storeMailboxOperation(
          input.operationId,
          "schedule-outbound",
          requestKey,
          deliveryId,
          JSON.stringify(Schema.encodeSync(ScheduleOutboundResult)(result)),
          now
        );
        return result;
      })
    );
  });

export const cancelOutboundDelivery = (
  mailboxId: MailboxId,
  input: CancelOutboundDeliveryInput,
  runtime: MailboxDirectoryRuntime
) =>
  Effect.gen(function* () {
    const db = yield* MailboxDatabase;
    return yield* db.transaction((tx) =>
      Effect.gen(function* () {
        const [current] = yield* tx
          .select()
          .from(outboundDelivery)
          .where(
            and(
              eq(outboundDelivery.id, input.outboundDeliveryId),
              isNull(outboundDelivery.deletedAt)
            )
          )
          .limit(1);
        if (current === undefined) {
          return yield* deliveryNotFound(
            "cancel-outbound",
            input.outboundDeliveryId
          );
        }
        if (current.version !== input.expectedVersion) {
          return yield* versionConflict(
            "cancel-outbound",
            input.outboundDeliveryId,
            input.expectedVersion,
            current.version
          );
        }
        if (current.status !== "scheduled") {
          return yield* new MailboxDomainError({
            operation: "cancel-outbound",
            reason: "invalid-state",
            message: "Only scheduled deliveries can be cancelled",
            resourceType: "outbound",
            resourceId: input.outboundDeliveryId,
          });
        }
        const now = Math.max(runtime.now(), current.createdAt);
        const [updated] = yield* tx
          .update(outboundDelivery)
          .set({
            status: "cancelled",
            cancelledAt: now,
            updatedAt: now,
            version: sql`${outboundDelivery.version} + 1`,
          })
          .where(
            and(
              eq(outboundDelivery.id, input.outboundDeliveryId),
              eq(outboundDelivery.version, input.expectedVersion)
            )
          )
          .returning();
        if (updated === undefined) {
          return yield* versionConflict(
            "cancel-outbound",
            input.outboundDeliveryId,
            input.expectedVersion,
            current.version
          );
        }
        return readOutboundDeliveryRow(updated, mailboxId);
      })
    );
  });

export const resendOutbound = (
  mailboxId: MailboxId,
  input: ResendOutboundInput,
  runtime: MailboxDirectoryRuntime
) =>
  Effect.gen(function* () {
    const db = yield* MailboxDatabase;
    return yield* db.transaction((tx) =>
      Effect.gen(function* () {
        const requestKey = JSON.stringify(
          Schema.encodeSync(ResendOutboundInput)(input)
        );
        const previous = yield* replayMailboxOperation(
          input.operationId,
          "resend-outbound",
          "resend-outbound",
          requestKey,
          ResendOutboundResult
        );
        if (previous !== undefined) {
          if (Result.isFailure(previous)) {
            return yield* previous.failure;
          }
          return previous.success;
        }
        const [source] = yield* tx
          .select()
          .from(outboundDelivery)
          .where(
            and(
              eq(outboundDelivery.id, input.outboundDeliveryId),
              isNull(outboundDelivery.deletedAt)
            )
          )
          .limit(1);
        if (source === undefined) {
          return yield* deliveryNotFound(
            "resend-outbound",
            input.outboundDeliveryId
          );
        }
        if (source.version !== input.expectedVersion) {
          return yield* versionConflict(
            "resend-outbound",
            input.outboundDeliveryId,
            input.expectedVersion,
            source.version
          );
        }
        if (
          source.status !== "failed" &&
          source.status !== "indeterminate" &&
          source.status !== "bounced"
        ) {
          return yield* new MailboxDomainError({
            operation: "resend-outbound",
            reason: "invalid-state",
            message: "Delivery state is not eligible for resend",
            resourceType: "outbound",
            resourceId: input.outboundDeliveryId,
          });
        }
        const [sourceMessage] = yield* tx
          .select()
          .from(message)
          .where(
            and(eq(message.id, source.messageId), isNull(message.deletedAt))
          )
          .limit(1);
        if (sourceMessage === undefined) {
          return yield* Effect.die("Outbound source message is missing");
        }

        const now = runtime.now();
        const messageId = runtime.randomId();
        const deliveryId = runtime.randomId();
        yield* tx.insert(message).values({
          id: messageId,
          folderId: "scheduled",
          threadId: sourceMessage.threadId,
          direction: "outbound",
          outboundDeliveryId: deliveryId,
          subject: sourceMessage.subject,
          senderJson: sourceMessage.senderJson,
          recipientsJson: sourceMessage.recipientsJson,
          snippet: sourceMessage.snippet,
          activityAt: now,
          read: sourceMessage.read,
          starred: sourceMessage.starred,
          needsReply: 0,
          size: sourceMessage.size,
          rfcMessageId: sourceMessage.rfcMessageId,
          inReplyTo: sourceMessage.inReplyTo,
          referencesJson: sourceMessage.referencesJson,
          toJson: sourceMessage.toJson,
          ccJson: sourceMessage.ccJson,
          bccJson: sourceMessage.bccJson,
          textBody: sourceMessage.textBody,
          htmlBody: sourceMessage.htmlBody,
          headerDate: sourceMessage.headerDate,
          scheduledAt: now,
          createdAt: now,
          updatedAt: now,
        });
        const sourceAttachments = yield* tx
          .select()
          .from(attachment)
          .where(
            and(
              eq(attachment.messageId, source.messageId),
              isNull(attachment.deletedAt)
            )
          );
        for (const sourceAttachment of sourceAttachments) {
          yield* tx.insert(attachment).values({
            id: runtime.randomId(),
            messageId,
            fileName: sourceAttachment.fileName,
            mimeType: sourceAttachment.mimeType,
            size: sourceAttachment.size,
            contentId: sourceAttachment.contentId,
            disposition: sourceAttachment.disposition,
          });
        }
        const [deliveryRow] = yield* tx
          .insert(outboundDelivery)
          .values({
            id: deliveryId,
            resendOf: input.outboundDeliveryId,
            messageId,
            status: "scheduled",
            sendAt: now,
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        if (deliveryRow === undefined) {
          return yield* Effect.die("Outbound delivery insert returned no row");
        }
        const result = Schema.decodeUnknownSync(ResendOutboundResult)({
          sourceDeliveryId: input.outboundDeliveryId,
          delivery: readOutboundDeliveryRow(deliveryRow, mailboxId),
        });
        yield* storeMailboxOperation(
          input.operationId,
          "resend-outbound",
          requestKey,
          deliveryId,
          JSON.stringify(Schema.encodeSync(ResendOutboundResult)(result)),
          now
        );
        return result;
      })
    );
  });
