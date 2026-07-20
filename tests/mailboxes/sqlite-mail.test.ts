import { eq, sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import { MailboxId } from "#/mailboxes/core";
import {
  MailboxDoNamespace,
  MailboxRegistry,
  MailboxRepositoryDoLive,
} from "#/mailboxes/do-client";
import { MailboxDoHandler } from "#/mailboxes/do-handler";
import {
  CreateDraftInput,
  GetDraftInput,
  UpdateDraftInput,
} from "#/mailboxes/drafts";
import { MailboxDomainError } from "#/mailboxes/errors";
import {
  AddMessageLabelInput,
  GetMessageInput,
  GetThreadInput,
  ListMessagesInput,
  MoveMessageInput,
  SearchMessagesInput,
  SetMessageReadInput,
} from "#/mailboxes/messages";
import {
  CancelOutboundDeliveryInput,
  GetOutboundDeliveryInput,
  ResendOutboundInput,
  ScheduleOutboundInput,
} from "#/mailboxes/outbound";
import { MailboxRepository } from "#/mailboxes/repository";
import {
  attachment,
  draft,
  folder,
  label,
  message,
  messageLabel,
  outboundDelivery,
} from "#/mailboxes/sqlite-schema";
import {
  MailboxDatabase,
  MailboxDraftStore,
  MailboxIdentity,
  MailboxMessageStore,
  MailboxOutboundStore,
  MailboxRuntime,
} from "#/mailboxes/sqlite-services";

import {
  MailboxDatabaseTestLive,
  MailboxDoHandlerTestLive,
} from "../support/mailbox-sqlite";

const mailboxId = Schema.decodeUnknownSync(MailboxId)("mailbox-a");

const makeRuntime = () => {
  let next = 0;
  return {
    now: () => 1000,
    randomId: () => `generated-${(next += 1)}`,
  };
};

const mailboxSqliteTestLive = (runtime = makeRuntime()) =>
  MailboxDoHandlerTestLive.pipe(
    Layer.provide(
      Layer.merge(
        Layer.succeed(MailboxIdentity, MailboxIdentity.of({ mailboxId })),
        Layer.succeed(MailboxRuntime, MailboxRuntime.of(runtime))
      )
    ),
    Layer.provideMerge(MailboxDatabaseTestLive)
  );

const listMessages = (input: ListMessagesInput) =>
  MailboxMessageStore.pipe(
    Effect.flatMap((store) => store.listMessages(input))
  );
const searchMessages = (input: SearchMessagesInput) =>
  MailboxMessageStore.pipe(
    Effect.flatMap((store) => store.searchMessages(input))
  );
const getMessage = (input: GetMessageInput) =>
  MailboxMessageStore.pipe(Effect.flatMap((store) => store.getMessage(input)));
const getThread = (input: GetThreadInput) =>
  MailboxMessageStore.pipe(Effect.flatMap((store) => store.getThread(input)));
const setMessageRead = (input: SetMessageReadInput) =>
  MailboxMessageStore.pipe(
    Effect.flatMap((store) => store.setMessageRead(input))
  );
const moveMessage = (input: MoveMessageInput) =>
  MailboxMessageStore.pipe(Effect.flatMap((store) => store.moveMessage(input)));
const addMessageLabel = (input: AddMessageLabelInput) =>
  MailboxMessageStore.pipe(
    Effect.flatMap((store) => store.addMessageLabel(input))
  );
const createDraft = (input: CreateDraftInput) =>
  MailboxDraftStore.pipe(Effect.flatMap((store) => store.createDraft(input)));
const getDraft = (input: GetDraftInput) =>
  MailboxDraftStore.pipe(Effect.flatMap((store) => store.getDraft(input)));
const updateDraft = (input: UpdateDraftInput) =>
  MailboxDraftStore.pipe(Effect.flatMap((store) => store.updateDraft(input)));
const scheduleOutbound = (input: ScheduleOutboundInput) =>
  MailboxOutboundStore.pipe(
    Effect.flatMap((store) => store.scheduleOutbound(input))
  );
const getOutboundDelivery = (input: GetOutboundDeliveryInput) =>
  MailboxOutboundStore.pipe(
    Effect.flatMap((store) => store.getOutboundDelivery(input))
  );
const cancelOutboundDelivery = (input: CancelOutboundDeliveryInput) =>
  MailboxOutboundStore.pipe(
    Effect.flatMap((store) => store.cancelOutboundDelivery(input))
  );
const resendOutbound = (input: ResendOutboundInput) =>
  MailboxOutboundStore.pipe(
    Effect.flatMap((store) => store.resendOutbound(input))
  );

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
  it("returns update-draft not-found through the DO handler and client", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const handler = yield* MailboxDoHandler;
        const repositoryLive = MailboxRepositoryDoLive.pipe(
          Layer.provide(
            Layer.merge(
              Layer.succeed(
                MailboxRegistry,
                MailboxRegistry.of({ exists: () => Effect.succeed(true) })
              ),
              Layer.succeed(
                MailboxDoNamespace,
                MailboxDoNamespace.of({
                  getByName: () => ({
                    executeDirectory: handler.executeDirectory,
                    executeMailData: handler.executeMailData,
                    resolveMailResource: handler.resolveMailResource,
                  }),
                })
              )
            )
          )
        );
        const error = yield* Effect.gen(function* () {
          const repository = yield* MailboxRepository;
          return yield* repository.updateDraft(
            Schema.decodeUnknownSync(UpdateDraftInput)({
              mailboxId,
              operationId: "missing-draft-op",
              draftId: "missing-draft",
              expectedVersion: 1,
              content: {
                to: [{ address: "to@example.com" }],
                cc: [],
                bcc: [],
                subject: "Missing",
                attachmentIds: [],
              },
            })
          );
        }).pipe(Effect.provide(repositoryLive), Effect.flip);

        expect(error).toBeInstanceOf(MailboxDomainError);
        expect(error).toMatchObject({
          operation: "update-draft",
          reason: "not-found",
          resourceType: "draft",
          resourceId: "missing-draft",
        });
      }).pipe(Effect.provide(mailboxSqliteTestLive()))
    );
  });

  it("reconstructs messages, filters pages, and binds cursors", async () => {
    await Effect.runPromise(
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
          Schema.decodeUnknownSync(ListMessagesInput)({
            mailboxId,
            filters: { folderId: "inbox" },
            page: { limit: 1 },
          })
        );
        const detail = yield* getMessage(
          Schema.decodeUnknownSync(GetMessageInput)({
            mailboxId,
            messageId: "m1",
          })
        );
        const next = yield* listMessages(
          Schema.decodeUnknownSync(ListMessagesInput)({
            mailboxId,
            filters: { folderId: "inbox" },
            page: { limit: 1, cursor: page.nextCursor },
          })
        );
        const wrongCursor = failure(
          yield* Effect.result(
            listMessages(
              Schema.decodeUnknownSync(ListMessagesInput)({
                mailboxId,
                filters: { read: false },
                page: { cursor: page.nextCursor },
              })
            )
          )
        );
        const filtered = yield* listMessages(
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
      }).pipe(Effect.provide(mailboxSqliteTestLive()))
    );
  });

  it("keeps cursors bounded and query-bound for many long label IDs", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* setup;
        yield* seedMessages;
        const db = yield* MailboxDatabase;
        const labelIds = Array.from({ length: 24 }, (_, index) =>
          `label-${index}-`.padEnd(128, "x")
        );
        yield* db.insert(label).values(
          labelIds.map((id, index) => ({
            id,
            name: `Long label ${index}`,
            createdAt: 0,
            updatedAt: 0,
          }))
        );
        yield* db.insert(messageLabel).values(
          labelIds.flatMap((labelId) => [
            { messageId: "m1", labelId },
            { messageId: "m2", labelId },
          ])
        );

        const first = yield* listMessages(
          Schema.decodeUnknownSync(ListMessagesInput)({
            mailboxId,
            filters: { labelIds },
            page: { limit: 1 },
          })
        );
        if (first.nextCursor === undefined) {
          return yield* Effect.die("Expected a next cursor");
        }
        const next = yield* listMessages(
          Schema.decodeUnknownSync(ListMessagesInput)({
            mailboxId,
            filters: { labelIds },
            page: { limit: 1, cursor: first.nextCursor },
          })
        );
        const wrongQuery = failure(
          yield* Effect.result(
            listMessages(
              Schema.decodeUnknownSync(ListMessagesInput)({
                mailboxId,
                filters: { labelIds: labelIds.slice(1) },
                page: { limit: 1, cursor: first.nextCursor },
              })
            )
          )
        );

        expect(first.nextCursor.length).toBeLessThanOrEqual(2048);
        expect(next.items.map((item) => item.id)).toStrictEqual(["m1"]);
        expect(wrongQuery.reason).toBe("validation");
      }).pipe(Effect.provide(mailboxSqliteTestLive()))
    );
  });

  it("searches messages through FTS with query-bound cursors", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* setup;
        yield* seedMessages;

        const first = yield* searchMessages(
          Schema.decodeUnknownSync(SearchMessagesInput)({
            mailboxId,
            query: "body",
            page: { limit: 1 },
          })
        );
        if (first.nextCursor === undefined) {
          return yield* Effect.die("Expected a next cursor");
        }
        const next = yield* searchMessages(
          Schema.decodeUnknownSync(SearchMessagesInput)({
            mailboxId,
            query: "body",
            page: { limit: 1, cursor: first.nextCursor },
          })
        );
        const wrongQuery = failure(
          yield* Effect.result(
            searchMessages(
              Schema.decodeUnknownSync(SearchMessagesInput)({
                mailboxId,
                query: "First",
                page: { limit: 1, cursor: first.nextCursor },
              })
            )
          )
        );
        const db = yield* MailboxDatabase;
        yield* db
          .update(message)
          .set({ deletedAt: 300, updatedAt: 300 })
          .where(eq(message.id, "m2"));
        const staleCursor = failure(
          yield* Effect.result(
            searchMessages(
              Schema.decodeUnknownSync(SearchMessagesInput)({
                mailboxId,
                query: "body",
                page: { limit: 1, cursor: first.nextCursor },
              })
            )
          )
        );

        expect({
          first: first.items.map((item) => item.id),
          next: next.items.map((item) => item.id),
          staleCursor: staleCursor.reason,
          wrongQuery: wrongQuery.reason,
        }).toStrictEqual({
          first: ["m2"],
          next: ["m1"],
          staleCursor: "validation",
          wrongQuery: "validation",
        });
      }).pipe(Effect.provide(mailboxSqliteTestLive()))
    );
  });

  it("keeps the FTS index consistent across message updates and soft deletes", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* setup;
        yield* seedMessages;
        const db = yield* MailboxDatabase;

        const before = yield* searchMessages(
          Schema.decodeUnknownSync(SearchMessagesInput)({
            mailboxId,
            query: "First",
          })
        );
        yield* db
          .update(message)
          .set({
            subject: "Updated",
            snippet: "Alpha",
            textBody: "Alpha body",
            updatedAt: 300,
          })
          .where(eq(message.id, "m1"));
        const oldTerm = yield* searchMessages(
          Schema.decodeUnknownSync(SearchMessagesInput)({
            mailboxId,
            query: "First",
          })
        );
        const newTerm = yield* searchMessages(
          Schema.decodeUnknownSync(SearchMessagesInput)({
            mailboxId,
            query: "Alpha",
          })
        );
        yield* db
          .update(message)
          .set({ deletedAt: 400, updatedAt: 400 })
          .where(eq(message.id, "m1"));
        const deleted = yield* searchMessages(
          Schema.decodeUnknownSync(SearchMessagesInput)({
            mailboxId,
            query: "Alpha",
          })
        );

        expect({
          before: before.items.map((item) => item.id),
          oldTerm: oldTerm.items.map((item) => item.id),
          newTerm: newTerm.items.map((item) => item.id),
          deleted: deleted.items.map((item) => item.id),
        }).toStrictEqual({
          before: ["m1"],
          oldTerm: [],
          newTerm: ["m1"],
          deleted: [],
        });
      }).pipe(Effect.provide(mailboxSqliteTestLive()))
    );
  });

  it("projects acceptedAt from the canonical outbound delivery", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* setup;
        yield* seedMessages;
        const db = yield* MailboxDatabase;
        yield* db.insert(outboundDelivery).values({
          id: "delivery-1",
          messageId: "m1",
          status: "accepted",
          sendAt: 200,
          acceptedAt: 400,
          createdAt: 200,
          updatedAt: 400,
        });
        yield* db
          .update(message)
          .set({
            direction: "outbound",
            outboundDeliveryId: "delivery-1",
            receivedAt: null,
            scheduledAt: 200,
            acceptedAt: 300,
          })
          .where(eq(message.id, "m1"));

        const detail = yield* getMessage(
          Schema.decodeUnknownSync(GetMessageInput)({
            mailboxId,
            messageId: "m1",
          })
        );

        expect(detail.acceptedAt).toBe(400);
      }).pipe(Effect.provide(mailboxSqliteTestLive()))
    );
  });

  it("returns chronological threads with a derived summary", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* setup;
        yield* seedMessages;
        const thread = yield* getThread(
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
      }).pipe(Effect.provide(mailboxSqliteTestLive()))
    );
  });

  it("returns the latest bounded thread page when pagination is not requested", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* setup;
        const db = yield* MailboxDatabase;
        yield* db.insert(message).values(
          Array.from({ length: 51 }, (_, index) => ({
            activityAt: index,
            bccJson: "[]",
            ccJson: "[]",
            createdAt: index,
            direction: "inbound" as const,
            folderId: "inbox",
            id: `message-${String(index).padStart(2, "0")}`,
            needsReply: 0,
            read: 1,
            receivedAt: index,
            recipientsJson: '[{"address":"owner@example.com"}]',
            referencesJson: "[]",
            senderJson: '{"address":"sender@example.com"}',
            size: 10,
            snippet: `Message ${index}`,
            starred: 0,
            subject: `Message ${index}`,
            textBody: `Body ${index}`,
            threadId: "long-thread",
            toJson: '[{"address":"owner@example.com"}]',
            updatedAt: index,
          }))
        );

        const complete = yield* getThread(
          Schema.decodeUnknownSync(GetThreadInput)({
            mailboxId,
            threadId: "long-thread",
          })
        );
        const paged = yield* getThread(
          Schema.decodeUnknownSync(GetThreadInput)({
            mailboxId,
            page: {},
            threadId: "long-thread",
          })
        );

        expect({
          first: complete.messages[0]?.id,
          last: complete.messages.at(-1)?.id,
          length: complete.messages.length,
          nextCursor: complete.nextCursor,
        }).toStrictEqual({
          first: "message-01",
          last: "message-50",
          length: 50,
          nextCursor: undefined,
        });
        expect({
          length: paged.messages.length,
          nextCursor: typeof paged.nextCursor,
        }).toStrictEqual({ length: 50, nextCursor: "string" });
      }).pipe(Effect.provide(mailboxSqliteTestLive()))
    );
  });

  it("applies message CAS, no-op versioning, moves, and labels", async () => {
    const runtime = makeRuntime();
    await Effect.runPromise(
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
        const readInput = Schema.decodeUnknownSync(SetMessageReadInput)({
          mailboxId,
          operationId: "read-op",
          messageId: "m1",
          expectedVersion: 1,
          read: false,
        });
        const read = yield* setMessageRead(readInput);
        const readReplay = yield* setMessageRead(readInput);
        const labelled = yield* addMessageLabel(
          Schema.decodeUnknownSync(AddMessageLabelInput)({
            mailboxId,
            operationId: "label-message-op",
            messageId: "m1",
            expectedVersion: 2,
            labelId: "important",
          })
        );
        const moved = yield* moveMessage(
          Schema.decodeUnknownSync(MoveMessageInput)({
            mailboxId,
            operationId: "move-message-op",
            messageId: "m1",
            expectedVersion: 3,
            folderId: "archive",
          })
        );
        const conflict = failure(
          yield* Effect.result(
            setMessageRead(
              Schema.decodeUnknownSync(SetMessageReadInput)({
                mailboxId,
                operationId: "read-stale-op",
                messageId: "m1",
                expectedVersion: 1,
                read: true,
              })
            )
          )
        );
        const missingTarget = failure(
          yield* Effect.result(
            moveMessage(
              Schema.decodeUnknownSync(MoveMessageInput)({
                mailboxId,
                operationId: "move-missing-folder-op",
                messageId: "m1",
                expectedVersion: 4,
                folderId: "missing",
              })
            )
          )
        );
        expect({
          read: read.version,
          readReplay: readReplay.version,
          labels: labelled.labelIds,
          folder: moved.folderId,
          conflict,
          missingTarget,
        }).toMatchObject({
          read: 2,
          readReplay: 2,
          labels: ["important"],
          folder: "archive",
          conflict: { reason: "version-conflict", actualVersion: 4 },
          missingTarget: { reason: "not-found", resourceType: "folder" },
        });
      }).pipe(Effect.provide(mailboxSqliteTestLive(runtime)))
    );
  });

  it("rolls back message mutations when the operation ledger write fails", async () => {
    const runtime = makeRuntime();
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* setup;
        yield* seedMessages;
        const db = yield* MailboxDatabase;
        yield* db.run(
          sql.raw(`CREATE TRIGGER reject_message_mutation_operation
          BEFORE INSERT ON mailbox_operation
          WHEN NEW.operation_kind = 'set-message-read'
          BEGIN SELECT RAISE(ABORT, 'ledger unavailable'); END`)
        );

        const result = yield* Effect.result(
          setMessageRead(
            Schema.decodeUnknownSync(SetMessageReadInput)({
              mailboxId,
              operationId: "rollback-read-op",
              messageId: "m1",
              expectedVersion: 1,
              read: true,
            })
          )
        );
        const [row] = yield* db
          .select({ read: message.read, version: message.version })
          .from(message)
          .where(eq(message.id, "m1"));

        expect({ failed: Result.isFailure(result), row }).toStrictEqual({
          failed: true,
          row: { read: 0, version: 1 },
        });
      }).pipe(Effect.provide(mailboxSqliteTestLive(runtime)))
    );
  });

  it("creates and updates drafts with replay and CAS", async () => {
    const runtime = makeRuntime();
    await Effect.runPromise(
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
        const created = yield* createDraft(input);
        const replay = yield* createDraft(input);
        const replayConflict = failure(
          yield* Effect.result(
            createDraft(
              Schema.decodeUnknownSync(CreateDraftInput)({
                ...Schema.encodeSync(CreateDraftInput)(input),
                content: { ...input.content, subject: "Different" },
              })
            )
          )
        );
        const updateInput = Schema.decodeUnknownSync(UpdateDraftInput)({
          mailboxId,
          operationId: "update-draft-op",
          draftId: created.id,
          expectedVersion: 1,
          content: {
            ...input.content,
            subject: "Updated",
            textBody: undefined,
          },
        });
        const updated = yield* updateDraft(updateInput);
        const updateReplay = yield* updateDraft(updateInput);
        const found = yield* getDraft(
          Schema.decodeUnknownSync(GetDraftInput)({
            mailboxId,
            draftId: created.id,
          })
        );
        const stale = failure(
          yield* Effect.result(
            updateDraft(
              Schema.decodeUnknownSync(UpdateDraftInput)({
                mailboxId,
                operationId: "stale-draft-op",
                draftId: created.id,
                expectedVersion: 1,
                content: input.content,
              })
            )
          )
        );
        expect({
          replay,
          replayConflict,
          updated,
          updateReplay,
          found,
          stale,
        }).toMatchObject({
          replay: { id: created.id, subject: "Draft", version: 1 },
          replayConflict: { reason: "idempotency-conflict" },
          updated: { subject: "Updated", version: 2 },
          updateReplay: { subject: "Updated", version: 2 },
          found: { subject: "Updated", version: 2 },
          stale: { reason: "version-conflict", actualVersion: 2 },
        });
        expect(updated.textBody).toBeUndefined();
        expect(found.textBody).toBeUndefined();
      }).pipe(Effect.provide(mailboxSqliteTestLive(runtime)))
    );
  });

  it("schedules an immutable snapshot idempotently and cancels it", async () => {
    const runtime = makeRuntime();
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* setup;
        const created = yield* createDraft(
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
          })
        );
        const scheduleInput = Schema.decodeUnknownSync(ScheduleOutboundInput)({
          mailboxId,
          draftId: created.id,
          expectedVersion: 1,
          operationId: "schedule-op",
          sendAt: 1000,
        });
        const scheduled = yield* scheduleOutbound(scheduleInput);
        const replay = yield* scheduleOutbound(scheduleInput);
        const found = yield* getOutboundDelivery(
          Schema.decodeUnknownSync(GetOutboundDeliveryInput)({
            mailboxId,
            outboundDeliveryId: scheduled.delivery.id,
          })
        );
        const cancelInput = Schema.decodeUnknownSync(
          CancelOutboundDeliveryInput
        )({
          mailboxId,
          operationId: "cancel-op",
          outboundDeliveryId: scheduled.delivery.id,
          expectedVersion: 1,
        });
        const cancelled = yield* cancelOutboundDelivery(cancelInput);
        const cancelReplay = yield* cancelOutboundDelivery(cancelInput);
        const staleCancel = failure(
          yield* Effect.result(
            cancelOutboundDelivery(
              Schema.decodeUnknownSync(CancelOutboundDeliveryInput)({
                mailboxId,
                operationId: "stale-cancel-op",
                outboundDeliveryId: scheduled.delivery.id,
                expectedVersion: 1,
              })
            )
          )
        );
        const invalidState = failure(
          yield* Effect.result(
            cancelOutboundDelivery(
              Schema.decodeUnknownSync(CancelOutboundDeliveryInput)({
                mailboxId,
                operationId: "invalid-cancel-op",
                outboundDeliveryId: scheduled.delivery.id,
                expectedVersion: 2,
              })
            )
          )
        );
        expect({
          scheduled,
          replay,
          found,
          cancelled,
          cancelReplay,
          staleCancel,
          invalidState,
        }).toMatchObject({
          scheduled: { serverNow: 1000, delivery: { status: "scheduled" } },
          replay: { delivery: { id: scheduled.delivery.id } },
          found: { status: "scheduled" },
          cancelled: { status: "cancelled", version: 2 },
          cancelReplay: { status: "cancelled", version: 2 },
          staleCancel: { reason: "version-conflict", actualVersion: 2 },
          invalidState: { reason: "invalid-state" },
        });
      }).pipe(Effect.provide(mailboxSqliteTestLive(runtime)))
    );
  });

  it("validates scheduling and resends only eligible source states", async () => {
    const runtime = makeRuntime();
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* setup;
        const db = yield* MailboxDatabase;
        const empty = yield* createDraft(
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
          })
        );
        const invalid = failure(
          yield* Effect.result(
            scheduleOutbound(
              Schema.decodeUnknownSync(ScheduleOutboundInput)({
                mailboxId,
                draftId: empty.id,
                expectedVersion: 1,
                operationId: "invalid-schedule",
                sendAt: 1000,
              })
            )
          )
        );
        const past = failure(
          yield* Effect.result(
            scheduleOutbound(
              Schema.decodeUnknownSync(ScheduleOutboundInput)({
                mailboxId,
                draftId: empty.id,
                expectedVersion: 1,
                operationId: "past-schedule",
                sendAt: 999,
              })
            )
          )
        );
        const eligible = yield* createDraft(
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
          })
        );
        const source = yield* scheduleOutbound(
          Schema.decodeUnknownSync(ScheduleOutboundInput)({
            mailboxId,
            draftId: eligible.id,
            expectedVersion: 1,
            operationId: "source-schedule",
            sendAt: 1000,
          })
        );
        const sourceState = failure(
          yield* Effect.result(
            resendOutbound(
              Schema.decodeUnknownSync(ResendOutboundInput)({
                mailboxId,
                outboundDeliveryId: source.delivery.id,
                expectedVersion: 1,
                operationId: "too-early-resend",
                acknowledgeDuplicateRisk: true,
              })
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
        const resent = yield* resendOutbound(resendInput);
        const replay = yield* resendOutbound(resendInput);
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
      }).pipe(Effect.provide(mailboxSqliteTestLive(runtime)))
    );
  });

  it("rolls back scheduling when the operation ledger write fails", async () => {
    const runtime = makeRuntime();
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* setup;
        const db = yield* MailboxDatabase;
        const created = yield* createDraft(
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
          })
        );
        yield* db.run(
          sql.raw(`CREATE TRIGGER reject_schedule_operation
          BEFORE INSERT ON mailbox_operation
          WHEN NEW.operation_kind = 'schedule-outbound'
          BEGIN SELECT RAISE(ABORT, 'ledger unavailable'); END`)
        );
        const result = yield* Effect.result(
          scheduleOutbound(
            Schema.decodeUnknownSync(ScheduleOutboundInput)({
              mailboxId,
              draftId: created.id,
              expectedVersion: 1,
              operationId: "rollback-schedule",
              sendAt: 1000,
            })
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
      }).pipe(Effect.provide(mailboxSqliteTestLive(runtime)))
    );
  });
});
