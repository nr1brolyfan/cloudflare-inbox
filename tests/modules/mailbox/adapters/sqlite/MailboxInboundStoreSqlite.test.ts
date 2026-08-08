import { asc, count, eq } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import { MailboxDoHandler } from "#/modules/mailbox/adapters/durable-object/MailboxDoHandler";
import { MailboxContactStore } from "#/modules/mailbox/adapters/sqlite/MailboxContactStoreSqlite";
import { MailboxInboundStore } from "#/modules/mailbox/adapters/sqlite/MailboxInboundStoreSqlite";
import { MailboxMessageStore } from "#/modules/mailbox/adapters/sqlite/MailboxMessageStoreSqlite";
import { MailboxDatabase } from "#/modules/mailbox/adapters/sqlite/MailboxSqliteDatabase";
import { MailboxRuntime } from "#/modules/mailbox/adapters/sqlite/MailboxSqliteRuntime";
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
} from "#/modules/mailbox/adapters/sqlite/MailboxSqliteSchema";
import {
  AttachmentId,
  MailboxId,
  MessageId,
} from "#/modules/mailbox/domain/Mailbox";
import { SearchContactsInput } from "#/modules/mailbox/domain/MailboxContact";
import { MailboxDomainError } from "#/modules/mailbox/domain/MailboxError";
import {
  CommitInboundMessageV1,
  CommitInboundMessageV2,
  RecordInboundProcessing,
  RecordInboundProcessingV1,
  ReplayInboundInput,
} from "#/modules/mailbox/domain/MailboxInbound";
import { MailboxIdentity } from "#/modules/mailbox/ports/MailboxIdentity";

import {
  MailboxDatabaseTestLayer,
  MailboxDoHandlerTestLayer,
  MailboxStoresTestLayer,
} from "../../../../support/mailbox-sqlite";

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
  MailboxStoresTestLayer.pipe(
    Layer.provide(
      Layer.merge(
        Layer.succeed(MailboxIdentity, MailboxIdentity.of({ mailboxId })),
        Layer.succeed(MailboxRuntime, MailboxRuntime.of(runtime))
      )
    ),
    Layer.provideMerge(MailboxDatabaseTestLayer)
  );

const handlerTestLive = (runtime: ReturnType<typeof makeRuntime>["service"]) =>
  MailboxDoHandlerTestLayer.pipe(
    Layer.provide(
      Layer.merge(
        Layer.succeed(MailboxIdentity, MailboxIdentity.of({ mailboxId })),
        Layer.succeed(MailboxRuntime, MailboxRuntime.of(runtime))
      )
    ),
    Layer.provideMerge(MailboxDatabaseTestLayer)
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
    replyTo: [{ address: "reply@example.test", displayName: "Reply Address" }],
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

const initializeRuleFixtures = MailboxDatabase.pipe(
  Effect.flatMap((db) =>
    Effect.gen(function* () {
      yield* db.insert(folder).values({
        createdAt: 0,
        id: "archive",
        kind: "archive",
        name: "Archive",
        updatedAt: 0,
      });
      yield* db.insert(label).values({
        createdAt: 0,
        id: "important",
        name: "Important",
        updatedAt: 0,
      });
      yield* db.insert(filterRule).values([
        {
          id: "rule-organize",
          name: "Organize hello",
          enabled: 1,
          priority: 10,
          conditionsJson: JSON.stringify({
            match: "all",
            items: [
              {
                _tag: "Text",
                field: "subject",
                operator: "contains",
                value: "hello",
              },
            ],
          }),
          actionsJson: JSON.stringify([
            { _tag: "MoveToFolder", folderId: "archive" },
            { _tag: "AddLabel", labelId: "important" },
            { _tag: "SetRead", read: true },
          ]),
          stopProcessing: 0,
          createdAt: 0,
          updatedAt: 0,
        },
        {
          id: "rule-stop",
          name: "Star attachments",
          enabled: 1,
          priority: 20,
          conditionsJson: JSON.stringify({
            match: "all",
            items: [{ _tag: "HasAttachment", value: true }],
          }),
          actionsJson: JSON.stringify([
            { _tag: "AddLabel", labelId: "important" },
            { _tag: "AddLabel", labelId: "missing" },
            { _tag: "SetStarred", starred: true },
          ]),
          stopProcessing: 1,
          createdAt: 0,
          updatedAt: 0,
        },
        {
          id: "rule-after-stop",
          name: "Must not run",
          enabled: 1,
          priority: 30,
          conditionsJson: JSON.stringify({
            match: "all",
            items: [{ _tag: "HasAttachment", value: true }],
          }),
          actionsJson: JSON.stringify([{ _tag: "SetRead", read: false }]),
          stopProcessing: 0,
          createdAt: 0,
          updatedAt: 0,
        },
        {
          id: "rule-ai",
          name: "Classify escalation",
          enabled: 1,
          priority: 15,
          conditionsJson: JSON.stringify({
            match: "all",
            items: [
              {
                _tag: "Text",
                field: "subject",
                operator: "contains",
                value: "hello",
              },
            ],
          }),
          actionsJson: JSON.stringify([
            { _tag: "AddLabel", labelId: "important" },
          ]),
          aiInstruction: "Decide whether this is an urgent escalation",
          stopProcessing: 0,
          createdAt: 0,
          updatedAt: 0,
        },
      ]);
    })
  )
);

const commit = (input = commitInput) =>
  MailboxInboundStore.pipe(Effect.flatMap((store) => store.commit(input)));

const processingRecord = (
  value:
    | {
        readonly _tag: "Checkpoint";
        readonly status: "raw_stored" | "parsing" | "attachments_stored";
      }
    | {
        readonly _tag: "Failure";
        readonly message?: (typeof commitInput)["message"];
        readonly failure: {
          readonly code: "processing_failed";
          readonly replayable: boolean;
        };
      }
) =>
  Schema.decodeUnknownSync(RecordInboundProcessingV1)({
    ...value,
    envelope: commitInput.envelope,
    formatVersion: 1,
    inboundIngestId: commitInput.inboundIngestId,
    mailboxId,
    receivedAt: commitInput.receivedAt,
  });

const record = (input: ReturnType<typeof processingRecord>) =>
  MailboxInboundStore.pipe(Effect.flatMap((store) => store.record(input)));

const prepareReplay = () =>
  MailboxInboundStore.pipe(
    Effect.flatMap((store) =>
      store.prepareReplay(
        Schema.decodeUnknownSync(ReplayInboundInput)({
          inboundIngestId: commitInput.inboundIngestId,
          mailboxId,
          operationId: "replay-operation-1",
        })
      )
    )
  );

describe("MailboxDO SQLite inbound commit", () => {
  it("indexes safe inbound correspondents but hides other participants", async () => {
    const runtime = makeRuntime();
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* initializeInbox;
          yield* commit(
            Schema.decodeUnknownSync(CommitInboundMessageV1)({
              ...Schema.encodeSync(CommitInboundMessageV1)(commitInput),
              message: {
                ...Schema.encodeSync(CommitInboundMessageV1)(commitInput)
                  .message,
                cc: [{ address: "participant@example.test" }],
              },
            })
          );
          const contacts = yield* MailboxContactStore;
          const search = (query: string) =>
            contacts.searchContacts(
              Schema.decodeUnknownSync(SearchContactsInput)({
                limit: 12,
                mailboxId,
                query,
              })
            );
          const sender = yield* search("send");
          const reply = yield* search("repl");
          const participant = yield* search("part");
          const participantAfterEnable = yield* contacts.searchContacts(
            Schema.decodeUnknownSync(SearchContactsInput)({
              allParticipantsEnabledAt: 2000,
              limit: 12,
              mailboxId,
              query: "part",
            })
          );
          const participantBeforeEnable = yield* contacts.searchContacts(
            Schema.decodeUnknownSync(SearchContactsInput)({
              allParticipantsEnabledAt: 2001,
              limit: 12,
              mailboxId,
              query: "part",
            })
          );
          return {
            participant,
            participantAfterEnable,
            participantBeforeEnable,
            reply,
            sender,
          };
        }).pipe(Effect.provide(testLive(runtime.service)))
      )
    );

    expect(result.sender.contacts.map(({ address }) => address)).toStrictEqual([
      "sender@example.test",
    ]);
    expect(result.reply.contacts[0]).toMatchObject({
      address: "reply@example.test",
      displayName: "Reply Address",
    });
    expect(result.participant.contacts).toStrictEqual([]);
    expect(result.participantAfterEnable.contacts).toMatchObject([
      { address: "participant@example.test" },
    ]);
    expect(result.participantBeforeEnable.contacts).toStrictEqual([]);
  });

  it("replays a failed ingest with an attempt fence and stable Workflow ID", async () => {
    const runtime = makeRuntime();
    const outcome = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* initializeInbox;
          yield* record(
            processingRecord({ _tag: "Checkpoint", status: "raw_stored" })
          );
          yield* record(
            processingRecord({
              _tag: "Failure",
              failure: { code: "processing_failed", replayable: true },
            })
          );
          const prepared = yield* prepareReplay();
          const replayed = yield* prepareReplay();
          const stale = yield* Effect.result(
            record(processingRecord({ _tag: "Checkpoint", status: "parsing" }))
          );
          const store = yield* MailboxInboundStore;
          for (const status of [
            "raw_stored",
            "parsing",
            "attachments_stored",
          ] as const) {
            yield* store.record(
              Schema.decodeUnknownSync(RecordInboundProcessing)({
                _tag: "Checkpoint",
                envelope: commitInput.envelope,
                executionAttempt: 2,
                formatVersion: 2,
                inboundIngestId: commitInput.inboundIngestId,
                mailboxId,
                receivedAt: commitInput.receivedAt,
                status,
              })
            );
          }
          const ready = yield* store.commit(
            Schema.decodeUnknownSync(CommitInboundMessageV2)({
              ...Schema.encodeSync(CommitInboundMessageV1)(commitInput),
              executionAttempt: 2,
              formatVersion: 2,
            })
          );
          return { prepared, ready, replayed, stale };
        }).pipe(Effect.provide(testLive(runtime.service)))
      )
    );

    expect({
      prepared: outcome.prepared,
      ready: outcome.ready,
      replayed: outcome.replayed,
      staleFailure: Result.isFailure(outcome.stale)
        ? outcome.stale.failure
        : undefined,
    }).toMatchObject({
      prepared: {
        processing: { attemptCount: 2, status: "received", version: 3 },
        workflow: {
          executionAttempt: 2,
          inboundIngestId: "ingest-1",
          workflowInstanceId: "generated-1",
        },
      },
      ready: { attemptCount: 2, messageId: "generated-3", status: "ready" },
      replayed: {
        workflow: { workflowInstanceId: "generated-1" },
      },
      staleFailure: {
        operation: "record-inbound",
        reason: "invalid-state",
      },
    });
  });

  it("rolls back replay state when its operation ledger cannot persist", async () => {
    const runtime = makeRuntime();
    const outcome = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* initializeInbox;
          yield* record(
            processingRecord({ _tag: "Checkpoint", status: "raw_stored" })
          );
          yield* record(
            processingRecord({
              _tag: "Failure",
              failure: { code: "processing_failed", replayable: true },
            })
          );
          const db = yield* MailboxDatabase;
          yield* db.$client.unsafe(
            "CREATE TRIGGER reject_replay_operation BEFORE INSERT ON mailbox_operation BEGIN SELECT RAISE(ABORT, 'forced failure'); END"
          );
          const result = yield* Effect.result(prepareReplay());
          const [row] = yield* db
            .select()
            .from(inboundProcessing)
            .where(eq(inboundProcessing.id, "ingest-1"));
          return { failed: Result.isFailure(result), row };
        }).pipe(Effect.provide(testLive(runtime.service)))
      )
    );

    expect(outcome).toMatchObject({
      failed: true,
      row: {
        attemptCount: 1,
        failureCode: "processing_failed",
        failureReplayable: 1,
        status: "failed",
        version: 2,
      },
    });
  });

  it("records monotonic checkpoints before the atomic ready commit", async () => {
    const runtime = makeRuntime();
    const outcome = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* initializeInbox;
          const rawStored = yield* record(
            processingRecord({ _tag: "Checkpoint", status: "raw_stored" })
          );
          const replay = yield* record(
            processingRecord({ _tag: "Checkpoint", status: "raw_stored" })
          );
          const parsing = yield* record(
            processingRecord({ _tag: "Checkpoint", status: "parsing" })
          );
          const attachmentsStored = yield* record(
            processingRecord({
              _tag: "Checkpoint",
              status: "attachments_stored",
            })
          );
          const ready = yield* commit();
          return { attachmentsStored, parsing, rawStored, ready, replay };
        }).pipe(Effect.provide(testLive(runtime.service)))
      )
    );

    expect(outcome).toMatchObject({
      attachmentsStored: { status: "attachments_stored", version: 3 },
      parsing: { status: "parsing", version: 2 },
      rawStored: { status: "raw_stored", version: 1 },
      ready: { messageId: "generated-2", status: "ready", version: 4 },
      replay: { status: "raw_stored", version: 1 },
    });
  });

  it("keeps terminal failure sticky and rejects an ordinary commit", async () => {
    const runtime = makeRuntime();
    const outcome = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* initializeInbox;
          yield* record(
            processingRecord({ _tag: "Checkpoint", status: "raw_stored" })
          );
          const failed = yield* record(
            processingRecord({
              _tag: "Failure",
              failure: { code: "processing_failed", replayable: true },
            })
          );
          const stale = yield* record(
            processingRecord({ _tag: "Checkpoint", status: "parsing" })
          );
          const commitResult = yield* Effect.result(commit());
          return { commitResult, failed, stale };
        }).pipe(Effect.provide(testLive(runtime.service)))
      )
    );

    expect({
      commitFailure: Result.isFailure(outcome.commitResult)
        ? outcome.commitResult.failure
        : undefined,
      failed: outcome.failed,
      stale: outcome.stale,
    }).toMatchObject({
      commitFailure: {
        operation: "commit-inbound",
        reason: "invalid-state",
      },
      failed: {
        failure: { code: "processing_failed", replayable: true },
        status: "failed",
        version: 2,
      },
      stale: { status: "failed", version: 2 },
    });
  });

  it("returns ready when a late failure follows an acknowledged-lost commit", async () => {
    const runtime = makeRuntime();
    const outcome = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* initializeInbox;
          const ready = yield* commit();
          const lateFailure = yield* record(
            processingRecord({
              _tag: "Failure",
              failure: { code: "processing_failed", replayable: true },
              message: commitInput.message,
            })
          );
          const conflict = yield* Effect.result(
            record(
              processingRecord({
                _tag: "Failure",
                failure: { code: "processing_failed", replayable: true },
                message: Schema.decodeUnknownSync(CommitInboundMessageV1)({
                  ...Schema.encodeSync(CommitInboundMessageV1)(commitInput),
                  message: {
                    ...Schema.encodeSync(CommitInboundMessageV1)(commitInput)
                      .message,
                    subject: "Changed",
                  },
                }).message,
              })
            )
          );
          return { conflict, lateFailure, ready };
        }).pipe(Effect.provide(testLive(runtime.service)))
      )
    );

    expect(outcome).toMatchObject({
      conflict: {
        failure: {
          operation: "record-inbound",
          reason: "idempotency-conflict",
        },
      },
      lateFailure: {
        messageId: "generated-2",
        status: "ready",
        version: 1,
      },
      ready: { messageId: "generated-2", status: "ready", version: 1 },
    });
  });

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
          const attachmentId = detail.attachments[0]?.id;
          if (attachmentId === undefined) {
            return yield* Effect.die("Expected committed attachment ID");
          }
          const blob = yield* store.getAttachmentBlob({
            attachmentId,
            mailboxId,
            messageId: first.messageId,
          });
          const [
            [messageCount],
            [attachmentCount],
            [processingCount],
            [evaluationCount],
            [applicationCount],
          ] = yield* Effect.all([
            db.select({ value: count() }).from(message),
            db.select({ value: count() }).from(attachment),
            db.select({ value: count() }).from(inboundProcessing),
            db.select({ value: count() }).from(ruleEvaluation),
            db.select({ value: count() }).from(ruleApplication),
          ]);
          return {
            applicationCount: applicationCount?.value,
            attachmentCount: attachmentCount?.value,
            callsAfterFirst,
            blob,
            detail,
            evaluationCount: evaluationCount?.value,
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
      applicationCount: 0,
      attachmentCount: 1,
      callsAfterFirst: 3,
      blob: {
        attachmentId: "generated-3",
        contentId: "image-1",
        disposition: "inline",
        fileName: "image.png",
        folderId: "inbox",
        inboundIngestId: "ingest-1",
        mailboxId: "mailbox-a",
        messageId: "generated-2",
        mimeType: "image/png",
        receivedAt: 2000,
        size: 3,
        sourceIndex: 0,
      },
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
        replyTo: [
          { address: "reply@example.test", displayName: "Reply Address" },
        ],
        size: 123,
        snippet: "Hello from inbound",
        threadId: "generated-1",
      },
      evaluationCount: 1,
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

  it("exposes only committed ready ordinary inbound attachment metadata", async () => {
    const runtime = makeRuntime();
    const ordinary = Schema.decodeUnknownSync(CommitInboundMessageV1)({
      ...Schema.encodeSync(CommitInboundMessageV1)(commitInput),
      message: {
        ...Schema.encodeSync(CommitInboundMessageV1)(commitInput).message,
        attachments: [
          {
            disposition: "attachment",
            fileName: "brief.pdf",
            index: 0,
            mimeType: "application/pdf",
            size: 4,
          },
        ],
      },
    });
    const outcome = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* initializeInbox;
          const ready = yield* commit(ordinary);
          if (ready.messageId === undefined) {
            return yield* Effect.die("Expected committed message ID");
          }
          const store = yield* MailboxMessageStore;
          const detail = yield* store.getMessage({
            mailboxId,
            messageId: ready.messageId,
          });
          const attachmentId = detail.attachments[0]?.id;
          if (attachmentId === undefined) {
            return yield* Effect.die("Expected committed attachment ID");
          }
          const ordinaryBlob = yield* store.getInboundAttachmentBlob({
            attachmentId,
            mailboxId,
            messageId: ready.messageId,
          });
          const inlineBlob = yield* Effect.result(
            store.getAttachmentBlob({
              attachmentId,
              mailboxId,
              messageId: ready.messageId,
            })
          );
          return { inlineBlob, ordinaryBlob, ready };
        }).pipe(Effect.provide(testLive(runtime.service)))
      )
    );

    expect(outcome).toMatchObject({
      inlineBlob: {
        failure: { operation: "get-attachment", reason: "not-found" },
      },
      ordinaryBlob: {
        disposition: "attachment",
        fileName: "brief.pdf",
        mailboxId: "mailbox-a",
        mimeType: "application/pdf",
        size: 4,
        sourceIndex: 0,
      },
      ready: { status: "ready" },
    });
  });

  it("cannot locate pre-ready, failed, deleted, outbound, or uncommitted attachments", async () => {
    const runtime = makeRuntime();
    const ids = [
      "pre-ready",
      "failed",
      "deleted-message",
      "deleted-attachment",
      "outbound",
      "uncommitted",
    ] as const;
    const failures = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* initializeInbox;
          const db = yield* MailboxDatabase;
          yield* db.insert(message).values(
            ids.map((id) => ({
              deletedAt: id === "deleted-message" ? 2000 : null,
              direction: (id === "outbound" ? "outbound" : "inbound") as
                | "inbound"
                | "outbound",
              folderId: "inbox",
              id: `message-${id}`,
              receivedAt: 1000,
            }))
          );
          yield* db.insert(inboundProcessing).values([
            {
              createdAt: 1000,
              id: "ingest-pre-ready",
              requestKey: "request-pre-ready",
              status: "attachments_stored",
              updatedAt: 1000,
            },
            {
              createdAt: 1000,
              failureAt: 1000,
              failureCode: "processing_failed",
              failureReplayable: 1,
              id: "ingest-failed",
              requestKey: "request-failed",
              status: "failed",
              updatedAt: 1000,
            },
            ...["deleted-message", "deleted-attachment", "outbound"].map(
              (id) => ({
                createdAt: 1000,
                id: `ingest-${id}`,
                messageId: `message-${id}`,
                requestKey: `request-${id}`,
                status: "ready" as const,
                updatedAt: 1000,
              })
            ),
          ]);
          yield* db.insert(attachment).values(
            ids.map((id) => ({
              deletedAt: id === "deleted-attachment" ? 2000 : null,
              disposition: "attachment" as const,
              fileName: `${id}.bin`,
              id: `attachment-${id}`,
              inboundIngestId: id === "uncommitted" ? null : `ingest-${id}`,
              messageId: `message-${id}`,
              mimeType: "application/octet-stream",
              size: 1,
              sourceIndex: id === "uncommitted" ? null : 0,
            }))
          );
          const store = yield* MailboxMessageStore;
          return yield* Effect.all(
            ids.map((id) =>
              store
                .getInboundAttachmentBlob({
                  attachmentId: Schema.decodeUnknownSync(AttachmentId)(
                    `attachment-${id}`
                  ),
                  mailboxId,
                  messageId: Schema.decodeUnknownSync(MessageId)(
                    `message-${id}`
                  ),
                })
                .pipe(Effect.result)
            )
          );
        }).pipe(Effect.provide(testLive(runtime.service)))
      )
    );

    expect(failures).toHaveLength(ids.length);
    expect(
      failures.every(
        (result) =>
          Result.isFailure(result) &&
          result.failure instanceof MailboxDomainError &&
          result.failure.reason === "not-found" &&
          result.failure.operation === "get-attachment"
      )
    ).toBeTruthy();
  });

  it("atomically applies deterministic rules and records idempotent history", async () => {
    const runtime = makeRuntime();
    const outcome = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* initializeInbox;
          yield* initializeRuleFixtures;
          const first = yield* commit();
          const replay = yield* commit();
          const db = yield* MailboxDatabase;
          if (first.messageId === undefined) {
            return yield* Effect.die("Expected committed message ID");
          }
          const [messageRow] = yield* db
            .select({
              folderId: message.folderId,
              read: message.read,
              starred: message.starred,
              version: message.version,
            })
            .from(message)
            .where(eq(message.id, first.messageId));
          const labels = yield* db
            .select({ labelId: messageLabel.labelId })
            .from(messageLabel)
            .where(eq(messageLabel.messageId, first.messageId));
          const evaluations = yield* db.select().from(ruleEvaluation);
          const jobs = yield* db.select().from(asyncRuleJob);
          const applications = yield* db
            .select({
              actionIndex: ruleApplication.actionIndex,
              actionJson: ruleApplication.actionJson,
              outcome: ruleApplication.outcome,
              ruleId: ruleApplication.ruleId,
              ruleVersion: ruleApplication.ruleVersion,
            })
            .from(ruleApplication)
            .orderBy(
              asc(ruleApplication.ruleId),
              asc(ruleApplication.actionIndex)
            );
          return {
            applications: applications.map(
              ({ actionJson, ...application }) => ({
                ...application,
                action: JSON.parse(actionJson),
              })
            ),
            evaluations,
            first,
            jobs: jobs.map(({ planJson, ...job }) => ({
              ...job,
              plan: JSON.parse(planJson),
            })),
            labels,
            messageRow,
            replay,
          };
        }).pipe(Effect.provide(testLive(runtime.service)))
      )
    );

    expect(outcome).toMatchObject({
      applications: [
        {
          ruleId: "rule-organize",
          ruleVersion: 1,
          actionIndex: 0,
          action: { _tag: "MoveToFolder", folderId: "archive" },
          outcome: "applied",
        },
        {
          ruleId: "rule-organize",
          actionIndex: 1,
          action: { _tag: "AddLabel", labelId: "important" },
          outcome: "applied",
        },
        {
          ruleId: "rule-organize",
          actionIndex: 2,
          action: { _tag: "SetRead", read: true },
          outcome: "applied",
        },
        {
          ruleId: "rule-stop",
          actionIndex: 0,
          action: { _tag: "AddLabel", labelId: "important" },
          outcome: "noop",
        },
        {
          ruleId: "rule-stop",
          actionIndex: 1,
          action: { _tag: "AddLabel", labelId: "missing" },
          outcome: "skipped_invalid_target",
        },
        {
          ruleId: "rule-stop",
          actionIndex: 2,
          action: { _tag: "SetStarred", starred: true },
          outcome: "applied",
        },
      ],
      evaluations: [
        {
          engineVersion: 1,
          inboundIngestId: "ingest-1",
          messageId: "generated-2",
          stoppedByRuleId: "rule-stop",
        },
      ],
      first: { messageId: "generated-2", status: "ready" },
      jobs: [
        {
          id: "ingest-1",
          inboundIngestId: "ingest-1",
          messageId: "generated-2",
          status: "pending",
          version: 1,
          plan: {
            formatVersion: 1,
            baseMessageVersion: 1,
            candidates: [
              {
                ruleId: "rule-ai",
                ruleVersion: 1,
                instruction: "Decide whether this is an urgent escalation",
                actions: [{ _tag: "AddLabel", labelId: "important" }],
              },
            ],
          },
        },
      ],
      labels: [{ labelId: "important" }],
      messageRow: { folderId: "archive", read: 1, starred: 1, version: 1 },
      replay: { messageId: "generated-2", status: "ready" },
    });
  });

  it("rolls back the inbound commit when rule history cannot persist", async () => {
    const runtime = makeRuntime();
    const outcome = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* initializeInbox;
          yield* initializeRuleFixtures;
          const db = yield* MailboxDatabase;
          yield* db.$client.unsafe(
            "CREATE TRIGGER reject_rule_history BEFORE INSERT ON rule_application BEGIN SELECT RAISE(ABORT, 'forced failure'); END"
          );
          const result = yield* Effect.result(commit());
          const [
            [messageCount],
            [processingCount],
            [labelCount],
            [evaluationCount],
            [applicationCount],
            [jobCount],
          ] = yield* Effect.all([
            db.select({ value: count() }).from(message),
            db.select({ value: count() }).from(inboundProcessing),
            db.select({ value: count() }).from(messageLabel),
            db.select({ value: count() }).from(ruleEvaluation),
            db.select({ value: count() }).from(ruleApplication),
            db.select({ value: count() }).from(asyncRuleJob),
          ]);
          return {
            applicationCount: applicationCount?.value,
            evaluationCount: evaluationCount?.value,
            failed: Result.isFailure(result),
            jobCount: jobCount?.value,
            labelCount: labelCount?.value,
            messageCount: messageCount?.value,
            processingCount: processingCount?.value,
          };
        }).pipe(Effect.provide(testLive(runtime.service)))
      )
    );

    expect(outcome).toStrictEqual({
      applicationCount: 0,
      evaluationCount: 0,
      failed: true,
      jobCount: 0,
      labelCount: 0,
      messageCount: 0,
      processingCount: 0,
    });
  });

  it("rolls back ready state when an async rule job cannot persist", async () => {
    const runtime = makeRuntime();
    const outcome = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* initializeInbox;
          yield* initializeRuleFixtures;
          const db = yield* MailboxDatabase;
          yield* db.$client.unsafe(
            "CREATE TRIGGER reject_async_rule_job BEFORE INSERT ON async_rule_job BEGIN SELECT RAISE(ABORT, 'forced failure'); END"
          );
          const result = yield* Effect.result(commit());
          const [[messageCount], [processingCount], [jobCount]] =
            yield* Effect.all([
              db.select({ value: count() }).from(message),
              db.select({ value: count() }).from(inboundProcessing),
              db.select({ value: count() }).from(asyncRuleJob),
            ]);
          return {
            failed: Result.isFailure(result),
            jobCount: jobCount?.value,
            messageCount: messageCount?.value,
            processingCount: processingCount?.value,
          };
        }).pipe(Effect.provide(testLive(runtime.service)))
      )
    );

    expect(outcome).toStrictEqual({
      failed: true,
      jobCount: 0,
      messageCount: 0,
      processingCount: 0,
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

  it("rejects the same ingest ID when only Reply-To changes", async () => {
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
                  replyTo: [{ address: "changed@example.test" }],
                },
              })
            )
          );
        }).pipe(Effect.provide(testLive(runtime.service)))
      )
    );

    expect(Result.isFailure(result) ? result.failure : undefined).toMatchObject(
      {
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
          const found = yield* handler.executeMailData({
            _tag: "GetMessage",
            input: { mailboxId, messageId: "generated-2" },
          });
          const thread = yield* handler.executeMailData({
            _tag: "GetThread",
            input: { mailboxId, threadId: "generated-1" },
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
          return { committed, conflict, found, thread };
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
      found: {
        _tag: "MessageFound",
        value: {
          replyTo: [
            { address: "reply@example.test", displayName: "Reply Address" },
          ],
        },
      },
      thread: {
        _tag: "ThreadFound",
        value: {
          messages: [
            {
              replyTo: [
                {
                  address: "reply@example.test",
                  displayName: "Reply Address",
                },
              ],
            },
          ],
        },
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
