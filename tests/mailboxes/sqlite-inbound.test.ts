import { count, eq } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import { MailboxId } from "#/mailboxes/core";
import { MailboxDoHandler } from "#/mailboxes/do-handler";
import { CommitInboundMessageV1 } from "#/mailboxes/inbound";
import {
  attachment,
  folder,
  inboundProcessing,
  message,
} from "#/mailboxes/sqlite-schema";
import {
  MailboxDatabase,
  MailboxIdentity,
  MailboxInboundStore,
  MailboxMessageStore,
  MailboxRuntime,
} from "#/mailboxes/sqlite-services";

import {
  MailboxDatabaseTestLive,
  MailboxDoHandlerTestLive,
  MailboxStoresTestLive,
} from "../support/mailbox-sqlite";

const mailboxId = Schema.decodeUnknownSync(MailboxId)("mailbox-a");

const makeRuntime = () => {
  let next = 0;
  return {
    calls: () => next,
    service: {
      now: () => 3000,
      randomId: () => `generated-${(next += 1)}`,
    },
  };
};

const testLive = (runtime: ReturnType<typeof makeRuntime>["service"]) =>
  MailboxStoresTestLive.pipe(
    Layer.provide(
      Layer.merge(
        Layer.succeed(MailboxIdentity, MailboxIdentity.of({ mailboxId })),
        Layer.succeed(MailboxRuntime, MailboxRuntime.of(runtime))
      )
    ),
    Layer.provideMerge(MailboxDatabaseTestLive)
  );

const handlerTestLive = (runtime: ReturnType<typeof makeRuntime>["service"]) =>
  MailboxDoHandlerTestLive.pipe(
    Layer.provide(
      Layer.merge(
        Layer.succeed(MailboxIdentity, MailboxIdentity.of({ mailboxId })),
        Layer.succeed(MailboxRuntime, MailboxRuntime.of(runtime))
      )
    ),
    Layer.provideMerge(MailboxDatabaseTestLive)
  );

const commitInput = Schema.decodeUnknownSync(CommitInboundMessageV1)({
  envelope: {
    envelopeFrom: "sender@example.test",
    envelopeTo: "owner@example.test",
    rawSize: 123,
  },
  formatVersion: 1,
  inboundIngestId: "ingest-1",
  mailboxId,
  message: {
    attachments: [
      {
        contentId: "image-1",
        disposition: "inline",
        fileName: "image.png",
        index: 0,
        mimeType: "image/png",
        size: 3,
      },
    ],
    bcc: [],
    cc: [],
    formatVersion: 1,
    references: [],
    rfcMessageId: "message@example.test",
    sender: { address: "sender@example.test", name: "Sender" },
    subject: "Hello",
    textBody: "Hello   from inbound",
    to: [{ address: "owner@example.test" }],
  },
  receivedAt: 2000,
});

const initializeInbox = MailboxDatabase.pipe(
  Effect.flatMap((db) =>
    db.insert(folder).values({
      createdAt: 0,
      id: "inbox",
      kind: "inbox",
      name: "Inbox",
      updatedAt: 0,
    })
  )
);

const commit = (input = commitInput) =>
  MailboxInboundStore.pipe(Effect.flatMap((store) => store.commit(input)));

describe("MailboxDO SQLite inbound commit", () => {
  it("atomically creates a ready message and replays the exact commit", async () => {
    const runtime = makeRuntime();
    const outcome = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* initializeInbox;
          const first = yield* commit();
          const callsAfterFirst = runtime.calls();
          const replay = yield* commit();
          const db = yield* MailboxDatabase;
          const store = yield* MailboxMessageStore;
          if (first.messageId === undefined) {
            return yield* Effect.die("Expected committed message ID");
          }
          const detail = yield* store.getMessage({
            mailboxId,
            messageId: first.messageId,
          });
          const [[messageCount], [attachmentCount], [processingCount]] =
            yield* Effect.all([
              db.select({ value: count() }).from(message),
              db.select({ value: count() }).from(attachment),
              db.select({ value: count() }).from(inboundProcessing),
            ]);
          return {
            attachmentCount: attachmentCount?.value,
            callsAfterFirst,
            detail,
            first,
            messageCount: messageCount?.value,
            processingCount: processingCount?.value,
            replay,
            totalCalls: runtime.calls(),
          };
        }).pipe(Effect.provide(testLive(runtime.service)))
      )
    );

    expect(outcome).toMatchObject({
      attachmentCount: 1,
      callsAfterFirst: 3,
      detail: {
        attachments: [
          {
            contentId: "image-1",
            fileName: "image.png",
            id: "generated-3",
          },
        ],
        direction: "inbound",
        folderId: "inbox",
        id: "generated-2",
        read: false,
        size: 123,
        snippet: "Hello from inbound",
        threadId: "generated-1",
      },
      first: {
        id: "ingest-1",
        messageId: "generated-2",
        status: "ready",
      },
      messageCount: 1,
      processingCount: 1,
      replay: {
        id: "ingest-1",
        messageId: "generated-2",
        status: "ready",
      },
      totalCalls: 3,
    });
  });

  it("rejects the same ingest ID with a changed canonical payload", async () => {
    const runtime = makeRuntime();
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* initializeInbox;
          yield* commit();
          return yield* Effect.result(
            commit(
              Schema.decodeUnknownSync(CommitInboundMessageV1)({
                ...Schema.encodeSync(CommitInboundMessageV1)(commitInput),
                message: {
                  ...Schema.encodeSync(CommitInboundMessageV1)(commitInput)
                    .message,
                  subject: "Changed",
                },
              })
            )
          );
        }).pipe(Effect.provide(testLive(runtime.service)))
      )
    );

    expect(Result.isFailure(result) ? result.failure : undefined).toMatchObject(
      {
        _tag: "MailboxDomainError",
        operation: "commit-inbound",
        reason: "idempotency-conflict",
        resourceId: "ingest-1",
      }
    );
  });

  it("round-trips commit and domain conflicts through the DO protocol", async () => {
    const runtime = makeRuntime();
    const outcome = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* initializeInbox;
          const handler = yield* MailboxDoHandler;
          const committed = yield* handler.executeMailData({
            _tag: "CommitInbound",
            input: commitInput,
          });
          const conflict = yield* handler.executeMailData({
            _tag: "CommitInbound",
            input: {
              ...Schema.encodeSync(CommitInboundMessageV1)(commitInput),
              message: {
                ...Schema.encodeSync(CommitInboundMessageV1)(commitInput)
                  .message,
                subject: "Changed",
              },
            },
          });
          return { committed, conflict };
        }).pipe(Effect.provide(handlerTestLive(runtime.service)))
      )
    );

    expect(outcome).toMatchObject({
      committed: {
        _tag: "InboundCommitted",
        value: {
          id: "ingest-1",
          messageId: "generated-2",
          status: "ready",
        },
      },
      conflict: {
        _tag: "DomainError",
        operation: "commit-inbound",
        reason: "idempotency-conflict",
        resourceId: "ingest-1",
      },
    });
  });

  it("keeps different ingests with the same RFC Message-ID", async () => {
    const runtime = makeRuntime();
    const outcome = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* initializeInbox;
          const first = yield* commit();
          const second = yield* commit(
            Schema.decodeUnknownSync(CommitInboundMessageV1)({
              ...Schema.encodeSync(CommitInboundMessageV1)(commitInput),
              inboundIngestId: "ingest-2",
            })
          );
          const db = yield* MailboxDatabase;
          const rows = yield* db
            .select({ id: message.id, rfcMessageId: message.rfcMessageId })
            .from(message)
            .where(eq(message.rfcMessageId, "message@example.test"));
          return { first, rows, second };
        }).pipe(Effect.provide(testLive(runtime.service)))
      )
    );

    expect(outcome).toMatchObject({
      first: { messageId: "generated-2" },
      rows: [
        { id: "generated-2", rfcMessageId: "message@example.test" },
        { id: "generated-5", rfcMessageId: "message@example.test" },
      ],
      second: { messageId: "generated-5" },
    });
  });

  it("threads a reply through its direct RFC parent", async () => {
    const runtime = makeRuntime();
    const outcome = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* initializeInbox;
          const parent = yield* commit();
          const reply = yield* commit(
            Schema.decodeUnknownSync(CommitInboundMessageV1)({
              ...Schema.encodeSync(CommitInboundMessageV1)(commitInput),
              inboundIngestId: "ingest-2",
              message: {
                ...Schema.encodeSync(CommitInboundMessageV1)(commitInput)
                  .message,
                inReplyTo: "message@example.test",
                rfcMessageId: "reply@example.test",
              },
            })
          );
          if (parent.messageId === undefined || reply.messageId === undefined) {
            return yield* Effect.die("Expected committed message IDs");
          }
          const store = yield* MailboxMessageStore;
          const [parentDetail, replyDetail] = yield* Effect.all([
            store.getMessage({ mailboxId, messageId: parent.messageId }),
            store.getMessage({ mailboxId, messageId: reply.messageId }),
          ]);
          return { parentDetail, replyDetail };
        }).pipe(Effect.provide(testLive(runtime.service)))
      )
    );

    expect(outcome).toMatchObject({
      parentDetail: { id: "generated-2", threadId: "generated-1" },
      replyDetail: { id: "generated-4", threadId: "generated-1" },
    });
  });

  it("rolls back every SQLite row when attachment persistence fails", async () => {
    const runtime = makeRuntime();
    const outcome = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* initializeInbox;
          const db = yield* MailboxDatabase;
          yield* db.$client.unsafe(
            "CREATE TRIGGER fail_inbound_attachment BEFORE INSERT ON attachment BEGIN SELECT RAISE(ABORT, 'forced failure'); END"
          );
          const result = yield* Effect.result(commit());
          const [[messageCount], [attachmentCount], [processingCount]] =
            yield* Effect.all([
              db.select({ value: count() }).from(message),
              db.select({ value: count() }).from(attachment),
              db.select({ value: count() }).from(inboundProcessing),
            ]);
          return {
            attachmentCount: attachmentCount?.value,
            failed: Result.isFailure(result),
            messageCount: messageCount?.value,
            processingCount: processingCount?.value,
          };
        }).pipe(Effect.provide(testLive(runtime.service)))
      )
    );

    expect(outcome).toStrictEqual({
      attachmentCount: 0,
      failed: true,
      messageCount: 0,
      processingCount: 0,
    });
  });
});
