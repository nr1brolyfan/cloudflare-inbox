import { UserId } from "@effect-auth/core/Identifiers";
import * as AuthPermission from "@effect-auth/core/Permission";
import * as AuthPolicy from "@effect-auth/core/Policy";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  MailboxMessageActionCommand,
  MailboxMessageBatchActionCommand,
  MailboxMessageActions,
  SetMailboxThreadReadCommand,
} from "#/modules/mailbox/application/MailboxMessageActions";
import { FolderId } from "#/modules/mailbox/domain/Mailbox";
import { FolderList } from "#/modules/mailbox/domain/MailboxDirectory";
import {
  BatchMessageMutationsResult,
  MessagePage,
} from "#/modules/mailbox/domain/MailboxMessage";
import {
  MailboxAuthorization,
  MailResourceResolveError,
} from "#/modules/mailbox/ports/MailboxAuthorization";
import type { MailboxAuthorizationService } from "#/modules/mailbox/ports/MailboxAuthorization";
import { MailboxDirectoryRepository } from "#/modules/mailbox/ports/MailboxDirectoryRepository";
import type { MailboxDirectoryRepositoryService } from "#/modules/mailbox/ports/MailboxDirectoryRepository";
import { MailboxMessageRepository } from "#/modules/mailbox/ports/MailboxMessageRepository";
import type { MailboxMessageRepositoryService } from "#/modules/mailbox/ports/MailboxMessageRepository";

const messagePage = Schema.decodeUnknownSync(MessagePage)({
  items: [
    {
      activityAt: 1000,
      direction: "inbound",
      folderId: "inbox",
      hasAttachments: false,
      id: "message-1",
      labelIds: ["work"],
      mailboxId: "primary",
      read: false,
      recipients: [{ address: "owner@example.test" }],
      sender: { address: "sender@example.test" },
      size: 100,
      snippet: "Preview",
      starred: false,
      subject: "Hello",
      threadId: "thread-1",
      version: 1,
    },
  ],
});
const [message] = messagePage.items;
const readMessage =
  message === undefined
    ? undefined
    : Schema.decodeUnknownSync(MessagePage)({
        items: [{ ...message, read: true, version: 2 }],
      }).items[0];
const archivedMessage =
  message === undefined
    ? undefined
    : Schema.decodeUnknownSync(MessagePage)({
        items: [{ ...message, folderId: "archive", version: 2 }],
      }).items[0];
const inboxFolderId = Schema.decodeUnknownSync(FolderId)("inbox");
const archiveFolderId = Schema.decodeUnknownSync(FolderId)("archive");
const folders = Schema.decodeUnknownSync(FolderList)({
  items: [
    {
      createdAt: 0,
      id: "inbox",
      kind: "inbox",
      mailboxId: "primary",
      messageCount: 1,
      name: "Inbox",
      unreadCount: 1,
      updatedAt: 0,
      version: 1,
    },
    {
      createdAt: 0,
      id: "archive",
      kind: "archive",
      mailboxId: "primary",
      messageCount: 0,
      name: "Archive",
      unreadCount: 0,
      updatedAt: 0,
      version: 1,
    },
  ],
});
const unused = () => Effect.die(new Error("Unexpected repository operation"));
const unusedAuthorization = () =>
  Effect.die(new Error("Unexpected authorization operation"));

type RepositoryOverrides = Partial<MailboxMessageRepositoryService> & {
  readonly listFolders?: MailboxDirectoryRepositoryService["listFolders"];
};

const repositoryWith = (
  overrides: RepositoryOverrides
): {
  readonly directory: MailboxDirectoryRepositoryService;
  readonly messages: MailboxMessageRepositoryService;
} => {
  const { listFolders, ...messageOverrides } = overrides;
  return {
    directory: MailboxDirectoryRepository.of({
      createFolder: unused,
      createLabel: unused,
      deleteFolder: unused,
      deleteLabel: unused,
      listFolders: listFolders ?? unused,
      listLabels: unused,
      renameFolder: unused,
      renameLabel: unused,
    }),
    messages: MailboxMessageRepository.of({
      addMessageLabel: unused,
      batchMutateMessages: unused,
      getAttachmentBlob: unused,
      getInboundAttachmentBlob: unused,
      getMessage: unused,
      getThread: unused,
      listMessages: unused,
      moveMessage: unused,
      removeMessageLabel: unused,
      searchMessages: unused,
      setMessageRead: unused,
      setMessageStarred: unused,
      setThreadRead: unused,
      ...messageOverrides,
    }),
  };
};

const authorizationWith = (
  overrides: Partial<MailboxAuthorizationService>
): MailboxAuthorizationService =>
  MailboxAuthorization.of({
    requireAttachmentRead: unusedAuthorization,
    requireInboundAttachmentDownload: unusedAuthorization,
    requireAttachmentUpload: unusedAuthorization,
    requireDraft: unusedAuthorization,
    requireDraftCreate: unusedAuthorization,
    requireExport: unusedAuthorization,
    requireFolder: unusedAuthorization,
    requireFolderMessageRead: unusedAuthorization,
    requireMailbox: () =>
      Effect.fail(
        new AuthPolicy.AuthorizationError({ reason: "missing-permission" })
      ),
    requireMailboxDraftSend: unusedAuthorization,
    requireMailboxMessageRead: unusedAuthorization,
    requireMailboxMessageModify: unusedAuthorization,
    requireMessage: unusedAuthorization,
    requireRuleManage: unusedAuthorization,
    ...overrides,
  });

const runAction = (
  authorization: MailboxAuthorizationService,
  repository: ReturnType<typeof repositoryWith>,
  command: Schema.Schema.Type<typeof MailboxMessageActionCommand>
) =>
  Effect.runPromise(
    MailboxMessageActions.pipe(
      Effect.flatMap((actions) => actions.execute(command)),
      Effect.provide(
        MailboxMessageActions.layerNoDeps.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(MailboxAuthorization, authorization),
              Layer.succeed(MailboxDirectoryRepository, repository.directory),
              Layer.succeed(MailboxMessageRepository, repository.messages)
            )
          )
        )
      ),
      Effect.provideService(
        AuthPermission.CurrentPrincipal,
        AuthPermission.CurrentPrincipal.of(
          AuthPermission.PermissionSubject.user(UserId("user-a"))
        )
      )
    )
  );

const runBatchAction = (
  authorization: MailboxAuthorizationService,
  repository: ReturnType<typeof repositoryWith>,
  command: Schema.Schema.Type<typeof MailboxMessageBatchActionCommand>
) =>
  Effect.runPromise(
    MailboxMessageActions.pipe(
      Effect.flatMap((actions) => actions.executeBatch(command)),
      Effect.provide(
        MailboxMessageActions.layerNoDeps.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(MailboxAuthorization, authorization),
              Layer.succeed(MailboxDirectoryRepository, repository.directory),
              Layer.succeed(MailboxMessageRepository, repository.messages)
            )
          )
        )
      ),
      Effect.provideService(
        AuthPermission.CurrentPrincipal,
        AuthPermission.CurrentPrincipal.of(
          AuthPermission.PermissionSubject.user(UserId("user-a"))
        )
      )
    )
  );

const runThreadRead = (
  authorization: MailboxAuthorizationService,
  repository: ReturnType<typeof repositoryWith>,
  command: Schema.Schema.Type<typeof SetMailboxThreadReadCommand>
) =>
  Effect.runPromise(
    MailboxMessageActions.pipe(
      Effect.flatMap((actions) => actions.setThreadRead(command)),
      Effect.provide(
        MailboxMessageActions.layerNoDeps.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(MailboxAuthorization, authorization),
              Layer.succeed(MailboxDirectoryRepository, repository.directory),
              Layer.succeed(MailboxMessageRepository, repository.messages)
            )
          )
        )
      ),
      Effect.provideService(
        AuthPermission.CurrentPrincipal,
        AuthPermission.CurrentPrincipal.of(
          AuthPermission.PermissionSubject.user(UserId("user-a"))
        )
      )
    )
  );

describe("mailbox message actions", () => {
  it("authorizes thread read at mailbox message.modify scope", async () => {
    const calls: string[] = [];
    const command = Schema.decodeUnknownSync(SetMailboxThreadReadCommand)({
      mailboxId: "primary",
      operationId: "thread-read-op",
      threadId: "thread-1",
    });
    const result = await runThreadRead(
      authorizationWith({
        requireMailboxMessageModify: ({ resource }) => {
          calls.push(`authorize:${resource.mailboxId}`);
          return Effect.succeed(resource);
        },
      }),
      repositoryWith({
        setThreadRead: (input) => {
          calls.push("set-thread-read");
          return Effect.succeed({
            changed:
              readMessage === undefined
                ? []
                : [
                    {
                      folderId: readMessage.folderId,
                      id: readMessage.id,
                      read: readMessage.read,
                      starred: readMessage.starred,
                      version: readMessage.version,
                    },
                  ],
            operationId: input.operationId,
            threadId: input.threadId,
          });
        },
      }),
      command
    );

    expect({ calls, result }).toMatchObject({
      calls: ["authorize:primary", "set-thread-read"],
      result: {
        changed: [{ id: "message-1", read: true, version: 2 }],
        operationId: "thread-read-op",
        threadId: "thread-1",
      },
    });
  });
  it("keeps read actions when an archive target is unauthorized", async () => {
    const command = Schema.decodeUnknownSync(MailboxMessageBatchActionCommand)({
      actions: [
        {
          _tag: "SetRead",
          expectedVersion: 1,
          messageId: "message-1",
          operationId: "mixed-read-op",
          read: true,
        },
        {
          _tag: "Archive",
          expectedVersion: 1,
          messageId: "message-2",
          operationId: "mixed-archive-op",
        },
      ],
      batchOperationId: "mixed-batch-op",
      mailboxId: "primary",
    });
    const result = await runBatchAction(
      authorizationWith({
        requireFolder: ({ resource }) =>
          Effect.fail(
            new MailResourceResolveError({
              message: "Folder unavailable",
              reason: "not-found",
              resource,
            })
          ),
        requireMessage: ({ resource }) =>
          Effect.succeed({ ...resource, folderId: inboxFolderId }),
      }),
      repositoryWith({
        batchMutateMessages: (input) =>
          Effect.succeed(
            Schema.decodeUnknownSync(BatchMessageMutationsResult)({
              batchOperationId: input.batchOperationId,
              results: input.mutations.map((mutation) => ({
                _tag: "Succeeded",
                messageId: mutation.messageId,
                operationId: mutation.operationId,
                value: {
                  ...(readMessage ?? message),
                  id: mutation.messageId,
                },
              })),
            })
          ),
        listFolders: () => Effect.succeed(folders),
      }),
      command
    );

    expect(result).toMatchObject({
      results: [
        { _tag: "Succeeded", messageId: "message-1" },
        { _tag: "Failed", messageId: "message-2", reason: "not-found" },
      ],
    });
  });

  it("authorizes a batch and forwards one resolved repository mutation", async () => {
    const calls: string[] = [];
    let repositoryInput: unknown;
    const command = Schema.decodeUnknownSync(MailboxMessageBatchActionCommand)({
      actions: [
        {
          _tag: "SetRead",
          expectedVersion: 1,
          messageId: "message-1",
          operationId: "batch-read-op",
          read: true,
        },
        {
          _tag: "Archive",
          expectedVersion: 1,
          messageId: "message-2",
          operationId: "batch-archive-op",
        },
      ],
      batchOperationId: "batch-op",
      mailboxId: "primary",
    });
    const result = await runBatchAction(
      authorizationWith({
        requireFolder: ({ resource }) => {
          calls.push("authorize-folder");
          return Effect.succeed(resource);
        },
        requireMessage: ({ resource }) => {
          calls.push(`authorize-message:${resource.messageId}`);
          return Effect.succeed({ ...resource, folderId: inboxFolderId });
        },
      }),
      repositoryWith({
        batchMutateMessages: (input) => {
          calls.push("batch-mutate");
          repositoryInput = input;
          return Effect.succeed(
            Schema.decodeUnknownSync(BatchMessageMutationsResult)({
              batchOperationId: input.batchOperationId,
              results: input.mutations.map((mutation) => ({
                _tag: "Succeeded" as const,
                messageId: mutation.messageId,
                operationId: mutation.operationId,
                value: {
                  ...(readMessage ?? message),
                  folderId:
                    mutation._tag === "Move"
                      ? mutation.folderId
                      : inboxFolderId,
                  id: mutation.messageId,
                  read: mutation._tag === "Read" ? mutation.read : false,
                  version: 2,
                },
              })),
            })
          );
        },
        listFolders: () => {
          calls.push("list-folders");
          return Effect.succeed(folders);
        },
      }),
      command
    );

    expect({ calls, repositoryInput, result }).toMatchObject({
      calls: [
        "list-folders",
        "authorize-folder",
        "authorize-message:message-1",
        "authorize-message:message-2",
        "batch-mutate",
      ],
      repositoryInput: {
        batchOperationId: "batch-op",
        mutations: [
          { _tag: "Read", messageId: "message-1", read: true },
          { _tag: "Move", folderId: "archive", messageId: "message-2" },
        ],
      },
      result: {
        results: [
          { _tag: "Succeeded", messageId: "message-1" },
          { _tag: "Succeeded", messageId: "message-2" },
        ],
      },
    });
  });

  it("authorizes before forwarding an exact read command", async () => {
    const calls: string[] = [];
    let repositoryInput: unknown;
    const command = Schema.decodeUnknownSync(MailboxMessageActionCommand)({
      _tag: "SetRead",
      expectedVersion: 1,
      mailboxId: "primary",
      messageId: "message-1",
      operationId: "operation-1",
      read: true,
    });
    const result = await runAction(
      authorizationWith({
        requireMessage: ({ resource }) => {
          calls.push("authorize-message");
          return Effect.succeed({ ...resource, folderId: inboxFolderId });
        },
      }),
      repositoryWith({
        setMessageRead: (input) => {
          calls.push("set-read");
          repositoryInput = input;
          return readMessage === undefined
            ? Effect.die("Missing message fixture")
            : Effect.succeed(readMessage);
        },
      }),
      command
    );

    expect({ calls, repositoryInput, result }).toMatchObject({
      calls: ["authorize-message", "set-read"],
      repositoryInput: command,
      result: { id: "message-1", read: true, version: 2 },
    });
  });

  it("resolves and authorizes the archive folder before moving", async () => {
    const calls: string[] = [];
    let moveInput: unknown;
    const command = Schema.decodeUnknownSync(MailboxMessageActionCommand)({
      _tag: "Archive",
      expectedVersion: 1,
      mailboxId: "primary",
      messageId: "message-1",
      operationId: "operation-2",
    });
    const result = await runAction(
      authorizationWith({
        requireFolder: ({ resource }) => {
          calls.push(`authorize-folder:${resource.folderId}`);
          return Effect.succeed(resource);
        },
        requireMessage: ({ resource }) => {
          calls.push("authorize-message");
          return Effect.succeed({ ...resource, folderId: inboxFolderId });
        },
      }),
      repositoryWith({
        listFolders: () => {
          calls.push("list-folders");
          return Effect.succeed(folders);
        },
        moveMessage: (input) => {
          calls.push("move");
          moveInput = input;
          return archivedMessage === undefined
            ? Effect.die("Missing message fixture")
            : Effect.succeed(archivedMessage);
        },
      }),
      command
    );

    expect({ calls, moveInput, result }).toMatchObject({
      calls: [
        "authorize-message",
        "list-folders",
        "authorize-folder:archive",
        "move",
      ],
      moveInput: {
        expectedVersion: 1,
        folderId: "archive",
        mailboxId: "primary",
        messageId: "message-1",
        operationId: "operation-2",
      },
      result: { folderId: "archive", version: 2 },
    });

    let replayed = false;
    const replay = await runAction(
      authorizationWith({
        requireFolder: ({ resource }) => Effect.succeed(resource),
        requireMessage: ({ resource }) =>
          Effect.succeed({ ...resource, folderId: archiveFolderId }),
      }),
      repositoryWith({
        listFolders: () => Effect.succeed(folders),
        moveMessage: () => {
          replayed = true;
          return archivedMessage === undefined
            ? Effect.die("Missing message fixture")
            : Effect.succeed(archivedMessage);
        },
      }),
      command
    );

    expect({ replay, replayed }).toMatchObject({
      replay: { folderId: "archive", version: 2 },
      replayed: true,
    });
  });
});
