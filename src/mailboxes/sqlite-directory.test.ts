/* oxlint-disable vitest/no-standalone-expect -- Effect tests are registered through @effect/vitest. */
import { expect, layer } from "@effect/vitest";
import { count, eq } from "drizzle-orm";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import {
  MailboxDatabaseTestLive,
  MailboxStoresTestLive,
} from "../test/mailbox-sqlite";
import { MailboxId } from "./core";
import {
  CreateFolderInput,
  CreateLabelInput,
  DeleteFolderInput,
  DeleteLabelInput,
  RenameFolderInput,
  RenameLabelInput,
} from "./directory";
import type { MailboxDomainError } from "./errors";
import { MailboxResourceLookup } from "./resource-location";
import {
  attachment,
  draft,
  filterRule,
  folder,
  label,
  mailboxMetadata,
  mailboxOperation,
  message,
  messageLabel,
  outboundDelivery,
} from "./sqlite-schema";
import {
  MailboxDatabase,
  MailboxDirectoryStore,
  MailboxIdentity,
  MailboxResourceIndex,
  MailboxRuntime,
} from "./sqlite-services";
import type { MailboxRuntime as MailboxRuntimeType } from "./sqlite-services";

const mailboxId = Schema.decodeUnknownSync(MailboxId)("mailbox-a");
const initializationRuntime = MailboxRuntime.of({
  now: () => 1000,
  randomId: () => "unused",
});

const lookup = (input: unknown) =>
  Schema.decodeUnknownSync(MailboxResourceLookup)(input);

const resultSuccess = <A, E>(result: Result.Result<A, E>) => {
  if (Result.isFailure(result)) {
    throw result.failure;
  }
  return result.success;
};

const domainReason = (result: Result.Result<unknown, MailboxDomainError>) => {
  if (Result.isSuccess(result)) {
    throw new Error("Expected a failed Result");
  }
  return result.failure.reason;
};

const resetDatabase = Effect.gen(function* () {
  const db = yield* MailboxDatabase;
  yield* db.$client.unsafe("DROP TRIGGER IF EXISTS reject_mailbox_operation")
    .raw;
  yield* db.delete(messageLabel);
  yield* db.delete(outboundDelivery);
  yield* db.delete(attachment);
  yield* db.delete(message);
  yield* db.delete(draft);
  yield* db.delete(filterRule);
  yield* db.delete(label);
  yield* db.delete(mailboxOperation);
  yield* db.delete(folder);
  yield* db.delete(mailboxMetadata);
});

let activeRuntime: MailboxRuntimeType = initializationRuntime;
const runtimeProxy = MailboxRuntime.of({
  now: () => activeRuntime.now(),
  randomId: () => activeRuntime.randomId(),
});

const initialize = (runtime: MailboxRuntimeType) =>
  Effect.gen(function* () {
    activeRuntime = runtime;
    const resourceIndex = yield* MailboxResourceIndex;
    const directoryStore = yield* MailboxDirectoryStore;
    yield* resetDatabase;
    yield* resourceIndex.initialize;
    yield* directoryStore.initialize;
  });

const resolveMailboxResource = (input: MailboxResourceLookup) =>
  MailboxResourceIndex.pipe(Effect.flatMap((store) => store.resolve(input)));
const initializeMailboxRepository = () =>
  MailboxResourceIndex.pipe(Effect.flatMap((store) => store.initialize));
const initializeMailboxDirectory = MailboxDirectoryStore.pipe(
  Effect.flatMap((store) => store.initialize)
);
const listFolders = () =>
  MailboxDirectoryStore.pipe(Effect.flatMap((store) => store.listFolders()));
const createFolder = (input: CreateFolderInput) =>
  MailboxDirectoryStore.pipe(
    Effect.flatMap((store) => store.createFolder(input))
  );
const renameFolder = (input: RenameFolderInput) =>
  MailboxDirectoryStore.pipe(
    Effect.flatMap((store) => store.renameFolder(input))
  );
const deleteFolder = (input: DeleteFolderInput) =>
  MailboxDirectoryStore.pipe(
    Effect.flatMap((store) => store.deleteFolder(input))
  );
const listLabels = () =>
  MailboxDirectoryStore.pipe(Effect.flatMap((store) => store.listLabels()));
const createLabel = (input: CreateLabelInput) =>
  MailboxDirectoryStore.pipe(
    Effect.flatMap((store) => store.createLabel(input))
  );
const renameLabel = (input: RenameLabelInput) =>
  MailboxDirectoryStore.pipe(
    Effect.flatMap((store) => store.renameLabel(input))
  );
const deleteLabel = (input: DeleteLabelInput) =>
  MailboxDirectoryStore.pipe(
    Effect.flatMap((store) => store.deleteLabel(input))
  );

const MailboxSqliteTest = MailboxStoresTestLive.pipe(
  Layer.provide(
    Layer.merge(
      Layer.succeed(MailboxIdentity, MailboxIdentity.of({ mailboxId })),
      Layer.succeed(MailboxRuntime, runtimeProxy)
    )
  ),
  Layer.provideMerge(MailboxDatabaseTestLive)
);

layer(MailboxSqliteTest)("MailboxDO SQLite repository", (it) => {
  it.effect("resolves canonical ancestry for every supported resource", () =>
    Effect.gen(function* () {
      const db = yield* MailboxDatabase;
      yield* initialize(initializationRuntime);
      yield* db.insert(message).values({ id: "message-1", folderId: "inbox" });
      yield* db
        .insert(attachment)
        .values({ id: "attachment-1", messageId: "message-1" });
      yield* db.insert(draft).values({ id: "draft-1" });
      yield* db.insert(filterRule).values({ id: "rule-1" });

      expect(
        yield* resolveMailboxResource(
          lookup({ _tag: "Folder", mailboxId, folderId: "inbox" })
        )
      ).toStrictEqual({
        _tag: "Folder",
        mailboxId: "mailbox-a",
        folderId: "inbox",
      });
      expect(
        yield* resolveMailboxResource(
          lookup({ _tag: "Message", mailboxId, messageId: "message-1" })
        )
      ).toStrictEqual({
        _tag: "Message",
        mailboxId: "mailbox-a",
        folderId: "inbox",
        messageId: "message-1",
      });
      expect(
        yield* resolveMailboxResource(
          lookup({
            _tag: "Attachment",
            mailboxId,
            attachmentId: "attachment-1",
          })
        )
      ).toStrictEqual({
        _tag: "Attachment",
        mailboxId: "mailbox-a",
        folderId: "inbox",
        messageId: "message-1",
        attachmentId: "attachment-1",
      });
      expect(
        yield* resolveMailboxResource(
          lookup({ _tag: "Draft", mailboxId, draftId: "draft-1" })
        )
      ).toStrictEqual({
        _tag: "Draft",
        mailboxId: "mailbox-a",
        draftId: "draft-1",
      });
      expect(
        yield* resolveMailboxResource(
          lookup({ _tag: "Rule", mailboxId, ruleId: "rule-1" })
        )
      ).toStrictEqual({
        _tag: "Rule",
        mailboxId: "mailbox-a",
        ruleId: "rule-1",
      });
    })
  );

  it.effect("fails closed for missing and soft-deleted ancestry", () =>
    Effect.gen(function* () {
      const db = yield* MailboxDatabase;
      yield* initialize(initializationRuntime);
      yield* db.insert(message).values({ id: "message-1", folderId: "inbox" });
      yield* db
        .update(folder)
        .set({ deletedAt: 1 })
        .where(eq(folder.id, "inbox"));

      expect(
        yield* resolveMailboxResource(
          lookup({ _tag: "Message", mailboxId, messageId: "message-1" })
        )
      ).toStrictEqual({ _tag: "NotFound" });
      expect(
        yield* resolveMailboxResource(
          lookup({ _tag: "Draft", mailboxId, draftId: "missing" })
        )
      ).toStrictEqual({ _tag: "NotFound" });
    })
  );

  it.effect("rejects identity mismatches and dangling ancestry", () =>
    Effect.gen(function* () {
      const db = yield* MailboxDatabase;
      yield* initialize(initializationRuntime);

      yield* db
        .update(mailboxMetadata)
        .set({ mailboxId: Schema.decodeUnknownSync(MailboxId)("mailbox-b") });
      const mismatch = yield* Effect.exit(initializeMailboxRepository());
      expect(Exit.isFailure(mismatch)).toBeTruthy();
      if (Exit.isFailure(mismatch)) {
        expect(Cause.pretty(mismatch.cause)).toContain(
          "identity does not match"
        );
      }

      const dangling = yield* Effect.exit(
        db.insert(message).values({ id: "message-1", folderId: "missing" })
      );
      expect(Exit.isFailure(dangling)).toBeTruthy();
      if (Exit.isFailure(dangling)) {
        expect(Cause.pretty(dangling.cause)).toContain(
          "FOREIGN KEY constraint failed"
        );
      }
    })
  );

  it.effect("seeds the stable system folders exactly once", () =>
    Effect.gen(function* () {
      const db = yield* MailboxDatabase;
      const firstRuntime = MailboxRuntime.of({
        now: () => 100,
        randomId: () => "unused",
      });
      yield* initialize(firstRuntime);
      yield* initializeMailboxRepository();
      activeRuntime = MailboxRuntime.of({
        now: () => 200,
        randomId: () => "unused",
      });
      yield* initializeMailboxDirectory;

      expect(
        yield* db
          .select({
            id: folder.id,
            name: folder.name,
            kind: folder.kind,
            createdAt: folder.createdAt,
            updatedAt: folder.updatedAt,
          })
          .from(folder)
      ).toStrictEqual([
        {
          id: "inbox",
          name: "Inbox",
          kind: "inbox",
          createdAt: 100,
          updatedAt: 100,
        },
        {
          id: "sent",
          name: "Sent",
          kind: "sent",
          createdAt: 100,
          updatedAt: 100,
        },
        {
          id: "drafts",
          name: "Drafts",
          kind: "drafts",
          createdAt: 100,
          updatedAt: 100,
        },
        {
          id: "scheduled",
          name: "Scheduled",
          kind: "scheduled",
          createdAt: 100,
          updatedAt: 100,
        },
        {
          id: "archive",
          name: "Archive",
          kind: "archive",
          createdAt: 100,
          updatedAt: 100,
        },
        {
          id: "spam",
          name: "Spam",
          kind: "spam",
          createdAt: 100,
          updatedAt: 100,
        },
        {
          id: "trash",
          name: "Trash",
          kind: "trash",
          createdAt: 100,
          updatedAt: 100,
        },
      ]);
    })
  );

  it.effect(
    "lists, creates, renames, and soft-deletes folders with active message counts",
    () => {
      const runtime = MailboxRuntime.of({
        now: () => 1000,
        randomId: () => "folder-projects",
      });
      return Effect.gen(function* () {
        const db = yield* MailboxDatabase;
        yield* initialize(runtime);
        const created = resultSuccess(
          yield* createFolder(
            Schema.decodeUnknownSync(CreateFolderInput)({
              mailboxId,
              operationId: "folder-op",
              name: " Projects ",
            })
          )
        );
        yield* db.insert(message).values([
          { id: "unread", folderId: "folder-projects", read: 0 },
          { id: "read", folderId: "folder-projects", read: 1 },
          {
            id: "deleted",
            folderId: "folder-projects",
            read: 0,
            deletedAt: 1001,
          },
        ]);

        expect(created).toMatchObject({
          id: "folder-projects",
          mailboxId: "mailbox-a",
          name: "Projects",
          kind: "custom",
          version: 1,
        });
        expect(
          (yield* listFolders()).items.find(
            (item) => item.id === "folder-projects"
          )
        ).toMatchObject({ messageCount: 2, unreadCount: 1 });

        activeRuntime = MailboxRuntime.of({ ...runtime, now: () => 2000 });
        const renamed = resultSuccess(
          yield* renameFolder(
            Schema.decodeUnknownSync(RenameFolderInput)({
              mailboxId,
              folderId: "folder-projects",
              expectedVersion: 1,
              name: "Work",
            })
          )
        );
        expect(renamed).toMatchObject({
          name: "Work",
          updatedAt: 2000,
          version: 2,
        });
        expect([
          domainReason(
            yield* renameFolder(
              Schema.decodeUnknownSync(RenameFolderInput)({
                mailboxId,
                folderId: "folder-projects",
                expectedVersion: 1,
                name: "Stale",
              })
            )
          ),
          domainReason(
            yield* deleteFolder(
              Schema.decodeUnknownSync(DeleteFolderInput)({
                mailboxId,
                folderId: "folder-projects",
                expectedVersion: 2,
              })
            )
          ),
        ]).toStrictEqual(["version-conflict", "folder-not-empty"]);

        yield* db
          .update(message)
          .set({ deletedAt: 2001 })
          .where(eq(message.folderId, "folder-projects"));
        activeRuntime = MailboxRuntime.of({ ...runtime, now: () => 3000 });
        const deleted = resultSuccess(
          yield* deleteFolder(
            Schema.decodeUnknownSync(DeleteFolderInput)({
              mailboxId,
              folderId: "folder-projects",
              expectedVersion: 2,
            })
          )
        );
        expect({
          deleted,
          folderCount: (yield* listFolders()).items.length,
          missingReason: domainReason(
            yield* deleteFolder(
              Schema.decodeUnknownSync(DeleteFolderInput)({
                mailboxId,
                folderId: "folder-projects",
                expectedVersion: 3,
              })
            )
          ),
        }).toMatchObject({
          deleted: { id: "folder-projects", deletedAt: 3000, version: 3 },
          folderCount: 7,
          missingReason: "not-found",
        });
      });
    }
  );

  it.effect("blocks deletion of system folders", () =>
    Effect.gen(function* () {
      yield* initialize(initializationRuntime);
      expect(
        domainReason(
          yield* deleteFolder(
            Schema.decodeUnknownSync(DeleteFolderInput)({
              mailboxId,
              folderId: "inbox",
              expectedVersion: 1,
            })
          )
        )
      ).toBe("system-folder");
    })
  );

  it.effect("lists, creates, renames, and soft-deletes labels with CAS", () => {
    const runtime = MailboxRuntime.of({
      now: () => 1000,
      randomId: () => "label-important",
    });
    return Effect.gen(function* () {
      yield* initialize(runtime);
      const request = Schema.decodeUnknownSync(CreateLabelInput)({
        mailboxId,
        operationId: "label-op",
        name: " Important ",
      });
      const created = resultSuccess(yield* createLabel(request));
      const replay = resultSuccess(
        yield* createLabel(
          Schema.decodeUnknownSync(CreateLabelInput)({
            mailboxId,
            operationId: "label-op",
            name: "Important",
          })
        )
      );
      expect({
        created,
        replay,
        listed: (yield* listLabels()).items,
      }).toMatchObject({
        created: { id: "label-important", name: "Important", version: 1 },
        replay: created,
        listed: [created],
      });

      const renamed = resultSuccess(
        yield* renameLabel(
          Schema.decodeUnknownSync(RenameLabelInput)({
            mailboxId,
            labelId: "label-important",
            expectedVersion: 1,
            name: "Priority",
          })
        )
      );
      expect(renamed).toMatchObject({
        name: "Priority",
        updatedAt: 1000,
        version: 2,
      });
      expect(
        domainReason(
          yield* deleteLabel(
            Schema.decodeUnknownSync(DeleteLabelInput)({
              mailboxId,
              labelId: "label-important",
              expectedVersion: 1,
            })
          )
        )
      ).toBe("version-conflict");
      const deleted = resultSuccess(
        yield* deleteLabel(
          Schema.decodeUnknownSync(DeleteLabelInput)({
            mailboxId,
            labelId: "label-important",
            expectedVersion: 2,
          })
        )
      );
      expect({
        deleted,
        remaining: (yield* listLabels()).items,
      }).toMatchObject({
        deleted: { deletedAt: 1000, version: 3 },
        remaining: [],
      });
    });
  });

  it.effect(
    "replays creates and rejects operation ID reuse with another request or kind",
    () => {
      let generated = 0;
      const runtime = MailboxRuntime.of({
        now: () => 1000,
        randomId: () => {
          generated += 1;
          return `generated-${generated}`;
        },
      });
      return Effect.gen(function* () {
        yield* initialize(runtime);
        const first = resultSuccess(
          yield* createFolder(
            Schema.decodeUnknownSync(CreateFolderInput)({
              mailboxId,
              operationId: "shared-op",
              name: " Projects ",
            })
          )
        );
        yield* renameFolder(
          Schema.decodeUnknownSync(RenameFolderInput)({
            mailboxId,
            folderId: first.id,
            expectedVersion: 1,
            name: "Renamed",
          })
        );
        const replay = resultSuccess(
          yield* createFolder(
            Schema.decodeUnknownSync(CreateFolderInput)({
              mailboxId,
              operationId: "shared-op",
              name: "Projects",
            })
          )
        );

        expect(replay).toStrictEqual(first);
        expect(generated).toBe(1);
        expect(
          domainReason(
            yield* createFolder(
              Schema.decodeUnknownSync(CreateFolderInput)({
                mailboxId,
                operationId: "shared-op",
                name: "Different",
              })
            )
          )
        ).toBe("idempotency-conflict");
        expect(
          domainReason(
            yield* createLabel(
              Schema.decodeUnknownSync(CreateLabelInput)({
                mailboxId,
                operationId: "shared-op",
                name: "Projects",
              })
            )
          )
        ).toBe("idempotency-conflict");
      });
    }
  );

  it.effect(
    "rolls back resource creation when the idempotency record cannot be stored",
    () => {
      const runtime = MailboxRuntime.of({
        now: () => 1000,
        randomId: () => "rolled-back",
      });
      return Effect.gen(function* () {
        const db = yield* MailboxDatabase;
        yield* initialize(runtime);
        yield* db.$client.unsafe(`CREATE TRIGGER reject_mailbox_operation
          BEFORE INSERT ON mailbox_operation
          BEGIN
            SELECT RAISE(ABORT, 'operation ledger unavailable');
          END`).raw;

        const exit = yield* Effect.exit(
          createFolder(
            Schema.decodeUnknownSync(CreateFolderInput)({
              mailboxId,
              operationId: "failed-op",
              name: "Must Roll Back",
            })
          )
        );
        expect(Exit.isFailure(exit)).toBeTruthy();
        if (Exit.isFailure(exit)) {
          expect(Cause.pretty(exit.cause)).toContain(
            "operation ledger unavailable"
          );
        }
        const [resourceCount] = yield* db
          .select({ count: count() })
          .from(folder)
          .where(eq(folder.id, "rolled-back"));
        const [operationCount] = yield* db
          .select({ count: count() })
          .from(mailboxOperation)
          .where(eq(mailboxOperation.operationId, "failed-op"));
        expect({ resourceCount, operationCount }).toStrictEqual({
          resourceCount: { count: 0 },
          operationCount: { count: 0 },
        });
      });
    }
  );
});
