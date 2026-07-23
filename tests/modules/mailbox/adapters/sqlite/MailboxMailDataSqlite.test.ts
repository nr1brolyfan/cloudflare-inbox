import { eq, sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  MailboxDoClientLayer,
  MailboxDoNamespace,
} from "#/modules/mailbox/adapters/durable-object/MailboxDoClient";
import {
  MailboxDoHandler,
  MailboxDoHandlerLayer,
} from "#/modules/mailbox/adapters/durable-object/MailboxDoHandler";
import { MailboxDraftRepositoryDoLayer } from "#/modules/mailbox/adapters/durable-object/MailboxRepositoryDo";
import { MailboxDirectoryStore } from "#/modules/mailbox/adapters/sqlite/MailboxDirectoryStoreSqlite";
import { MailboxDoStoreSqliteLayer } from "#/modules/mailbox/adapters/sqlite/MailboxDoStoreSqlite";
import { MailboxDraftAttachmentStore } from "#/modules/mailbox/adapters/sqlite/MailboxDraftAttachmentStoreSqlite";
import { MailboxDraftStore } from "#/modules/mailbox/adapters/sqlite/MailboxDraftStoreSqlite";
import { MailboxMessageStore } from "#/modules/mailbox/adapters/sqlite/MailboxMessageStoreSqlite";
import { MailboxOutboundStore } from "#/modules/mailbox/adapters/sqlite/MailboxOutboundStoreSqlite";
import { MailboxDatabase } from "#/modules/mailbox/adapters/sqlite/MailboxSqliteDatabase";
import { MailboxRuntime } from "#/modules/mailbox/adapters/sqlite/MailboxSqliteRuntime";
import {
  attachment,
  draft,
  draftAttachment,
  folder,
  label,
  message,
  messageLabel,
  outboundDelivery,
} from "#/modules/mailbox/adapters/sqlite/MailboxSqliteSchema";
import { MailboxOutboundAlarmScheduler } from "#/modules/mailbox/application/MailboxOutboundAlarmScheduler";
import { MailboxId } from "#/modules/mailbox/domain/Mailbox";
import {
  CreateDraftInput,
  GetDraftInput,
  ListDraftsInput,
  UpdateDraftInput,
} from "#/modules/mailbox/domain/MailboxDraft";
import {
  CompleteDraftAttachmentInput,
  GetDraftAttachmentInput,
  ListDraftAttachmentsInput,
  ReserveDraftAttachmentCommand,
} from "#/modules/mailbox/domain/MailboxDraftAttachment";
import { MailboxDomainError } from "#/modules/mailbox/domain/MailboxError";
import {
  AddMessageLabelInput,
  GetMessageInput,
  GetThreadInput,
  ListMessagesInput,
  MoveMessageInput,
  SearchMessagesInput,
  SetMessageReadInput,
} from "#/modules/mailbox/domain/MailboxMessage";
import {
  CancelOutboundDeliveryInput,
  GetOutboundDeliveryInput,
  ResendOutboundInput,
  ScheduleOutboundInput,
  outboundUndoWindowMillis,
} from "#/modules/mailbox/domain/MailboxOutbound";
import { MailDataRpcResponse } from "#/modules/mailbox/ports/MailboxDoProtocol";
import { MailboxDraftRepository } from "#/modules/mailbox/ports/MailboxDraftRepository";
import { MailboxIdentity } from "#/modules/mailbox/ports/MailboxIdentity";
import { MailboxRegistry } from "#/modules/mailbox/ports/MailboxRegistry";
import { MailAddress } from "#/shared/MailAddress";

import {
  MailboxDatabaseTestLive,
  MailboxDoHandlerTestLive,
  MailboxStoresTestLive,
} from "../../../../support/mailbox-sqlite";

const mailboxId = Schema.decodeUnknownSync(MailboxId)("mailbox-a");
const sender = Schema.decodeUnknownSync(MailAddress)({
  address: "sender@example.com",
  displayName: "Sender",
});
const explicitConfirmation = { confirmation: "explicit-user-action" } as const;

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
const listDrafts = (input: ListDraftsInput) =>
  MailboxDraftStore.pipe(Effect.flatMap((store) => store.listDrafts(input)));
const updateDraft = (input: UpdateDraftInput) =>
  MailboxDraftStore.pipe(Effect.flatMap((store) => store.updateDraft(input)));
const reserveDraftAttachment = (input: ReserveDraftAttachmentCommand) =>
  MailboxDraftAttachmentStore.pipe(
    Effect.flatMap((store) => store.reserveDraftAttachment(input))
  );
const getDraftAttachment = (input: GetDraftAttachmentInput) =>
  MailboxDraftAttachmentStore.pipe(
    Effect.flatMap((store) => store.getDraftAttachment(input))
  );
const listDraftAttachments = (input: ListDraftAttachmentsInput) =>
  MailboxDraftAttachmentStore.pipe(
    Effect.flatMap((store) => store.listDraftAttachments(input))
  );
const completeDraftAttachment = (input: CompleteDraftAttachmentInput) =>
  MailboxDraftAttachmentStore.pipe(
    Effect.flatMap((store) => store.completeDraftAttachment(input))
  );
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
        const clientLayer = MailboxDoClientLayer.pipe(
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
        const repositoryLayer = MailboxDraftRepositoryDoLayer.pipe(
          Layer.provide(clientLayer)
        );
        const error = yield* Effect.gen(function* () {
          const repository = yield* MailboxDraftRepository;
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
        }).pipe(Effect.provide(repositoryLayer), Effect.flip);

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
          providerMessageId: "provider-message-1",
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

  it("lists only active bounded draft summaries with keyset pagination", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* setup;
        const db = yield* MailboxDatabase;
        yield* db.insert(draft).values([
          {
            id: "draft-c",
            toJson:
              '[{"address":"to@example.com"},{"address":"hidden@example.com"}]',
            ccJson: '[{"address":"cc@example.com"}]',
            bccJson: '[{"address":"bcc@example.com"}]',
            subject: "Newest",
            textBody: "x".repeat(1_000_000),
            attachmentIdsJson: '["attachment-1"]',
            createdAt: 100,
            updatedAt: 300,
          },
          {
            id: "draft-b",
            subject: "Same timestamp",
            htmlBody: "<p>HTML preview</p>",
            createdAt: 100,
            updatedAt: 300,
          },
          {
            id: "draft-a",
            subject: "Older",
            textBody: "Older preview",
            createdAt: 100,
            updatedAt: 200,
          },
          {
            id: "draft-sent",
            subject: "Sent",
            textBody: "Must not be listed",
            createdAt: 100,
            updatedAt: 400,
            deletedAt: 400,
          },
        ]);

        const first = yield* listDrafts(
          Schema.decodeUnknownSync(ListDraftsInput)({
            mailboxId,
            page: { limit: 2 },
          })
        );
        if (first.nextCursor === undefined) {
          return yield* Effect.die("Expected a draft cursor");
        }
        const second = yield* listDrafts(
          Schema.decodeUnknownSync(ListDraftsInput)({
            mailboxId,
            page: { cursor: first.nextCursor, limit: 2 },
          })
        );
        const folders = yield* MailboxDirectoryStore.pipe(
          Effect.flatMap((store) => store.listFolders())
        );
        const draftsFolder = folders.items.find(
          (item) => item.kind === "drafts"
        );

        expect(first.items.map((item) => item.id)).toStrictEqual([
          "draft-c",
          "draft-b",
        ]);
        expect(second.items.map((item) => item.id)).toStrictEqual(["draft-a"]);
        expect(first.items[0]).toMatchObject({
          hasAttachments: true,
          mailboxId: "mailbox-a",
          recipients: [
            { address: "to@example.com" },
            { address: "cc@example.com" },
            { address: "bcc@example.com" },
          ],
          snippet: "x".repeat(500),
        });
        expect(Object.keys(first.items[0] ?? {})).toStrictEqual([
          "id",
          "mailboxId",
          "recipients",
          "subject",
          "snippet",
          "hasAttachments",
          "updatedAt",
          "version",
        ]);
        expect(draftsFolder).toMatchObject({ messageCount: 3, unreadCount: 0 });
      }).pipe(Effect.provide(mailboxSqliteTestLive()))
    );
  });

  it("reserves and atomically attaches an idempotently stored upload", async () => {
    const runtime = makeRuntime();
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* setup;
        const created = yield* createDraft(
          Schema.decodeUnknownSync(CreateDraftInput)({
            mailboxId,
            operationId: "draft-for-attachment",
            content: {
              attachmentIds: [],
              bcc: [],
              cc: [],
              subject: "Attachment",
              to: [],
            },
          })
        );
        const reserveInput = Schema.decodeUnknownSync(
          ReserveDraftAttachmentCommand
        )({
          draftId: created.id,
          fileName: "brief.pdf",
          mailboxId,
          mimeType: "application/pdf",
          operationId: "reserve-attachment",
          size: 3,
        });
        const reserved = yield* reserveDraftAttachment(reserveInput);
        const replay = yield* reserveDraftAttachment(reserveInput);
        const before = yield* listDraftAttachments(
          Schema.decodeUnknownSync(ListDraftAttachmentsInput)({
            draftId: created.id,
            mailboxId,
          })
        );
        const completionInput = Schema.decodeUnknownSync(
          CompleteDraftAttachmentInput
        )({
          attachmentId: reserved.id,
          contentSha256: "a".repeat(64),
          draftId: created.id,
          mailboxId,
        });
        const completed = yield* completeDraftAttachment(completionInput);
        const completionReplay =
          yield* completeDraftAttachment(completionInput);
        const found = yield* getDraftAttachment(
          Schema.decodeUnknownSync(GetDraftAttachmentInput)({
            attachmentId: reserved.id,
            draftId: created.id,
            mailboxId,
          })
        );
        const updatedDraft = yield* getDraft(
          Schema.decodeUnknownSync(GetDraftInput)({
            draftId: created.id,
            mailboxId,
          })
        );
        const conflict = failure(
          yield* Effect.result(
            completeDraftAttachment(
              Schema.decodeUnknownSync(CompleteDraftAttachmentInput)({
                ...completionInput,
                contentSha256: "b".repeat(64),
              })
            )
          )
        );

        expect({
          before,
          completed,
          completionReplay,
          conflict,
          found,
          replay,
          reserved,
          updatedDraft,
        }).toMatchObject({
          before: { items: [{ id: reserved.id, status: "reserved" }] },
          completed: {
            attachment: { id: reserved.id, status: "stored" },
            draftVersion: 2,
          },
          completionReplay: { draftVersion: 2 },
          conflict: { reason: "idempotency-conflict" },
          found: { id: reserved.id, status: "stored" },
          replay: { id: reserved.id },
          reserved: { status: "reserved" },
          updatedDraft: { attachmentIds: [reserved.id], version: 2 },
        });
      }).pipe(Effect.provide(mailboxSqliteTestLive(runtime)))
    );
  });

  it("expires unused reservations before blob storage and releases quota", async () => {
    let now = 1000;
    let next = 0;
    const runtime = {
      now: () => now,
      randomId: () => `expiry-${(next += 1)}`,
    };
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* setup;
        const created = yield* createDraft(
          Schema.decodeUnknownSync(CreateDraftInput)({
            mailboxId,
            operationId: "expiry-draft",
            content: {
              attachmentIds: [],
              bcc: [],
              cc: [],
              subject: "Expiry",
              to: [],
            },
          })
        );
        const reservation = yield* reserveDraftAttachment(
          Schema.decodeUnknownSync(ReserveDraftAttachmentCommand)({
            draftId: created.id,
            fileName: "old.pdf",
            mailboxId,
            mimeType: "application/pdf",
            operationId: "reserve-old",
            size: 1024,
          })
        );
        now = reservation.expiresAt;
        const expired = failure(
          yield* Effect.result(
            getDraftAttachment(
              Schema.decodeUnknownSync(GetDraftAttachmentInput)({
                attachmentId: reservation.id,
                draftId: created.id,
                mailboxId,
              })
            )
          )
        );
        const listed = yield* listDraftAttachments(
          Schema.decodeUnknownSync(ListDraftAttachmentsInput)({
            draftId: created.id,
            mailboxId,
          })
        );
        const replacement = yield* reserveDraftAttachment(
          Schema.decodeUnknownSync(ReserveDraftAttachmentCommand)({
            draftId: created.id,
            fileName: "new.pdf",
            mailboxId,
            mimeType: "application/pdf",
            operationId: "reserve-new",
            size: 1024,
          })
        );

        expect({ expired, listed, replacement }).toMatchObject({
          expired: {
            operation: "get-draft-attachment",
            reason: "invalid-state",
          },
          listed: { items: [] },
          replacement: { status: "reserved" },
        });
      }).pipe(Effect.provide(mailboxSqliteTestLive(runtime)))
    );
  });

  it("creates an immutable outbound attachment snapshot from stored uploads", async () => {
    const runtime = makeRuntime();
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* setup;
        const db = yield* MailboxDatabase;
        const created = yield* createDraft(
          Schema.decodeUnknownSync(CreateDraftInput)({
            mailboxId,
            operationId: "snapshot-draft",
            content: {
              attachmentIds: [],
              bcc: [],
              cc: [],
              htmlBody: "é",
              subject: "Snapshot",
              textBody: "Body",
              to: [{ address: "to@example.com" }],
            },
          })
        );
        const reserved = yield* reserveDraftAttachment(
          Schema.decodeUnknownSync(ReserveDraftAttachmentCommand)({
            draftId: created.id,
            fileName: "brief.pdf",
            mailboxId,
            mimeType: "application/pdf",
            operationId: "snapshot-reserve",
            size: 3,
          })
        );
        const completed = yield* completeDraftAttachment(
          Schema.decodeUnknownSync(CompleteDraftAttachmentInput)({
            attachmentId: reserved.id,
            contentSha256: "a".repeat(64),
            draftId: created.id,
            mailboxId,
          })
        );
        const scheduled = yield* scheduleOutbound(
          Schema.decodeUnknownSync(ScheduleOutboundInput)({
            ...explicitConfirmation,
            draftId: created.id,
            expectedVersion: completed.draftVersion,
            mailboxId,
            operationId: "snapshot-schedule",
            sender,
          })
        );
        const [messageBefore] = yield* db
          .select({ size: message.size })
          .from(message)
          .where(eq(message.id, scheduled.delivery.messageId));
        const [snapshotBefore] = yield* db
          .select()
          .from(attachment)
          .where(eq(attachment.messageId, scheduled.delivery.messageId));
        yield* db
          .update(draftAttachment)
          .set({ fileName: "changed.pdf" })
          .where(eq(draftAttachment.id, reserved.id));
        yield* db
          .update(outboundDelivery)
          .set({
            failureAt: 1000,
            failureCode: "provider_rejected",
            status: "failed",
          })
          .where(eq(outboundDelivery.id, scheduled.delivery.id));
        const resent = yield* resendOutbound(
          Schema.decodeUnknownSync(ResendOutboundInput)({
            ...explicitConfirmation,
            acknowledgeDuplicateRisk: true,
            expectedVersion: 1,
            mailboxId,
            operationId: "snapshot-resend",
            outboundDeliveryId: scheduled.delivery.id,
          })
        );
        const [snapshotAfter] = yield* db
          .select()
          .from(attachment)
          .where(eq(attachment.messageId, scheduled.delivery.messageId));
        const [resendSnapshot] = yield* db
          .select()
          .from(attachment)
          .where(eq(attachment.messageId, resent.delivery.messageId));

        expect({
          messageBefore,
          resendSnapshot,
          snapshotAfter,
          snapshotBefore,
        }).toMatchObject({
          messageBefore: { size: 9 },
          resendSnapshot: {
            contentSha256: "a".repeat(64),
            draftAttachmentId: reserved.id,
            fileName: "brief.pdf",
          },
          snapshotAfter: {
            contentSha256: "a".repeat(64),
            draftAttachmentId: reserved.id,
            fileName: "brief.pdf",
            mimeType: "application/pdf",
            size: 3,
          },
          snapshotBefore: {
            contentSha256: "a".repeat(64),
            draftAttachmentId: reserved.id,
            fileName: "brief.pdf",
          },
        });
      }).pipe(Effect.provide(mailboxSqliteTestLive(runtime)))
    );
  });

  it("rejects resending a legacy snapshot without a blob locator", async () => {
    const runtime = makeRuntime();
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* setup;
        const db = yield* MailboxDatabase;
        const created = yield* createDraft(
          Schema.decodeUnknownSync(CreateDraftInput)({
            mailboxId,
            operationId: "legacy-locator-draft",
            content: {
              attachmentIds: [],
              bcc: [],
              cc: [],
              subject: "Legacy",
              to: [{ address: "to@example.com" }],
            },
          })
        );
        const scheduled = yield* scheduleOutbound(
          Schema.decodeUnknownSync(ScheduleOutboundInput)({
            ...explicitConfirmation,
            draftId: created.id,
            expectedVersion: 1,
            mailboxId,
            operationId: "legacy-locator-schedule",
            sender,
          })
        );
        yield* db.insert(attachment).values({
          fileName: "legacy.bin",
          id: "legacy-snapshot-attachment",
          messageId: scheduled.delivery.messageId,
          mimeType: "application/octet-stream",
          size: 3,
        });
        yield* db
          .update(outboundDelivery)
          .set({
            failureAt: 1000,
            failureCode: "provider_rejected",
            status: "failed",
          })
          .where(eq(outboundDelivery.id, scheduled.delivery.id));
        const result = failure(
          yield* Effect.result(
            resendOutbound(
              Schema.decodeUnknownSync(ResendOutboundInput)({
                ...explicitConfirmation,
                acknowledgeDuplicateRisk: true,
                expectedVersion: 1,
                mailboxId,
                operationId: "legacy-locator-resend",
                outboundDeliveryId: scheduled.delivery.id,
              })
            )
          )
        );

        expect(result).toMatchObject({
          operation: "resend-outbound",
          reason: "invalid-state",
        });
      }).pipe(Effect.provide(mailboxSqliteTestLive(runtime)))
    );
  });

  it("reconciles the outbound alarm after scheduling, replay, cancellation, and resend", async () => {
    const runtime = makeRuntime();
    let reconcileCount = 0;
    const outboundAlarm = MailboxOutboundAlarmScheduler.of({
      nextScheduledAt: Effect.succeed(null),
      reconcile: Effect.sync(() => {
        reconcileCount += 1;
      }),
    });
    const outboundAlarmLayer = Layer.succeed(
      MailboxOutboundAlarmScheduler,
      outboundAlarm
    );
    const storeLayer = MailboxDoStoreSqliteLayer.pipe(
      Layer.provide(outboundAlarmLayer),
      Layer.provide(MailboxStoresTestLive)
    );
    const testLive = Layer.merge(
      MailboxDoHandlerLayer.pipe(Layer.provide(storeLayer)),
      MailboxStoresTestLive
    ).pipe(
      Layer.provide(
        Layer.merge(
          Layer.succeed(MailboxIdentity, MailboxIdentity.of({ mailboxId })),
          Layer.succeed(MailboxRuntime, MailboxRuntime.of(runtime))
        )
      ),
      Layer.provideMerge(MailboxDatabaseTestLive)
    );

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* setup;
        const handler = yield* MailboxDoHandler;
        const firstDraft = yield* createDraft(
          Schema.decodeUnknownSync(CreateDraftInput)({
            mailboxId,
            operationId: "alarm-draft",
            content: {
              attachmentIds: [],
              bcc: [],
              cc: [],
              subject: "Alarm",
              to: [{ address: "to@example.com" }],
            },
          })
        );
        const scheduleInput = Schema.decodeUnknownSync(ScheduleOutboundInput)({
          ...explicitConfirmation,
          draftId: firstDraft.id,
          expectedVersion: 1,
          mailboxId,
          operationId: "alarm-schedule",
          sender,
        });
        const scheduled = Schema.decodeUnknownSync(MailDataRpcResponse)(
          yield* handler.executeMailData({
            _tag: "ScheduleOutbound",
            input: scheduleInput,
          })
        );
        const replay = Schema.decodeUnknownSync(MailDataRpcResponse)(
          yield* handler.executeMailData({
            _tag: "ScheduleOutbound",
            input: scheduleInput,
          })
        );
        if (scheduled._tag !== "OutboundScheduled") {
          throw new Error("Expected scheduled outbound response");
        }
        yield* handler.executeMailData({
          _tag: "CancelOutboundDelivery",
          input: Schema.decodeUnknownSync(CancelOutboundDeliveryInput)({
            expectedVersion: 1,
            mailboxId,
            operationId: "alarm-cancel",
            outboundDeliveryId: scheduled.value.delivery.id,
          }),
        });

        const resendDraft = yield* createDraft(
          Schema.decodeUnknownSync(CreateDraftInput)({
            mailboxId,
            operationId: "alarm-resend-draft",
            content: {
              attachmentIds: [],
              bcc: [],
              cc: [],
              subject: "Alarm resend",
              to: [{ address: "to@example.com" }],
            },
          })
        );
        const source = Schema.decodeUnknownSync(MailDataRpcResponse)(
          yield* handler.executeMailData({
            _tag: "ScheduleOutbound",
            input: Schema.decodeUnknownSync(ScheduleOutboundInput)({
              ...explicitConfirmation,
              draftId: resendDraft.id,
              expectedVersion: 1,
              mailboxId,
              operationId: "alarm-resend-source",
              sender,
            }),
          })
        );
        if (source._tag !== "OutboundScheduled") {
          throw new Error("Expected resend source response");
        }
        const db = yield* MailboxDatabase;
        yield* db
          .update(outboundDelivery)
          .set({
            failureAt: 1000,
            failureCode: "provider_rejected",
            status: "failed",
          })
          .where(eq(outboundDelivery.id, source.value.delivery.id));
        const resent = Schema.decodeUnknownSync(MailDataRpcResponse)(
          yield* handler.executeMailData({
            _tag: "ResendOutbound",
            input: Schema.decodeUnknownSync(ResendOutboundInput)({
              ...explicitConfirmation,
              acknowledgeDuplicateRisk: true,
              expectedVersion: 1,
              mailboxId,
              operationId: "alarm-resend",
              outboundDeliveryId: source.value.delivery.id,
            }),
          })
        );

        expect({
          reconcileCount,
          replayTag: replay._tag,
          resendTag: resent._tag,
        }).toStrictEqual({
          reconcileCount: 5,
          replayTag: "OutboundScheduled",
          resendTag: "OutboundResent",
        });
      }).pipe(Effect.provide(testLive))
    );
  });

  it("replays scheduling across sender changes and the undo deadline", async () => {
    let now = 1000;
    const runtime = {
      ...makeRuntime(),
      now: () => now,
    };
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* setup;
        const db = yield* MailboxDatabase;
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
          ...explicitConfirmation,
          mailboxId,
          draftId: created.id,
          expectedVersion: 1,
          operationId: "schedule-op",
          sender,
        });
        const scheduled = yield* scheduleOutbound(scheduleInput);
        now = scheduled.delivery.sendAt + 1000;
        const replay = yield* scheduleOutbound(
          Schema.decodeUnknownSync(ScheduleOutboundInput)({
            ...explicitConfirmation,
            ...scheduleInput,
            sender: {
              address: "new-sender@example.com",
              displayName: "New Sender",
            },
          })
        );
        const [messageSnapshot] = yield* db
          .select({ senderJson: message.senderJson })
          .from(message)
          .where(eq(message.id, scheduled.delivery.messageId));
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
        now = scheduled.delivery.sendAt - 1;
        const cancelled = yield* cancelOutboundDelivery(cancelInput);
        now = scheduled.delivery.sendAt;
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
          ...replay,
          delivery: { ...replay.delivery },
        }).toStrictEqual({
          delivery: {
            attemptCount: scheduled.delivery.attemptCount,
            createdAt: scheduled.delivery.createdAt,
            id: scheduled.delivery.id,
            mailboxId: scheduled.delivery.mailboxId,
            messageId: scheduled.delivery.messageId,
            sendAt: scheduled.delivery.sendAt,
            status: scheduled.delivery.status,
            updatedAt: scheduled.delivery.updatedAt,
            version: scheduled.delivery.version,
          },
          serverNow: scheduled.serverNow,
        });
        expect({ ...cancelReplay }).toStrictEqual({
          attemptCount: cancelled.attemptCount,
          cancelledAt: cancelled.cancelledAt,
          createdAt: cancelled.createdAt,
          id: cancelled.id,
          mailboxId: cancelled.mailboxId,
          messageId: cancelled.messageId,
          sendAt: cancelled.sendAt,
          status: cancelled.status,
          updatedAt: cancelled.updatedAt,
          version: cancelled.version,
        });
        expect({
          scheduled,
          replay,
          found,
          cancelled,
          cancelReplay,
          staleCancel,
          invalidState,
          messageSnapshot,
        }).toMatchObject({
          scheduled: {
            serverNow: 1000,
            delivery: {
              sendAt: 1000 + outboundUndoWindowMillis,
              status: "scheduled",
            },
          },
          replay: { delivery: { id: scheduled.delivery.id } },
          found: { status: "scheduled" },
          cancelled: { status: "cancelled", version: 2 },
          cancelReplay: { status: "cancelled", version: 2 },
          staleCancel: { reason: "version-conflict", actualVersion: 2 },
          invalidState: { reason: "invalid-state" },
          messageSnapshot: {
            senderJson:
              '{"address":"sender@example.com","displayName":"Sender"}',
          },
        });
      }).pipe(Effect.provide(mailboxSqliteTestLive(runtime)))
    );
  });

  it("rejects missing and AI confirmations before replay or draft mutation", async () => {
    const runtime = makeRuntime();
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* setup;
        const db = yield* MailboxDatabase;
        const handler = yield* MailboxDoHandler;
        const malformed = yield* Effect.exit(
          handler.executeMailData({
            _tag: "ScheduleOutbound",
            input: {
              draftId: "draft-missing-confirmation",
              expectedVersion: 1,
              mailboxId,
              operationId: "missing-confirmation",
              sender,
            },
          })
        );
        const created = yield* createDraft(
          Schema.decodeUnknownSync(CreateDraftInput)({
            mailboxId,
            operationId: "provenance-draft",
            content: {
              attachmentIds: [],
              bcc: [],
              cc: [],
              subject: "Requires click",
              to: [{ address: "to@example.com" }],
            },
          })
        );
        const input = Schema.decodeUnknownSync(ScheduleOutboundInput)({
          ...explicitConfirmation,
          draftId: created.id,
          expectedVersion: created.version,
          mailboxId,
          operationId: "known-send-operation",
          sender,
        });
        const directAi = failure(
          yield* Effect.result(
            scheduleOutbound({
              ...input,
              confirmation: "ai-tool-execution",
            })
          )
        );
        const [draftAfterAi] = yield* db
          .select({ deletedAt: draft.deletedAt, version: draft.version })
          .from(draft)
          .where(eq(draft.id, created.id));
        const deliveriesAfterAi = yield* db.select().from(outboundDelivery);
        const sent = yield* scheduleOutbound(input);
        const replay = yield* scheduleOutbound(input);
        const launderedReplay = failure(
          yield* Effect.result(
            scheduleOutbound({
              ...input,
              confirmation: "ai-tool-execution",
            })
          )
        );
        const deliveries = yield* db.select().from(outboundDelivery);

        expect(Exit.isFailure(malformed)).toBeTruthy();
        expect({ directAi, draftAfterAi, deliveriesAfterAi }).toMatchObject({
          directAi: { operation: "schedule-outbound", reason: "validation" },
          draftAfterAi: { deletedAt: null, version: 1 },
          deliveriesAfterAi: [],
        });
        expect(replay.delivery.id).toBe(sent.delivery.id);
        expect(launderedReplay).toMatchObject({
          operation: "schedule-outbound",
          reason: "validation",
        });
        expect(deliveries).toHaveLength(1);
      }).pipe(Effect.provide(mailboxSqliteTestLive(runtime)))
    );
  });

  it("rejects cancellation at and after the undo deadline", async () => {
    let now = 1000;
    const runtime = {
      ...makeRuntime(),
      now: () => now,
    };
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* setup;
        const created = yield* createDraft(
          Schema.decodeUnknownSync(CreateDraftInput)({
            mailboxId,
            operationId: "deadline-draft",
            content: {
              to: [{ address: "to@example.com" }],
              cc: [],
              bcc: [],
              subject: "Deadline",
              attachmentIds: [],
            },
          })
        );
        const scheduled = yield* scheduleOutbound(
          Schema.decodeUnknownSync(ScheduleOutboundInput)({
            ...explicitConfirmation,
            mailboxId,
            draftId: created.id,
            expectedVersion: 1,
            operationId: "deadline-schedule",
            sender,
          })
        );
        const cancelAt = (operationId: string) =>
          cancelOutboundDelivery(
            Schema.decodeUnknownSync(CancelOutboundDeliveryInput)({
              mailboxId,
              operationId,
              outboundDeliveryId: scheduled.delivery.id,
              expectedVersion: 1,
            })
          );

        now = scheduled.delivery.sendAt;
        const atDeadline = failure(
          yield* Effect.result(cancelAt("cancel-at-deadline"))
        );
        now += 1;
        const afterDeadline = failure(
          yield* Effect.result(cancelAt("cancel-after-deadline"))
        );
        const found = yield* getOutboundDelivery(
          Schema.decodeUnknownSync(GetOutboundDeliveryInput)({
            mailboxId,
            outboundDeliveryId: scheduled.delivery.id,
          })
        );

        expect({ atDeadline, afterDeadline, found }).toMatchObject({
          atDeadline: {
            operation: "cancel-outbound",
            reason: "invalid-state",
          },
          afterDeadline: {
            operation: "cancel-outbound",
            reason: "invalid-state",
          },
          found: { status: "scheduled", version: 1 },
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
                ...explicitConfirmation,
                mailboxId,
                draftId: empty.id,
                expectedVersion: 1,
                operationId: "invalid-schedule",
                sender,
              })
            )
          )
        );
        const crowded = yield* createDraft(
          Schema.decodeUnknownSync(CreateDraftInput)({
            mailboxId,
            operationId: "crowded-draft",
            content: {
              to: Array.from({ length: 51 }, (_, index) => ({
                address: `recipient-${index}@example.com`,
              })),
              cc: [],
              bcc: [],
              subject: "Too many recipients",
              attachmentIds: [],
            },
          })
        );
        const tooManyRecipients = failure(
          yield* Effect.result(
            scheduleOutbound(
              Schema.decodeUnknownSync(ScheduleOutboundInput)({
                ...explicitConfirmation,
                mailboxId,
                draftId: crowded.id,
                expectedVersion: 1,
                operationId: "crowded-schedule",
                sender,
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
            ...explicitConfirmation,
            mailboxId,
            draftId: eligible.id,
            expectedVersion: 1,
            operationId: "source-schedule",
            sender,
          })
        );
        const [sourceMessage] = yield* db
          .select({ senderJson: message.senderJson })
          .from(message)
          .where(eq(message.id, source.delivery.messageId));
        const sourceState = failure(
          yield* Effect.result(
            resendOutbound(
              Schema.decodeUnknownSync(ResendOutboundInput)({
                ...explicitConfirmation,
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
          ...explicitConfirmation,
          mailboxId,
          outboundDeliveryId: source.delivery.id,
          expectedVersion: 1,
          operationId: "resend-op",
          acknowledgeDuplicateRisk: true,
        });
        const resent = yield* resendOutbound(resendInput);
        const replay = yield* resendOutbound(resendInput);
        const launderedResend = failure(
          yield* Effect.result(
            resendOutbound({
              ...resendInput,
              confirmation: "ai-tool-execution",
            })
          )
        );
        const [resentMessage] = yield* db
          .select({ senderJson: message.senderJson })
          .from(message)
          .where(eq(message.id, resent.delivery.messageId));
        expect({
          invalid: invalid.reason,
          tooManyRecipients: tooManyRecipients.reason,
          sourceState,
          resent,
          replay,
          launderedResend,
          resentMessage,
          sourceMessage,
        }).toMatchObject({
          invalid: "validation",
          tooManyRecipients: "validation",
          sourceState: { reason: "invalid-state" },
          resent: {
            sourceDeliveryId: source.delivery.id,
            delivery: {
              status: "scheduled",
              resendOf: source.delivery.id,
              sendAt: 1000,
            },
          },
          replay: { delivery: { id: resent.delivery.id } },
          launderedResend: {
            operation: "resend-outbound",
            reason: "validation",
          },
          resentMessage: {
            senderJson:
              '{"address":"sender@example.com","displayName":"Sender"}',
          },
          sourceMessage: {
            senderJson:
              '{"address":"sender@example.com","displayName":"Sender"}',
          },
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
              ...explicitConfirmation,
              mailboxId,
              draftId: created.id,
              expectedVersion: 1,
              operationId: "rollback-schedule",
              sender,
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
