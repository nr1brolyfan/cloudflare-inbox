import { eq, sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import { makeMailDataTestDatabase } from "../test/mail-data-test-database";
import {
  CreateDraftInput,
  GetDraftInput,
  UpdateDraftInput,
} from "./draft-contract";
import { MailboxDomainError } from "./errors/mailbox-domain-error";
import { MailboxId } from "./identifiers";
import { MailboxDatabase } from "./mailbox-database";
import { createDraft, getDraft, updateDraft } from "./mailbox-draft-sqlite";
import {
  addMessageLabel,
  getMessage,
  getThread,
  listMessages,
  moveMessage,
  setMessageRead,
} from "./mailbox-message-sqlite";
import {
  cancelOutboundDelivery,
  getOutboundDelivery,
  resendOutbound,
  scheduleOutbound,
} from "./mailbox-outbound-sqlite";
import {
  attachment,
  draft,
  folder,
  label,
  message,
  messageLabel,
  outboundDelivery,
} from "./mailbox-schema";
import {
  AddMessageLabelInput,
  GetMessageInput,
  GetThreadInput,
  ListMessagesInput,
  MoveMessageInput,
  SetMessageReadInput,
} from "./message-contract";
import {
  CancelOutboundDeliveryInput,
  GetOutboundDeliveryInput,
  ResendOutboundInput,
  ScheduleOutboundInput,
} from "./outbound-contract";

const mailboxId = Schema.decodeUnknownSync(MailboxId)("mailbox-a");

const makeRuntime = () => {
  let next = 0;
  return {
    now: () => 1000,
    randomId: () => `generated-${(next += 1)}`,
  };
};

const setup = Effect.gen(function* () {
  const db = yield* MailboxDatabase;
  yield* db.insert(folder).values([
    {
      id: "inbox",
      name: "Inbox",
      kind: "inbox",
      createdAt: 0,
      updatedAt: 0,
    },
    {
      id: "sent",
      name: "Sent",
      kind: "sent",
      createdAt: 0,
      updatedAt: 0,
    },
    {
      id: "drafts",
      name: "Drafts",
      kind: "drafts",
      createdAt: 0,
      updatedAt: 0,
    },
    {
      id: "scheduled",
      name: "Scheduled",
      kind: "scheduled",
      createdAt: 0,
      updatedAt: 0,
    },
    {
      id: "archive",
      name: "Archive",
      kind: "archive",
      createdAt: 0,
      updatedAt: 0,
    },
    {
      id: "spam",
      name: "Spam",
      kind: "spam",
      createdAt: 0,
      updatedAt: 0,
    },
    {
      id: "trash",
      name: "Trash",
      kind: "trash",
      createdAt: 0,
      updatedAt: 0,
    },
  ]);
});

const seedMessages = Effect.gen(function* () {
  const db = yield* MailboxDatabase;
  yield* db.insert(message).values([
    {
      id: "m1",
      folderId: "inbox",
      threadId: "thread-1",
      direction: "inbound",
      subject: "Hello",
      senderJson: '{"address":"sender@example.com","displayName":"Sender"}',
      recipientsJson: '[{"address":"owner@example.com"}]',
      snippet: "First",
      activityAt: 100,
      read: 0,
      starred: 0,
      needsReply: 1,
      size: 10,
      referencesJson: "[]",
      toJson: '[{"address":"owner@example.com"}]',
      ccJson: "[]",
      bccJson: "[]",
      textBody: "First body",
      receivedAt: 100,
      createdAt: 100,
      updatedAt: 100,
    },
    {
      id: "m2",
      folderId: "inbox",
      threadId: "thread-1",
      direction: "inbound",
      subject: "Re: Hello",
      senderJson: '{"address":"other@example.com"}',
      recipientsJson: '[{"address":"owner@example.com"}]',
      snippet: "Second",
      activityAt: 200,
      read: 1,
      starred: 1,
      needsReply: 0,
      size: 20,
      referencesJson: "[]",
      toJson: '[{"address":"owner@example.com"}]',
      ccJson: "[]",
      bccJson: "[]",
      textBody: "Second body",
      receivedAt: 200,
      createdAt: 200,
      updatedAt: 200,
    },
  ]);
  yield* db.insert(attachment).values({
    id: "attachment-1",
    messageId: "m1",
    fileName: "note.txt",
    mimeType: "text/plain",
    size: 4,
    disposition: "attachment",
  });
});

const failure = <A, E>(result: Result.Result<A, E>) => {
  if (Result.isSuccess(result)) {
    throw new Error("Expected failure");
  }
  if (!(result.failure instanceof MailboxDomainError)) {
    throw result.failure;
  }
  return result.failure;
};

describe("Mailbox mail data SQLite", () => {
  it("reconstructs messages, filters pages, and binds cursors", async () => {
    const run = makeMailDataTestDatabase();
    await run(
      Effect.gen(function* () {
        yield* setup;
        yield* seedMessages;
        const db = yield* MailboxDatabase;
        yield* db.insert(label).values({
          id: "important",
          name: "Important",
          createdAt: 0,
          updatedAt: 0,
        });
        yield* db
          .insert(messageLabel)
          .values({ messageId: "m1", labelId: "important" });

        const page = yield* listMessages(
          mailboxId,
          Schema.decodeUnknownSync(ListMessagesInput)({
            mailboxId,
            filters: { folderId: "inbox" },
            page: { limit: 1 },
          })
        );
        const detail = yield* getMessage(
          mailboxId,
          Schema.decodeUnknownSync(GetMessageInput)({
            mailboxId,
            messageId: "m1",
          })
        );
        const next = yield* listMessages(
          mailboxId,
          Schema.decodeUnknownSync(ListMessagesInput)({
            mailboxId,
            filters: { folderId: "inbox" },
            page: { limit: 1, cursor: page.nextCursor },
          })
        );
        const wrongCursor = failure(
          yield* Effect.result(
            listMessages(
              mailboxId,
              Schema.decodeUnknownSync(ListMessagesInput)({
                mailboxId,
                filters: { read: false },
                page: { cursor: page.nextCursor },
              })
            )
          )
        );
        const filtered = yield* listMessages(
          mailboxId,
          Schema.decodeUnknownSync(ListMessagesInput)({
            mailboxId,
            filters: {
              labelIds: ["important"],
              from: "sender@example.com",
              to: "owner@example.com",
              read: false,
              hasAttachment: true,
              direction: "inbound",
              needsReply: true,
            },
          })
        );

        expect({
          first: page.items[0]?.id,
          next: next.items[0]?.id,
          attachment: detail.attachments[0]?.fileName,
          sender: detail.sender?.address,
          cursorError: wrongCursor.reason,
          filtered: filtered.items.map((item) => item.id),
        }).toStrictEqual({
          first: "m2",
          next: "m1",
          attachment: "note.txt",
          sender: "sender@example.com",
          cursorError: "validation",
          filtered: ["m1"],
        });
      })
    );
  });

  it("returns chronological threads with a derived summary", async () => {
    const run = makeMailDataTestDatabase();
    await run(
      Effect.gen(function* () {
        yield* setup;
        yield* seedMessages;
        const thread = yield* getThread(
          mailboxId,
          Schema.decodeUnknownSync(GetThreadInput)({
            mailboxId,
            threadId: "thread-1",
          })
        );
        expect({
          ids: thread.messages.map((item) => item.id),
          count: thread.thread.messageCount,
          unread: thread.thread.unreadCount,
          latest: thread.thread.latestActivityAt,
        }).toStrictEqual({
          ids: ["m1", "m2"],
          count: 2,
          unread: 1,
          latest: 200,
        });
      })
    );
  });

  it("applies message CAS, no-op versioning, moves, and labels", async () => {
    const run = makeMailDataTestDatabase();
    const runtime = makeRuntime();
    await run(
      Effect.gen(function* () {
        yield* setup;
        yield* seedMessages;
        const db = yield* MailboxDatabase;
        yield* db.insert(label).values({
          id: "important",
          name: "Important",
          createdAt: 0,
          updatedAt: 0,
        });
        const read = yield* setMessageRead(
          mailboxId,
          Schema.decodeUnknownSync(SetMessageReadInput)({
            mailboxId,
            messageId: "m1",
            expectedVersion: 1,
            read: false,
          }),
          runtime
        );
        const labelled = yield* addMessageLabel(
          mailboxId,
          Schema.decodeUnknownSync(AddMessageLabelInput)({
            mailboxId,
            messageId: "m1",
            expectedVersion: 2,
            labelId: "important",
          }),
          runtime
        );
        const moved = yield* moveMessage(
          mailboxId,
          Schema.decodeUnknownSync(MoveMessageInput)({
            mailboxId,
            messageId: "m1",
            expectedVersion: 3,
            folderId: "archive",
          }),
          runtime
        );
        const conflict = failure(
          yield* Effect.result(
            setMessageRead(
              mailboxId,
              Schema.decodeUnknownSync(SetMessageReadInput)({
                mailboxId,
                messageId: "m1",
                expectedVersion: 1,
                read: true,
              }),
              runtime
            )
          )
        );
        const missingTarget = failure(
          yield* Effect.result(
            moveMessage(
              mailboxId,
              Schema.decodeUnknownSync(MoveMessageInput)({
                mailboxId,
                messageId: "m1",
                expectedVersion: 4,
                folderId: "missing",
              }),
              runtime
            )
          )
        );
        expect({
          read: read.version,
          labels: labelled.labelIds,
          folder: moved.folderId,
          conflict,
          missingTarget,
        }).toMatchObject({
          read: 2,
          labels: ["important"],
          folder: "archive",
          conflict: { reason: "version-conflict", actualVersion: 4 },
          missingTarget: { reason: "not-found", resourceType: "folder" },
        });
      })
    );
  });

  it("creates and updates drafts with replay and CAS", async () => {
    const run = makeMailDataTestDatabase();
    const runtime = makeRuntime();
    await run(
      Effect.gen(function* () {
        yield* setup;
        const input = Schema.decodeUnknownSync(CreateDraftInput)({
          mailboxId,
          operationId: "draft-op",
          content: {
            to: [{ address: "to@example.com" }],
            cc: [],
            bcc: [],
            subject: "Draft",
            textBody: "Body",
            attachmentIds: [],
          },
        });
        const created = yield* createDraft(mailboxId, input, runtime);
        const replay = yield* createDraft(mailboxId, input, runtime);
        const replayConflict = failure(
          yield* Effect.result(
            createDraft(
              mailboxId,
              Schema.decodeUnknownSync(CreateDraftInput)({
                ...Schema.encodeSync(CreateDraftInput)(input),
                content: { ...input.content, subject: "Different" },
              }),
              runtime
            )
          )
        );
        const updated = yield* updateDraft(
          mailboxId,
          Schema.decodeUnknownSync(UpdateDraftInput)({
            mailboxId,
            draftId: created.id,
            expectedVersion: 1,
            content: {
              ...input.content,
              subject: "Updated",
              textBody: undefined,
            },
          }),
          runtime
        );
        const found = yield* getDraft(
          mailboxId,
          Schema.decodeUnknownSync(GetDraftInput)({
            mailboxId,
            draftId: created.id,
          })
        );
        const stale = failure(
          yield* Effect.result(
            updateDraft(
              mailboxId,
              Schema.decodeUnknownSync(UpdateDraftInput)({
                mailboxId,
                draftId: created.id,
                expectedVersion: 1,
                content: input.content,
              }),
              runtime
            )
          )
        );
        expect({ replay, replayConflict, updated, found, stale }).toMatchObject(
          {
            replay: { id: created.id, subject: "Draft", version: 1 },
            replayConflict: { reason: "idempotency-conflict" },
            updated: { subject: "Updated", version: 2 },
            found: { subject: "Updated", version: 2 },
            stale: { reason: "version-conflict", actualVersion: 2 },
          }
        );
        expect(updated.textBody).toBeUndefined();
        expect(found.textBody).toBeUndefined();
      })
    );
  });

  it("schedules an immutable snapshot idempotently and cancels it", async () => {
    const run = makeMailDataTestDatabase();
    const runtime = makeRuntime();
    await run(
      Effect.gen(function* () {
        yield* setup;
        const created = yield* createDraft(
          mailboxId,
          Schema.decodeUnknownSync(CreateDraftInput)({
            mailboxId,
            operationId: "draft-schedule",
            content: {
              to: [{ address: "to@example.com" }],
              cc: [],
              bcc: [],
              subject: "Send",
              textBody: "Snapshot",
              attachmentIds: [],
            },
          }),
          runtime
        );
        const scheduleInput = Schema.decodeUnknownSync(ScheduleOutboundInput)({
          mailboxId,
          draftId: created.id,
          expectedVersion: 1,
          operationId: "schedule-op",
          sendAt: 1000,
        });
        const scheduled = yield* scheduleOutbound(
          mailboxId,
          scheduleInput,
          runtime
        );
        const replay = yield* scheduleOutbound(
          mailboxId,
          scheduleInput,
          runtime
        );
        const found = yield* getOutboundDelivery(
          mailboxId,
          Schema.decodeUnknownSync(GetOutboundDeliveryInput)({
            mailboxId,
            outboundDeliveryId: scheduled.delivery.id,
          })
        );
        const cancelled = yield* cancelOutboundDelivery(
          mailboxId,
          Schema.decodeUnknownSync(CancelOutboundDeliveryInput)({
            mailboxId,
            outboundDeliveryId: scheduled.delivery.id,
            expectedVersion: 1,
          }),
          runtime
        );
        const staleCancel = failure(
          yield* Effect.result(
            cancelOutboundDelivery(
              mailboxId,
              Schema.decodeUnknownSync(CancelOutboundDeliveryInput)({
                mailboxId,
                outboundDeliveryId: scheduled.delivery.id,
                expectedVersion: 1,
              }),
              runtime
            )
          )
        );
        const invalidState = failure(
          yield* Effect.result(
            cancelOutboundDelivery(
              mailboxId,
              Schema.decodeUnknownSync(CancelOutboundDeliveryInput)({
                mailboxId,
                outboundDeliveryId: scheduled.delivery.id,
                expectedVersion: 2,
              }),
              runtime
            )
          )
        );
        expect({
          scheduled,
          replay,
          found,
          cancelled,
          staleCancel,
          invalidState,
        }).toMatchObject({
          scheduled: { serverNow: 1000, delivery: { status: "scheduled" } },
          replay: { delivery: { id: scheduled.delivery.id } },
          found: { status: "scheduled" },
          cancelled: { status: "cancelled", version: 2 },
          staleCancel: { reason: "version-conflict", actualVersion: 2 },
          invalidState: { reason: "invalid-state" },
        });
      })
    );
  });

  it("validates scheduling and resends only eligible source states", async () => {
    const run = makeMailDataTestDatabase();
    const runtime = makeRuntime();
    await run(
      Effect.gen(function* () {
        yield* setup;
        const db = yield* MailboxDatabase;
        const empty = yield* createDraft(
          mailboxId,
          Schema.decodeUnknownSync(CreateDraftInput)({
            mailboxId,
            operationId: "empty-draft",
            content: {
              to: [],
              cc: [],
              bcc: [],
              subject: "Empty",
              attachmentIds: [],
            },
          }),
          runtime
        );
        const invalid = failure(
          yield* Effect.result(
            scheduleOutbound(
              mailboxId,
              Schema.decodeUnknownSync(ScheduleOutboundInput)({
                mailboxId,
                draftId: empty.id,
                expectedVersion: 1,
                operationId: "invalid-schedule",
                sendAt: 1000,
              }),
              runtime
            )
          )
        );
        const past = failure(
          yield* Effect.result(
            scheduleOutbound(
              mailboxId,
              Schema.decodeUnknownSync(ScheduleOutboundInput)({
                mailboxId,
                draftId: empty.id,
                expectedVersion: 1,
                operationId: "past-schedule",
                sendAt: 999,
              }),
              runtime
            )
          )
        );
        const eligible = yield* createDraft(
          mailboxId,
          Schema.decodeUnknownSync(CreateDraftInput)({
            mailboxId,
            operationId: "eligible-draft",
            content: {
              to: [{ address: "to@example.com" }],
              cc: [],
              bcc: [],
              subject: "Retry",
              attachmentIds: [],
            },
          }),
          runtime
        );
        const source = yield* scheduleOutbound(
          mailboxId,
          Schema.decodeUnknownSync(ScheduleOutboundInput)({
            mailboxId,
            draftId: eligible.id,
            expectedVersion: 1,
            operationId: "source-schedule",
            sendAt: 1000,
          }),
          runtime
        );
        const sourceState = failure(
          yield* Effect.result(
            resendOutbound(
              mailboxId,
              Schema.decodeUnknownSync(ResendOutboundInput)({
                mailboxId,
                outboundDeliveryId: source.delivery.id,
                expectedVersion: 1,
                operationId: "too-early-resend",
                acknowledgeDuplicateRisk: true,
              }),
              runtime
            )
          )
        );
        yield* db
          .update(outboundDelivery)
          .set({
            status: "failed",
            failureCode: "provider_rejected",
            failureAt: 1000,
          })
          .where(eq(outboundDelivery.id, source.delivery.id));
        const resendInput = Schema.decodeUnknownSync(ResendOutboundInput)({
          mailboxId,
          outboundDeliveryId: source.delivery.id,
          expectedVersion: 1,
          operationId: "resend-op",
          acknowledgeDuplicateRisk: true,
        });
        const resent = yield* resendOutbound(mailboxId, resendInput, runtime);
        const replay = yield* resendOutbound(mailboxId, resendInput, runtime);
        expect({
          invalid: invalid.reason,
          past: past.reason,
          sourceState,
          resent,
          replay,
        }).toMatchObject({
          invalid: "validation",
          past: "validation",
          sourceState: { reason: "invalid-state" },
          resent: {
            sourceDeliveryId: source.delivery.id,
            delivery: { status: "scheduled", resendOf: source.delivery.id },
          },
          replay: { delivery: { id: resent.delivery.id } },
        });
      })
    );
  });

  it("rolls back scheduling when the operation ledger write fails", async () => {
    const run = makeMailDataTestDatabase();
    const runtime = makeRuntime();
    await run(
      Effect.gen(function* () {
        yield* setup;
        const db = yield* MailboxDatabase;
        const created = yield* createDraft(
          mailboxId,
          Schema.decodeUnknownSync(CreateDraftInput)({
            mailboxId,
            operationId: "rollback-draft",
            content: {
              to: [{ address: "to@example.com" }],
              cc: [],
              bcc: [],
              subject: "Rollback",
              attachmentIds: [],
            },
          }),
          runtime
        );
        yield* db.run(
          sql.raw(`CREATE TRIGGER reject_schedule_operation
          BEFORE INSERT ON mailbox_operation
          WHEN NEW.operation_kind = 'schedule-outbound'
          BEGIN SELECT RAISE(ABORT, 'ledger unavailable'); END`)
        );
        const result = yield* Effect.result(
          scheduleOutbound(
            mailboxId,
            Schema.decodeUnknownSync(ScheduleOutboundInput)({
              mailboxId,
              draftId: created.id,
              expectedVersion: 1,
              operationId: "rollback-schedule",
              sendAt: 1000,
            }),
            runtime
          )
        );
        const [draftRow, messageCount, deliveryCount] = yield* Effect.all([
          db
            .select({ deletedAt: draft.deletedAt })
            .from(draft)
            .where(eq(draft.id, created.id))
            .pipe(Effect.map((rows) => rows[0])),
          db.$count(message),
          db.$count(outboundDelivery),
        ]);
        expect(Result.isFailure(result)).toBeTruthy();
        expect({ messageCount, deliveryCount, draftRow }).toStrictEqual({
          messageCount: 0,
          deliveryCount: 0,
          draftRow: { deletedAt: null },
        });
      })
    );
  });
});
