import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { DraftId, MailboxId, Version } from "#/modules/mailbox/domain/Mailbox";
import { MailboxDomainError } from "#/modules/mailbox/domain/MailboxError";
import {
  CancelOutboundDeliveryInput,
  OutboundDeliveryFailure,
  OutboundDeliveryResult,
  OutboundDeliverySchema,
  OutboundFailureCode,
  ResendOutboundInput,
  ResendOutboundResult,
  ScheduleOutboundResult,
  outboundMaxRecipientCount,
  outboundUndoWindowMillis,
} from "#/modules/mailbox/domain/MailboxOutbound";
import type {
  GetOutboundDeliveryInput,
  ScheduleOutboundInput,
} from "#/modules/mailbox/domain/MailboxOutbound";
import { MailboxIdentity } from "#/modules/mailbox/ports/MailboxIdentity";
import { MailAddress } from "#/shared/MailAddress";
import { OperationId } from "#/shared/Operation";

import { MailboxOperationStore } from "./MailboxOperationStoreSqlite";
import { MailboxDatabase } from "./MailboxSqliteDatabase";
import {
  AddressList,
  decodeJson,
  encodeJson,
  StringList,
} from "./MailboxSqliteJson";
import { MailboxRuntime } from "./MailboxSqliteRuntime";
import {
  attachment,
  draft,
  draftAttachment,
  message,
  outboundDelivery,
} from "./MailboxSqliteSchema";

const readOutboundDeliveryRow = (
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
    providerMessageId: row.providerMessageId ?? undefined,
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

const getOutboundDelivery = (
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

const ScheduleOutboundRequestIdentity = Schema.Struct({
  mailboxId: MailboxId,
  draftId: DraftId,
  expectedVersion: Version,
  operationId: OperationId,
});

const scheduleOutbound = (
  mailboxId: MailboxId,
  input: ScheduleOutboundInput,
  runtime: MailboxRuntime,
  operations: MailboxOperationStore
) =>
  Effect.gen(function* () {
    const db = yield* MailboxDatabase;
    return yield* db.transaction((tx) =>
      Effect.gen(function* () {
        if (input.confirmation !== "explicit-user-action") {
          return yield* new MailboxDomainError({
            operation: "schedule-outbound",
            reason: "validation",
            message: "Explicit user confirmation is required",
            resourceType: "draft",
            resourceId: input.draftId,
          });
        }
        const requestKey = JSON.stringify(
          Schema.encodeSync(ScheduleOutboundRequestIdentity)({
            mailboxId: input.mailboxId,
            draftId: input.draftId,
            expectedVersion: input.expectedVersion,
            operationId: input.operationId,
          })
        );
        const previous = yield* operations.replay(
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
        const now = runtime.now();
        const sendAt = now + outboundUndoWindowMillis;
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
        if (recipients.length > outboundMaxRecipientCount) {
          return yield* new MailboxDomainError({
            operation: "schedule-outbound",
            reason: "validation",
            message: `At most ${outboundMaxRecipientCount} recipients are allowed`,
            resourceType: "draft",
            resourceId: input.draftId,
          });
        }
        const attachmentIds = decodeJson(
          StringList,
          sourceDraft.attachmentIdsJson
        );
        const uniqueAttachmentIds = new Set(attachmentIds);
        const storedAttachments =
          attachmentIds.length === 0
            ? []
            : yield* tx
                .select()
                .from(draftAttachment)
                .where(
                  and(
                    eq(draftAttachment.draftId, input.draftId),
                    eq(draftAttachment.status, "stored"),
                    inArray(draftAttachment.id, attachmentIds)
                  )
                );
        const attachmentById = new Map(
          storedAttachments.map((item) => [item.id, item] as const)
        );
        const attachments = attachmentIds.map((id) => attachmentById.get(id));
        if (
          uniqueAttachmentIds.size !== attachmentIds.length ||
          attachments.some(
            (item) => item === undefined || item.contentSha256 === null
          )
        ) {
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
        const htmlBody = sourceDraft.htmlBody ?? "";
        const snapshotSize =
          new TextEncoder().encode(body).byteLength +
          new TextEncoder().encode(htmlBody).byteLength +
          storedAttachments.reduce((total, item) => total + item.size, 0);
        yield* tx.insert(message).values({
          id: messageId,
          folderId: "scheduled",
          threadId,
          direction: "outbound",
          outboundDeliveryId: deliveryId,
          subject: sourceDraft.subject,
          senderJson: encodeJson(MailAddress, input.sender),
          recipientsJson: JSON.stringify(recipients),
          snippet: body.slice(0, 500),
          activityAt: sendAt,
          size: snapshotSize,
          referencesJson: "[]",
          toJson: sourceDraft.toJson,
          ccJson: sourceDraft.ccJson,
          bccJson: sourceDraft.bccJson,
          textBody: sourceDraft.textBody,
          htmlBody: sourceDraft.htmlBody,
          scheduledAt: sendAt,
          createdAt: now,
          updatedAt: now,
        });
        for (const source of attachments) {
          if (source === undefined || source.contentSha256 === null) {
            return yield* Effect.die(
              new Error("Validated draft attachment snapshot is missing")
            );
          }
          yield* tx.insert(attachment).values({
            contentSha256: source.contentSha256,
            disposition: "attachment",
            draftAttachmentId: source.id,
            fileName: source.fileName,
            id: runtime.randomId(),
            messageId,
            mimeType: source.mimeType,
            size: source.size,
          });
        }
        const [deliveryRow] = yield* tx
          .insert(outboundDelivery)
          .values({
            id: deliveryId,
            messageId,
            status: "scheduled",
            sendAt,
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
        yield* operations.store(
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

const cancelOutboundDelivery = (
  mailboxId: MailboxId,
  input: CancelOutboundDeliveryInput,
  runtime: MailboxRuntime,
  operations: MailboxOperationStore
) =>
  Effect.gen(function* () {
    const db = yield* MailboxDatabase;
    return yield* db.transaction((tx) =>
      Effect.gen(function* () {
        const requestKey = JSON.stringify(
          Schema.encodeSync(CancelOutboundDeliveryInput)(input)
        );
        const previous = yield* operations.replay(
          input.operationId,
          "cancel-outbound",
          "cancel-outbound",
          requestKey,
          OutboundDeliveryResult
        );
        if (previous !== undefined) {
          if (Result.isFailure(previous)) {
            return yield* previous.failure;
          }
          return previous.success;
        }
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
        const runtimeNow = runtime.now();
        if (runtimeNow >= current.sendAt) {
          return yield* new MailboxDomainError({
            operation: "cancel-outbound",
            reason: "invalid-state",
            message:
              "Only scheduled deliveries before send time can be cancelled",
            resourceType: "outbound",
            resourceId: input.outboundDeliveryId,
          });
        }
        const now = Math.max(runtimeNow, current.createdAt);
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
        const result = readOutboundDeliveryRow(updated, mailboxId);
        yield* operations.store(
          input.operationId,
          "cancel-outbound",
          requestKey,
          input.outboundDeliveryId,
          JSON.stringify(Schema.encodeSync(OutboundDeliveryResult)(result)),
          result.updatedAt
        );
        return result;
      })
    );
  });

const resendOutbound = (
  mailboxId: MailboxId,
  input: ResendOutboundInput,
  runtime: MailboxRuntime,
  operations: MailboxOperationStore
) =>
  Effect.gen(function* () {
    const db = yield* MailboxDatabase;
    return yield* db.transaction((tx) =>
      Effect.gen(function* () {
        if (input.confirmation !== "explicit-user-action") {
          return yield* new MailboxDomainError({
            operation: "resend-outbound",
            reason: "validation",
            message: "Explicit user confirmation is required",
            resourceType: "outbound",
            resourceId: input.outboundDeliveryId,
          });
        }
        const requestKey = JSON.stringify(
          Schema.encodeSync(ResendOutboundInput)(input)
        );
        const previous = yield* operations.replay(
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
        const sourceAttachments = yield* tx
          .select()
          .from(attachment)
          .where(
            and(
              eq(attachment.messageId, source.messageId),
              isNull(attachment.deletedAt)
            )
          );
        const attachmentsAvailable = sourceAttachments.every(
          (sourceAttachment) => {
            const inboundSource =
              sourceAttachment.inboundIngestId !== null &&
              sourceAttachment.sourceIndex !== null &&
              sourceAttachment.draftAttachmentId === null &&
              sourceAttachment.contentSha256 === null;
            const draftSource =
              sourceAttachment.inboundIngestId === null &&
              sourceAttachment.sourceIndex === null &&
              sourceAttachment.draftAttachmentId !== null &&
              sourceAttachment.contentSha256 !== null;
            return inboundSource || draftSource;
          }
        );
        if (!attachmentsAvailable) {
          return yield* new MailboxDomainError({
            operation: "resend-outbound",
            reason: "invalid-state",
            message: "Outbound snapshot contains an unavailable attachment",
            resourceType: "outbound",
            resourceId: input.outboundDeliveryId,
          });
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
        for (const sourceAttachment of sourceAttachments) {
          yield* tx.insert(attachment).values({
            id: runtime.randomId(),
            messageId,
            fileName: sourceAttachment.fileName,
            mimeType: sourceAttachment.mimeType,
            size: sourceAttachment.size,
            contentId: sourceAttachment.contentId,
            contentSha256: sourceAttachment.contentSha256,
            disposition: sourceAttachment.disposition,
            draftAttachmentId: sourceAttachment.draftAttachmentId,
            inboundIngestId: sourceAttachment.inboundIngestId,
            sourceIndex: sourceAttachment.sourceIndex,
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
        yield* operations.store(
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

const makeMailboxOutboundStore = (
  db: MailboxDatabase,
  runtime: MailboxRuntime,
  mailboxId: MailboxId,
  operations: MailboxOperationStore
) => {
  const provideDatabase = <A, E>(
    effect: Effect.Effect<A, E, MailboxDatabase>
  ) => effect.pipe(Effect.provideService(MailboxDatabase, db));

  return {
    getOutboundDelivery: (input: GetOutboundDeliveryInput) =>
      provideDatabase(getOutboundDelivery(mailboxId, input)),
    scheduleOutbound: (input: ScheduleOutboundInput) =>
      provideDatabase(scheduleOutbound(mailboxId, input, runtime, operations)),
    cancelOutboundDelivery: (input: CancelOutboundDeliveryInput) =>
      provideDatabase(
        cancelOutboundDelivery(mailboxId, input, runtime, operations)
      ),
    resendOutbound: (input: ResendOutboundInput) =>
      provideDatabase(resendOutbound(mailboxId, input, runtime, operations)),
  };
};

export type MailboxOutboundStore = ReturnType<typeof makeMailboxOutboundStore>;

export const MailboxOutboundStore = Context.Service<MailboxOutboundStore>(
  "cloudflare-inbox/MailboxOutboundStore"
);

export const MailboxOutboundStoreSqliteLayer = Layer.effect(
  MailboxOutboundStore,
  Effect.gen(function* () {
    const db = yield* MailboxDatabase;
    const runtime = yield* MailboxRuntime;
    const { mailboxId } = yield* MailboxIdentity;
    const operations = yield* MailboxOperationStore;
    return MailboxOutboundStore.of(
      makeMailboxOutboundStore(db, runtime, mailboxId, operations)
    );
  })
);
