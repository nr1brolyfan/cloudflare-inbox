import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { AsyncRuleJobId } from "#/modules/mailbox/domain/Mailbox";
import type { MailboxId, RfcMessageId } from "#/modules/mailbox/domain/Mailbox";
import {
  AsyncRuleJob,
  AsyncRulePlanV1,
} from "#/modules/mailbox/domain/MailboxAsyncRuleJob";
import { MailboxDomainError } from "#/modules/mailbox/domain/MailboxError";
import {
  CommitInboundMessageV1,
  InboundProcessingSchema,
  InboundWorkflowParamsV1,
  PreparedInboundReplayV1,
} from "#/modules/mailbox/domain/MailboxInbound";
import type {
  CommitInboundMessage as CommitInboundMessageType,
  RecordInboundProcessing,
  ReplayInboundInput,
} from "#/modules/mailbox/domain/MailboxInbound";
import {
  RuleAction,
  RuleActions,
  RuleApplication,
  RuleConditions,
  RuleEvaluationRecord,
  RuleSchema,
} from "#/modules/mailbox/domain/MailboxRule";
import type { RuleApplicationOutcome } from "#/modules/mailbox/domain/MailboxRule";
import {
  EvaluateRulesInput,
  evaluateAsyncRuleCandidates,
  evaluateRules,
} from "#/modules/mailbox/domain/MailboxRuleEvaluation";
import type { RuleEvaluationResult } from "#/modules/mailbox/domain/MailboxRuleEvaluation";
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
  asyncRuleJob,
  attachment,
  filterRule,
  folder,
  inboundProcessing,
  label,
  message,
  messageLabel,
  ruleApplication,
  ruleEvaluation,
} from "./MailboxSqliteSchema";

const messageDomainError = (
  operation: MailboxDomainError["operation"],
  reason: MailboxDomainError["reason"],
  messageText: string,
  details: Pick<
    MailboxDomainError,
    "resourceType" | "resourceId" | "expectedVersion" | "actualVersion"
  > = {}
) =>
  new MailboxDomainError({
    operation,
    reason,
    message: messageText,
    ...details,
  });

const readInboundProcessingRow = (
  row: typeof inboundProcessing.$inferSelect,
  mailboxId: MailboxId
) =>
  Schema.decodeUnknownSync(InboundProcessingSchema)({
    id: row.id,
    mailboxId,
    status: row.status,
    messageId: row.messageId ?? undefined,
    asyncRuleJobId: row.asyncRuleJobId ?? undefined,
    failure:
      row.failureCode === null
        ? undefined
        : {
            code: row.failureCode,
            failedAt: row.failureAt,
            replayable: row.failureReplayable === 1,
          },
    attemptCount: row.attemptCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    version: row.version,
  });

const inboundSnippet = (textBody: string | undefined) =>
  (textBody ?? "").replaceAll(/\s+/gu, " ").trim().slice(0, 500);

const inboundIdentityKey = (input: {
  readonly envelope: CommitInboundMessageType["envelope"];
  readonly inboundIngestId: CommitInboundMessageType["inboundIngestId"];
  readonly mailboxId: MailboxId;
  readonly receivedAt: CommitInboundMessageType["receivedAt"];
}) =>
  JSON.stringify(
    Schema.encodeSync(InboundWorkflowParamsV1)({
      envelope: input.envelope,
      formatVersion: 1,
      inboundIngestId: input.inboundIngestId,
      mailboxId: input.mailboxId,
      receivedAt: input.receivedAt,
    })
  );

const committedInboundIdentityKey = (requestKey: string) =>
  inboundIdentityKey(
    Schema.decodeUnknownSync(CommitInboundMessageV1)(JSON.parse(requestKey))
  );

const inboundCommitRequestKey = (input: CommitInboundMessageType) =>
  JSON.stringify(
    Schema.encodeSync(CommitInboundMessageV1)({
      envelope: input.envelope,
      formatVersion: 1,
      inboundIngestId: input.inboundIngestId,
      mailboxId: input.mailboxId,
      message: input.message,
      receivedAt: input.receivedAt,
    })
  );

const executionAttempt = (
  input:
    | { readonly formatVersion: 1 }
    | { readonly formatVersion: 2; readonly executionAttempt: number }
) => (input.formatVersion === 1 ? 1 : input.executionAttempt);

const checkpointRank = {
  received: 0,
  raw_stored: 1,
  parsing: 2,
  attachments_stored: 3,
} as const;

const recordInboundProcessing = (
  mailboxId: MailboxId,
  input: RecordInboundProcessing,
  runtime: MailboxRuntime
) =>
  Effect.gen(function* () {
    const db = yield* MailboxDatabase;
    return yield* db.transaction((tx) =>
      // oxlint-disable-next-line eslint/complexity -- Monotonic state validation must be atomic with the write.
      Effect.gen(function* () {
        const requestKey = inboundIdentityKey(input);
        const attempt = executionAttempt(input);
        const [existing] = yield* tx
          .select()
          .from(inboundProcessing)
          .where(eq(inboundProcessing.id, input.inboundIngestId))
          .limit(1);
        if (existing !== undefined) {
          if (existing.attemptCount !== attempt) {
            return yield* messageDomainError(
              "record-inbound",
              "invalid-state",
              "Inbound Workflow execution is stale",
              { resourceType: "inbound", resourceId: input.inboundIngestId }
            );
          }
          if (
            existing.status === "ready" &&
            input._tag === "Failure" &&
            input.message !== undefined
          ) {
            const expectedCommitKey = inboundCommitRequestKey({
              envelope: input.envelope,
              formatVersion: 1,
              inboundIngestId: input.inboundIngestId,
              mailboxId: input.mailboxId,
              message: input.message,
              receivedAt: input.receivedAt,
            });
            if (existing.requestKey !== expectedCommitKey) {
              return yield* messageDomainError(
                "record-inbound",
                "idempotency-conflict",
                "Ready inbound message differs from the failed commit",
                {
                  resourceType: "inbound",
                  resourceId: input.inboundIngestId,
                }
              );
            }
          }
          const existingIdentityKey =
            existing.status === "ready"
              ? committedInboundIdentityKey(existing.requestKey)
              : existing.requestKey;
          if (existingIdentityKey !== requestKey) {
            return yield* messageDomainError(
              "record-inbound",
              "idempotency-conflict",
              "Inbound ingest ID was already recorded with different data",
              {
                resourceType: "inbound",
                resourceId: input.inboundIngestId,
              }
            );
          }
          if (existing.status === "ready" || existing.status === "failed") {
            return readInboundProcessingRow(existing, mailboxId);
          }

          const updatedAt = Math.max(
            runtime.now(),
            input.receivedAt,
            existing.updatedAt
          );
          if (input._tag === "Failure") {
            const [failed] = yield* tx
              .update(inboundProcessing)
              .set({
                status: "failed",
                failureCode: input.failure.code,
                failureAt: updatedAt,
                failureReplayable: input.failure.replayable ? 1 : 0,
                updatedAt,
                version: existing.version + 1,
              })
              .where(eq(inboundProcessing.id, input.inboundIngestId))
              .returning();
            if (failed === undefined) {
              return yield* Effect.die(
                new Error("Inbound failure update returned no row")
              );
            }
            return readInboundProcessingRow(failed, mailboxId);
          }

          const currentRank = checkpointRank[existing.status];
          const requestedRank = checkpointRank[input.status];
          if (requestedRank <= currentRank) {
            return readInboundProcessingRow(existing, mailboxId);
          }
          if (requestedRank !== currentRank + 1) {
            return yield* messageDomainError(
              "record-inbound",
              "invalid-state",
              "Inbound checkpoint cannot skip a processing state",
              {
                resourceType: "inbound",
                resourceId: input.inboundIngestId,
              }
            );
          }
          const [advanced] = yield* tx
            .update(inboundProcessing)
            .set({
              status: input.status,
              updatedAt,
              version: existing.version + 1,
            })
            .where(eq(inboundProcessing.id, input.inboundIngestId))
            .returning();
          if (advanced === undefined) {
            return yield* Effect.die(
              new Error("Inbound checkpoint update returned no row")
            );
          }
          return readInboundProcessingRow(advanced, mailboxId);
        }

        if (attempt !== 1) {
          return yield* messageDomainError(
            "record-inbound",
            "invalid-state",
            "Replayed inbound processing must already be prepared",
            { resourceType: "inbound", resourceId: input.inboundIngestId }
          );
        }
        if (input._tag === "Checkpoint" && input.status !== "raw_stored") {
          return yield* messageDomainError(
            "record-inbound",
            "invalid-state",
            "Inbound processing must begin at raw_stored",
            {
              resourceType: "inbound",
              resourceId: input.inboundIngestId,
            }
          );
        }
        const updatedAt = Math.max(runtime.now(), input.receivedAt);
        const [created] = yield* tx
          .insert(inboundProcessing)
          .values({
            id: input.inboundIngestId,
            status: input._tag === "Failure" ? "failed" : input.status,
            requestKey,
            failureCode: input._tag === "Failure" ? input.failure.code : null,
            failureAt: input._tag === "Failure" ? updatedAt : null,
            failureReplayable:
              input._tag === "Failure"
                ? input.failure.replayable
                  ? 1
                  : 0
                : null,
            attemptCount: 1,
            createdAt: input.receivedAt,
            updatedAt,
            version: 1,
          })
          .returning();
        if (created === undefined) {
          return yield* Effect.die(
            new Error("Inbound processing insert returned no row")
          );
        }
        return readInboundProcessingRow(created, mailboxId);
      })
    );
  });

const commitInboundMessage = (
  mailboxId: MailboxId,
  input: CommitInboundMessageType,
  runtime: MailboxRuntime
) =>
  Effect.gen(function* () {
    const db = yield* MailboxDatabase;
    return yield* db.transaction((tx) =>
      // oxlint-disable-next-line eslint/complexity -- The atomic commit keeps validation and writes in one transaction.
      Effect.gen(function* () {
        const requestKey = inboundCommitRequestKey(input);
        const identityKey = inboundIdentityKey(input);
        const attempt = executionAttempt(input);
        const [existing] = yield* tx
          .select()
          .from(inboundProcessing)
          .where(eq(inboundProcessing.id, input.inboundIngestId))
          .limit(1);
        if (existing !== undefined) {
          if (existing.attemptCount !== attempt) {
            return yield* messageDomainError(
              "commit-inbound",
              "invalid-state",
              "Inbound Workflow execution is stale",
              { resourceType: "inbound", resourceId: input.inboundIngestId }
            );
          }
          if (existing.status === "ready") {
            if (existing.requestKey !== requestKey) {
              return yield* messageDomainError(
                "commit-inbound",
                "idempotency-conflict",
                "Inbound ingest ID was already committed with different data",
                {
                  resourceType: "inbound",
                  resourceId: input.inboundIngestId,
                }
              );
            }
            return readInboundProcessingRow(existing, mailboxId);
          }
          if (existing.requestKey !== identityKey) {
            return yield* messageDomainError(
              "commit-inbound",
              "idempotency-conflict",
              "Inbound ingest ID was already recorded with different data",
              {
                resourceType: "inbound",
                resourceId: input.inboundIngestId,
              }
            );
          }
          if (existing.status !== "attachments_stored") {
            return yield* messageDomainError(
              "commit-inbound",
              "invalid-state",
              "Inbound processing has not stored its attachments",
              {
                resourceType: "inbound",
                resourceId: input.inboundIngestId,
              }
            );
          }
        }
        if (existing === undefined && attempt !== 1) {
          return yield* messageDomainError(
            "commit-inbound",
            "invalid-state",
            "Replayed inbound processing must already be prepared",
            { resourceType: "inbound", resourceId: input.inboundIngestId }
          );
        }

        const nearestReferences: RfcMessageId[] = [];
        for (
          let index = input.message.references.length - 1;
          index >= 0;
          index -= 1
        ) {
          const reference = input.message.references[index];
          if (reference !== undefined) {
            nearestReferences.push(reference);
          }
        }
        const referenceIds = [
          ...(input.message.inReplyTo === undefined
            ? []
            : [input.message.inReplyTo]),
          ...nearestReferences,
        ].filter((value, index, values) => values.indexOf(value) === index);
        const referencedMessages =
          referenceIds.length === 0
            ? []
            : yield* tx
                .select({
                  rfcMessageId: message.rfcMessageId,
                  threadId: message.threadId,
                })
                .from(message)
                .where(inArray(message.rfcMessageId, referenceIds));
        const referencedThreadId = referenceIds
          .map((referenceId) =>
            referencedMessages
              .filter(({ rfcMessageId }) => rfcMessageId === referenceId)
              .map(({ threadId }) => threadId)
              .filter((value, index, values) => values.indexOf(value) === index)
          )
          .find((threadIds) => threadIds.length === 1)?.[0];
        const threadId = referencedThreadId ?? runtime.randomId();
        const messageId = runtime.randomId();
        const now = Math.max(
          runtime.now(),
          input.receivedAt,
          existing?.updatedAt ?? 0
        );
        const recipients = [
          ...input.message.to,
          ...input.message.cc,
          ...input.message.bcc,
        ];
        const activeRuleRows = yield* tx
          .select()
          .from(filterRule)
          .where(and(eq(filterRule.enabled, 1), isNull(filterRule.deletedAt)))
          .orderBy(asc(filterRule.priority), asc(filterRule.id));
        const rules = activeRuleRows.map((row) =>
          Schema.decodeUnknownSync(RuleSchema)({
            id: row.id,
            mailboxId,
            name: row.name,
            enabled: row.enabled === 1,
            priority: row.priority,
            conditions: decodeJson(RuleConditions, row.conditionsJson),
            actions: decodeJson(RuleActions, row.actionsJson),
            aiInstruction: row.aiInstruction ?? undefined,
            stopProcessing: row.stopProcessing === 1,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            version: row.version,
          })
        );
        const evaluationInput = Schema.decodeUnknownSync(EvaluateRulesInput)({
          mailboxId,
          message: {
            envelopeFrom: input.envelope.envelopeFrom,
            envelopeTo: input.envelope.envelopeTo,
            from: input.message.sender?.address,
            to: input.message.to.map(({ address }) => address),
            cc: input.message.cc.map(({ address }) => address),
            bcc: input.message.bcc.map(({ address }) => address),
            subject: input.message.subject,
            textBody: input.message.textBody,
            hasAttachments: input.message.attachments.length > 0,
          },
          rules,
        });
        const evaluation = evaluateRules(evaluationInput);
        const asyncCandidates = evaluateAsyncRuleCandidates(evaluationInput);
        const asyncRulePlan =
          asyncCandidates.length === 0
            ? undefined
            : Schema.decodeUnknownSync(AsyncRulePlanV1)({
                formatVersion: 1,
                baseMessageVersion: 1,
                candidates: asyncCandidates.map((rule) => ({
                  ruleId: rule.id,
                  ruleVersion: rule.version,
                  instruction: rule.aiInstruction,
                  actions: rule.actions,
                })),
              });
        const asyncRuleJobId =
          asyncRulePlan === undefined
            ? undefined
            : Schema.decodeUnknownSync(AsyncRuleJobId)(input.inboundIngestId);
        const targetFolderIds = evaluation.actions.flatMap(({ action }) =>
          action._tag === "MoveToFolder" ? [action.folderId] : []
        );
        const targetLabelIds = evaluation.actions.flatMap(({ action }) =>
          action._tag === "AddLabel" ? [action.labelId] : []
        );
        const activeTargetFolders =
          targetFolderIds.length === 0
            ? []
            : yield* tx
                .select({ id: folder.id })
                .from(folder)
                .where(
                  and(
                    inArray(folder.id, targetFolderIds),
                    isNull(folder.deletedAt)
                  )
                );
        const activeTargetLabels =
          targetLabelIds.length === 0
            ? []
            : yield* tx
                .select({ id: label.id })
                .from(label)
                .where(
                  and(
                    inArray(label.id, targetLabelIds),
                    isNull(label.deletedAt)
                  )
                );
        const validFolderIds = new Set(activeTargetFolders.map(({ id }) => id));
        const validLabelIds = new Set(activeTargetLabels.map(({ id }) => id));
        let finalFolderId = "inbox";
        let finalRead = false;
        let finalStarred = false;
        const finalLabelIds = new Set<string>();
        const applications: {
          readonly plan: RuleEvaluationResult["actions"][number];
          readonly outcome: RuleApplicationOutcome;
        }[] = [];
        for (const plan of evaluation.actions) {
          const { action } = plan;
          let outcome: RuleApplicationOutcome;
          if (action._tag === "MoveToFolder") {
            if (!validFolderIds.has(action.folderId)) {
              outcome = "skipped_invalid_target";
            } else if (finalFolderId === action.folderId) {
              outcome = "noop";
            } else {
              finalFolderId = action.folderId;
              outcome = "applied";
            }
          } else if (action._tag === "AddLabel") {
            if (!validLabelIds.has(action.labelId)) {
              outcome = "skipped_invalid_target";
            } else if (finalLabelIds.has(action.labelId)) {
              outcome = "noop";
            } else {
              finalLabelIds.add(action.labelId);
              outcome = "applied";
            }
          } else if (action._tag === "SetRead") {
            if (finalRead === action.read) {
              outcome = "noop";
            } else {
              finalRead = action.read;
              outcome = "applied";
            }
          } else if (finalStarred === action.starred) {
            outcome = "noop";
          } else {
            finalStarred = action.starred;
            outcome = "applied";
          }
          applications.push({ plan, outcome });
        }

        yield* tx.insert(message).values({
          id: messageId,
          folderId: finalFolderId,
          version: 1,
          read: finalRead ? 1 : 0,
          threadId,
          direction: "inbound",
          subject: input.message.subject,
          senderJson:
            input.message.sender === undefined
              ? null
              : encodeJson(MailAddress, input.message.sender),
          replyToJson:
            input.message.replyTo === undefined
              ? null
              : encodeJson(AddressList, input.message.replyTo),
          recipientsJson: encodeJson(AddressList, recipients),
          snippet: inboundSnippet(input.message.textBody),
          activityAt: input.receivedAt,
          starred: finalStarred ? 1 : 0,
          needsReply: 0,
          size: input.envelope.rawSize,
          rfcMessageId: input.message.rfcMessageId ?? null,
          inReplyTo: input.message.inReplyTo ?? null,
          referencesJson: encodeJson(StringList, input.message.references),
          toJson: encodeJson(AddressList, input.message.to),
          ccJson: encodeJson(AddressList, input.message.cc),
          bccJson: encodeJson(AddressList, input.message.bcc),
          textBody: input.message.textBody ?? null,
          htmlBody: input.message.htmlBody ?? null,
          headerDate: input.message.headerDate ?? null,
          receivedAt: input.receivedAt,
          createdAt: now,
          updatedAt: now,
        });

        const result = Schema.decodeUnknownSync(InboundProcessingSchema)({
          id: input.inboundIngestId,
          mailboxId,
          status: "ready",
          messageId,
          asyncRuleJobId,
          attemptCount: existing?.attemptCount ?? 1,
          createdAt: existing?.createdAt ?? input.receivedAt,
          updatedAt: now,
          version: existing === undefined ? 1 : existing.version + 1,
        });
        yield* (
          existing === undefined
            ? tx.insert(inboundProcessing).values({
                id: result.id,
                status: result.status,
                messageId: result.messageId,
                requestKey,
                attemptCount: result.attemptCount,
                createdAt: result.createdAt,
                updatedAt: result.updatedAt,
                version: result.version,
              })
            : tx
                .update(inboundProcessing)
                .set({
                  status: result.status,
                  messageId: result.messageId,
                  requestKey,
                  updatedAt: result.updatedAt,
                  version: result.version,
                })
                .where(eq(inboundProcessing.id, result.id))
        ).pipe(Effect.asVoid);

        for (const metadata of input.message.attachments) {
          yield* tx.insert(attachment).values({
            id: runtime.randomId(),
            messageId,
            version: 1,
            fileName: metadata.fileName ?? "attachment",
            mimeType: metadata.mimeType,
            size: metadata.size,
            contentId: metadata.contentId ?? null,
            inboundIngestId: input.inboundIngestId,
            sourceIndex: metadata.index,
            disposition: metadata.disposition,
          });
        }

        if (finalLabelIds.size > 0) {
          yield* tx
            .insert(messageLabel)
            .values(
              [...finalLabelIds].map((labelId) => ({ messageId, labelId }))
            );
        }

        const evaluationRecord = Schema.decodeUnknownSync(RuleEvaluationRecord)(
          {
            inboundIngestId: input.inboundIngestId,
            mailboxId,
            messageId,
            engineVersion: 1,
            stoppedByRuleId: evaluation.stoppedByRuleId,
            evaluatedAt: now,
          }
        );
        yield* tx.insert(ruleEvaluation).values({
          inboundIngestId: evaluationRecord.inboundIngestId,
          messageId: evaluationRecord.messageId,
          engineVersion: evaluationRecord.engineVersion,
          stoppedByRuleId: evaluationRecord.stoppedByRuleId ?? null,
          evaluatedAt: evaluationRecord.evaluatedAt,
        });
        if (applications.length > 0) {
          yield* tx.insert(ruleApplication).values(
            applications.map(({ outcome, plan }) => {
              const application = Schema.decodeUnknownSync(RuleApplication)({
                inboundIngestId: input.inboundIngestId,
                mailboxId,
                messageId,
                ruleId: plan.ruleId,
                ruleVersion: plan.ruleVersion,
                actionIndex: plan.actionIndex,
                action: plan.action,
                outcome,
                appliedAt: now,
              });
              return {
                inboundIngestId: application.inboundIngestId,
                messageId: application.messageId,
                ruleId: application.ruleId,
                ruleVersion: application.ruleVersion,
                actionIndex: application.actionIndex,
                actionJson: encodeJson(RuleAction, application.action),
                outcome: application.outcome,
                appliedAt: application.appliedAt,
              };
            })
          );
        }

        if (asyncRulePlan !== undefined && asyncRuleJobId !== undefined) {
          const job = Schema.decodeUnknownSync(AsyncRuleJob)({
            id: asyncRuleJobId,
            inboundIngestId: input.inboundIngestId,
            mailboxId,
            messageId,
            plan: asyncRulePlan,
            status: "pending",
            createdAt: now,
            updatedAt: now,
            version: 1,
          });
          yield* tx.insert(asyncRuleJob).values({
            id: job.id,
            inboundIngestId: job.inboundIngestId,
            messageId: job.messageId,
            planJson: encodeJson(AsyncRulePlanV1, job.plan),
            status: job.status,
            createdAt: job.createdAt,
            updatedAt: job.updatedAt,
            version: job.version,
          });
          yield* tx
            .update(inboundProcessing)
            .set({ asyncRuleJobId })
            .where(eq(inboundProcessing.id, input.inboundIngestId));
        }

        return result;
      })
    );
  });

const prepareInboundReplay = (
  mailboxId: MailboxId,
  input: ReplayInboundInput,
  runtime: MailboxRuntime,
  operations: MailboxOperationStore
) =>
  Effect.gen(function* () {
    const db = yield* MailboxDatabase;
    return yield* db.transaction((tx) =>
      Effect.gen(function* () {
        const requestKey = JSON.stringify({
          inboundIngestId: input.inboundIngestId,
          mailboxId: input.mailboxId,
        });
        const previous = yield* operations.replay(
          input.operationId,
          "replay-inbound",
          "replay-inbound",
          requestKey,
          PreparedInboundReplayV1
        );
        if (previous !== undefined) {
          if (Result.isFailure(previous)) {
            return yield* previous.failure;
          }
          return previous.success;
        }
        const [existing] = yield* tx
          .select()
          .from(inboundProcessing)
          .where(eq(inboundProcessing.id, input.inboundIngestId))
          .limit(1);
        if (existing === undefined) {
          return yield* messageDomainError(
            "replay-inbound",
            "not-found",
            "Inbound processing was not found",
            { resourceType: "inbound", resourceId: input.inboundIngestId }
          );
        }
        if (existing.status !== "failed" || existing.failureReplayable !== 1) {
          return yield* messageDomainError(
            "replay-inbound",
            "invalid-state",
            "Inbound processing is not replayable",
            { resourceType: "inbound", resourceId: input.inboundIngestId }
          );
        }
        const original = Schema.decodeUnknownSync(InboundWorkflowParamsV1)(
          JSON.parse(existing.requestKey)
        );
        const workflowInstanceId = Schema.decodeUnknownSync(OperationId)(
          runtime.randomId()
        );
        const attemptCount = Math.max(existing.attemptCount, 1) + 1;
        const updatedAt = Math.max(runtime.now(), existing.updatedAt);
        const [reopened] = yield* tx
          .update(inboundProcessing)
          .set({
            status: "received",
            failureCode: null,
            failureAt: null,
            failureReplayable: null,
            attemptCount,
            updatedAt,
            version: existing.version + 1,
          })
          .where(eq(inboundProcessing.id, input.inboundIngestId))
          .returning();
        if (reopened === undefined) {
          return yield* Effect.die(
            new Error("Inbound replay update returned no row")
          );
        }
        const prepared = Schema.decodeUnknownSync(PreparedInboundReplayV1)({
          formatVersion: 1,
          processing: readInboundProcessingRow(reopened, mailboxId),
          workflow: {
            ...original,
            executionAttempt: attemptCount,
            formatVersion: 2,
            workflowInstanceId,
          },
        });
        yield* operations.store(
          input.operationId,
          "replay-inbound",
          requestKey,
          input.inboundIngestId,
          JSON.stringify(Schema.encodeSync(PreparedInboundReplayV1)(prepared)),
          updatedAt
        );
        return prepared;
      })
    );
  });

const makeMailboxInboundStore = (
  db: MailboxDatabase,
  runtime: MailboxRuntime,
  mailboxId: MailboxId,
  operations: MailboxOperationStore
) => ({
  commit: (input: CommitInboundMessageType) =>
    commitInboundMessage(mailboxId, input, runtime).pipe(
      Effect.provideService(MailboxDatabase, db)
    ),
  record: (input: RecordInboundProcessing) =>
    recordInboundProcessing(mailboxId, input, runtime).pipe(
      Effect.provideService(MailboxDatabase, db)
    ),
  prepareReplay: (input: ReplayInboundInput) =>
    prepareInboundReplay(mailboxId, input, runtime, operations).pipe(
      Effect.provideService(MailboxDatabase, db)
    ),
});

export type MailboxInboundStore = ReturnType<typeof makeMailboxInboundStore>;

export const MailboxInboundStore = Context.Service<MailboxInboundStore>(
  "cloudflare-inbox/MailboxInboundStore"
);

export const MailboxInboundStoreSqliteLayer = Layer.effect(
  MailboxInboundStore,
  Effect.gen(function* () {
    const db = yield* MailboxDatabase;
    const runtime = yield* MailboxRuntime;
    const { mailboxId } = yield* MailboxIdentity;
    const operations = yield* MailboxOperationStore;
    return MailboxInboundStore.of(
      makeMailboxInboundStore(db, runtime, mailboxId, operations)
    );
  })
);
