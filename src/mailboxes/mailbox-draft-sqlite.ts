import { and, eq, isNull, sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { DraftSchema } from "./draft";
import { CreateDraftInput } from "./draft-contract";
import type { GetDraftInput, UpdateDraftInput } from "./draft-contract";
import { MailboxDomainError } from "./errors/mailbox-domain-error";
import type { MailboxId } from "./identifiers";
import { MailboxDatabase } from "./mailbox-database";
import type { MailboxDirectoryRuntime } from "./mailbox-directory-runtime";
import {
  AddressList,
  encodeJson,
  readDraftRow,
  StringList,
} from "./mailbox-mail-row";
import {
  replayMailboxOperation,
  storeMailboxOperation,
} from "./mailbox-operation-sqlite";
import { draft } from "./mailbox-schema";
import { Version } from "./primitives";

const notFound = (draftId: string) =>
  new MailboxDomainError({
    operation: "get-draft",
    reason: "not-found",
    message: "Draft was not found",
    resourceType: "draft",
    resourceId: draftId,
  });

export const createDraft = (
  mailboxId: MailboxId,
  input: CreateDraftInput,
  runtime: MailboxDirectoryRuntime
) =>
  Effect.gen(function* () {
    const db = yield* MailboxDatabase;
    return yield* db.transaction((tx) =>
      Effect.gen(function* () {
        const requestKey = JSON.stringify(
          Schema.encodeSync(CreateDraftInput)(input)
        );
        const previous = yield* replayMailboxOperation(
          input.operationId,
          "create-draft",
          "create-draft",
          requestKey,
          DraftSchema
        );
        if (previous !== undefined) {
          if (Result.isFailure(previous)) {
            return yield* previous.failure;
          }
          return previous.success;
        }
        const id = runtime.randomId();
        const now = runtime.now();
        const [row] = yield* tx
          .insert(draft)
          .values({
            id,
            threadId: input.content.threadId ?? null,
            inReplyToMessageId: input.content.inReplyToMessageId ?? null,
            toJson: encodeJson(AddressList, input.content.to),
            ccJson: encodeJson(AddressList, input.content.cc),
            bccJson: encodeJson(AddressList, input.content.bcc),
            subject: input.content.subject,
            textBody: input.content.textBody ?? null,
            htmlBody: input.content.htmlBody ?? null,
            attachmentIdsJson: encodeJson(
              StringList,
              input.content.attachmentIds
            ),
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        if (row === undefined) {
          return yield* Effect.die("Draft insert returned no row");
        }
        const created = readDraftRow(row, mailboxId);
        yield* storeMailboxOperation(
          input.operationId,
          "create-draft",
          requestKey,
          id,
          JSON.stringify(Schema.encodeSync(DraftSchema)(created)),
          now
        );
        return created;
      })
    );
  });

export const getDraft = (mailboxId: MailboxId, input: GetDraftInput) =>
  Effect.gen(function* () {
    const db = yield* MailboxDatabase;
    const [row] = yield* db
      .select()
      .from(draft)
      .where(and(eq(draft.id, input.draftId), isNull(draft.deletedAt)))
      .limit(1);
    if (row === undefined) {
      return yield* notFound(input.draftId);
    }
    return readDraftRow(row, mailboxId);
  });

export const updateDraft = (
  mailboxId: MailboxId,
  input: UpdateDraftInput,
  runtime: MailboxDirectoryRuntime
) =>
  Effect.gen(function* () {
    const db = yield* MailboxDatabase;
    return yield* db.transaction((tx) =>
      Effect.gen(function* () {
        const [current] = yield* tx
          .select()
          .from(draft)
          .where(and(eq(draft.id, input.draftId), isNull(draft.deletedAt)))
          .limit(1);
        if (current === undefined) {
          return yield* notFound(input.draftId);
        }
        if (current.version !== input.expectedVersion) {
          return yield* new MailboxDomainError({
            operation: "update-draft",
            reason: "version-conflict",
            message: "Draft version does not match",
            resourceType: "draft",
            resourceId: input.draftId,
            expectedVersion: input.expectedVersion,
            actualVersion: Schema.decodeUnknownSync(Version)(current.version),
          });
        }
        const [updated] = yield* tx
          .update(draft)
          .set({
            threadId: input.content.threadId ?? null,
            inReplyToMessageId: input.content.inReplyToMessageId ?? null,
            toJson: encodeJson(AddressList, input.content.to),
            ccJson: encodeJson(AddressList, input.content.cc),
            bccJson: encodeJson(AddressList, input.content.bcc),
            subject: input.content.subject,
            textBody: input.content.textBody ?? null,
            htmlBody: input.content.htmlBody ?? null,
            attachmentIdsJson: encodeJson(
              StringList,
              input.content.attachmentIds
            ),
            updatedAt: Math.max(runtime.now(), current.updatedAt),
            version: sql`${draft.version} + 1`,
          })
          .where(
            and(
              eq(draft.id, input.draftId),
              eq(draft.version, input.expectedVersion),
              isNull(draft.deletedAt)
            )
          )
          .returning();
        if (updated === undefined) {
          return yield* new MailboxDomainError({
            operation: "update-draft",
            reason: "version-conflict",
            message: "Draft version does not match",
            resourceType: "draft",
            resourceId: input.draftId,
            expectedVersion: input.expectedVersion,
            actualVersion: Schema.decodeUnknownSync(Version)(current.version),
          });
        }
        return readDraftRow(updated, mailboxId);
      })
    );
  });
