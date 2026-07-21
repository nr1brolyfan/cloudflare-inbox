import { UserId } from "@effect-auth/core/Identifiers";
import * as AuthPermission from "@effect-auth/core/Permission";
import * as AuthPolicy from "@effect-auth/core/Policy";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import type { MailAuthorization as MailAuthorizationService } from "#/authorization/mail-authorization";
import { MailAuthorization } from "#/authorization/mail-authorization";
import { FolderId } from "#/mailboxes/core";
import { MailboxDomainError } from "#/mailboxes/errors";
import {
  MailboxMessageReading,
  MailboxMessageReadingLive,
  MailboxMessageListInput,
  MailboxMessageListResult,
  MailboxMessageReadResult,
  MailboxMessageView,
  MailboxThreadResult,
  OpenMailboxThreadInput,
  ReadMailboxMessageInput,
} from "#/mailboxes/message-reading";
import { GetThreadResult, MessagePage } from "#/mailboxes/messages";
import type { MailboxRepository as MailboxRepositoryService } from "#/mailboxes/repository";
import { MailboxRepository } from "#/mailboxes/repository";

const messageSummary = {
  activityAt: 2000,
  direction: "inbound",
  folderId: "inbox",
  hasAttachments: true,
  id: "message-1",
  labelIds: ["work"],
  mailboxId: "primary",
  read: false,
  recipients: [{ address: "owner@example.test" }],
  sender: { address: "sender@example.test", displayName: "Sender" },
  size: 4096,
  snippet: "Plain text preview",
  starred: true,
  subject: "Hello",
  threadId: "thread-1",
  version: 3,
} as const;
const page = Schema.decodeUnknownSync(MessagePage)({
  items: [messageSummary],
  nextCursor: "next-page",
});
const thread = Schema.decodeUnknownSync(GetThreadResult)({
  messages: [
    {
      ...messageSummary,
      attachments: [
        {
          disposition: "attachment",
          fileName: "invoice.pdf",
          id: "attachment-1",
          messageId: "message-1",
          mimeType: "application/pdf",
          size: 1024,
        },
      ],
      bcc: [],
      cc: [],
      hasAttachments: true,
      htmlBody: '<img src="https://tracker.test/pixel" onerror="alert(1)">',
      receivedAt: 2000,
      references: [],
      textBody: "Plain text body",
      to: [{ address: "owner@example.test" }],
    },
  ],
  nextCursor: "next-thread-page",
  thread: {
    id: "thread-1",
    latestActivityAt: 2000,
    mailboxId: "primary",
    messageCount: 2,
    participants: [{ address: "sender@example.test" }],
    subject: "Hello",
    unreadCount: 1,
  },
});
const getThreadFixtureMessage = () => {
  const [message] = thread.messages;
  if (message === undefined) {
    throw new Error("Thread fixture has no anchor message");
  }
  return message;
};
const unused = () => Effect.die(new Error("Unexpected repository operation"));
const unusedAuthorization = () =>
  Effect.die(new Error("Unexpected authorization operation"));

const repositoryWith = (
  listMessages: MailboxRepositoryService["listMessages"] = () =>
    Effect.succeed(page),
  getThread: MailboxRepositoryService["getThread"] = () =>
    Effect.succeed(thread),
  getMessage: MailboxRepositoryService["getMessage"] = () =>
    thread.messages[0] === undefined
      ? Effect.die(new Error("Thread fixture has no anchor message"))
      : Effect.succeed(thread.messages[0]),
  searchMessages: MailboxRepositoryService["searchMessages"] = unused
) =>
  MailboxRepository.of({
    addMessageLabel: unused,
    cancelOutboundDelivery: unused,
    completeDraftAttachment: unused,
    createDraft: unused,
    createFolder: unused,
    createLabel: unused,
    deleteFolder: unused,
    deleteLabel: unused,
    findAttachmentLocation: unused,
    findDraftLocation: unused,
    findFolderLocation: unused,
    findMessageLocation: unused,
    findRuleLocation: unused,
    getAttachmentBlob: unused,
    getDraft: unused,
    getDraftAttachment: unused,
    getMessage,
    getOutboundDelivery: unused,
    getThread,
    listFolders: unused,
    listDraftAttachments: unused,
    listDrafts: unused,
    listLabels: unused,
    listMessages,
    moveMessage: unused,
    removeMessageLabel: unused,
    reserveDraftAttachment: unused,
    renameFolder: unused,
    renameLabel: unused,
    resendOutbound: unused,
    scheduleOutbound: unused,
    searchMessages,
    setMessageRead: unused,
    setMessageStarred: unused,
    updateDraft: unused,
  });

const authorizationWith = (
  requireMailboxMessageRead: MailAuthorizationService["requireMailboxMessageRead"],
  requireFolderMessageRead?: MailAuthorizationService["requireFolderMessageRead"],
  requireMessage: MailAuthorizationService["requireMessage"] = unusedAuthorization
) => {
  const folderMessageRead =
    requireFolderMessageRead ??
    (({ resource }) =>
      requireMailboxMessageRead({
        resource: { _tag: "Mailbox", mailboxId: resource.mailboxId },
      }).pipe(
        Effect.map((location) => ({
          _tag: "MailboxMessageRead" as const,
          mailboxId: location.mailboxId,
        }))
      ));

  return MailAuthorization.of({
    requireAttachmentRead: unusedAuthorization,
    requireAttachmentUpload: unusedAuthorization,
    requireDraft: unusedAuthorization,
    requireDraftCreate: unusedAuthorization,
    requireExport: unusedAuthorization,
    requireFolder: unusedAuthorization,
    requireFolderMessageRead: folderMessageRead,
    requireMailbox: unusedAuthorization,
    requireMailboxDraftSend: unusedAuthorization,
    requireMailboxMessageRead,
    requireMessage,
    requireRuleManage: unusedAuthorization,
  });
};

const runReading = <A, E>(
  authorization: MailAuthorizationService,
  repository: MailboxRepositoryService,
  use: (
    reading: MailboxMessageReading
  ) => Effect.Effect<A, E, AuthPermission.CurrentPrincipal>
) =>
  Effect.runPromise(
    MailboxMessageReading.pipe(
      Effect.flatMap(use),
      Effect.provide(
        MailboxMessageReadingLive.pipe(
          Layer.provide(
            Layer.merge(
              Layer.succeed(MailAuthorization, authorization),
              Layer.succeed(MailboxRepository, repository)
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

describe("mailbox message reading", () => {
  it("authorizes before listing and projects a folder view", async () => {
    const calls: string[] = [];
    let repositoryInput: unknown;
    const view = Schema.decodeUnknownSync(MailboxMessageView)({
      _tag: "Folder",
      folderId: "inbox",
      mailboxId: "primary",
    });
    const result = await runReading(
      authorizationWith(({ resource }) => {
        calls.push(`authorize:${resource.mailboxId}`);
        return Effect.succeed(resource);
      }),
      repositoryWith((input) => {
        calls.push("list");
        repositoryInput = input;
        return Effect.succeed(page);
      }),
      (reading) => reading.listView(view)
    );
    const encoded = Schema.encodeSync(MailboxMessageListResult)(result);

    expect({
      calls,
      nextCursor: result.nextCursor,
      input: repositoryInput,
      item: result.items[0],
    }).toMatchObject({
      calls: ["authorize:primary", "list"],
      nextCursor: "next-page",
      input: {
        filters: { folderId: "inbox" },
        mailboxId: "primary",
        page: { limit: 25 },
      },
      item: {
        folderId: "inbox",
        id: "message-1",
        threadId: "thread-1",
        version: 3,
      },
    });
    expect(JSON.stringify(encoded)).not.toMatch(/mailboxId|size/u);
  });

  it("maps a label view to one repository label filter", async () => {
    let repositoryInput: unknown;
    const view = Schema.decodeUnknownSync(MailboxMessageView)({
      _tag: "Label",
      labelId: "work",
      mailboxId: "primary",
    });

    await runReading(
      authorizationWith(({ resource }) => Effect.succeed(resource)),
      repositoryWith((input) => {
        repositoryInput = input;
        return Effect.succeed(page);
      }),
      (reading) => reading.listView(view)
    );

    expect(repositoryInput).toMatchObject({
      filters: { labelIds: ["work"] },
      mailboxId: "primary",
      page: { limit: 25 },
    });
  });

  it("searches within the selected view and forwards filters and cursor", async () => {
    let repositoryInput: unknown;
    const input = Schema.decodeUnknownSync(MailboxMessageListInput)({
      _tag: "Folder",
      cursor: "search-page-2",
      folderId: "inbox",
      hasAttachment: true,
      mailboxId: "primary",
      query: "quarterly report",
      read: false,
      starred: true,
    });

    await runReading(
      authorizationWith(({ resource }) => Effect.succeed(resource)),
      repositoryWith(undefined, undefined, undefined, (searchInput) => {
        repositoryInput = searchInput;
        return Effect.succeed(page);
      }),
      (reading) => reading.listView(input)
    );

    expect(repositoryInput).toMatchObject({
      filters: {
        folderId: "inbox",
        hasAttachment: true,
        read: false,
        starred: true,
      },
      mailboxId: "primary",
      page: { cursor: "search-page-2", limit: 25 },
      query: "quarterly report",
    });
  });

  it("maps invalid repository cursors to an invalid query error", async () => {
    const input = Schema.decodeUnknownSync(MailboxMessageListInput)({
      _tag: "Folder",
      cursor: "tampered-cursor",
      folderId: "inbox",
      mailboxId: "primary",
    });

    await expect(
      runReading(
        authorizationWith(({ resource }) => Effect.succeed(resource)),
        repositoryWith(() =>
          Effect.fail(
            new MailboxDomainError({
              message: "Message cursor is invalid",
              operation: "list-messages",
              reason: "validation",
            })
          )
        ),
        (reading) => reading.listView(input)
      )
    ).rejects.toMatchObject({
      _tag: "MailboxMessageReadingError",
      reason: "invalid-input",
    });
  });

  it("does not access the repository after message-read denial", async () => {
    let reads = 0;
    const view = Schema.decodeUnknownSync(MailboxMessageView)({
      _tag: "Folder",
      folderId: "inbox",
      mailboxId: "primary",
    });

    await expect(
      runReading(
        authorizationWith(() =>
          Effect.fail(
            new AuthPolicy.AuthorizationError({
              reason: "missing-permission",
            })
          )
        ),
        repositoryWith(() => {
          reads += 1;
          return Effect.succeed(page);
        }),
        (reading) => reading.listView(view)
      )
    ).rejects.toMatchObject({ reason: "missing-permission" });
    expect(reads).toBe(0);
  });

  it("authorizes before reading one message and projects no HTML or attachment metadata", async () => {
    const calls: string[] = [];
    const input = Schema.decodeUnknownSync(ReadMailboxMessageInput)({
      _tag: "Label",
      labelId: "work",
      mailboxId: "primary",
      messageId: "message-1",
    });
    const result = await runReading(
      authorizationWith(({ resource }) => {
        calls.push(`authorize:${resource.mailboxId}`);
        return Effect.succeed(resource);
      }),
      repositoryWith(undefined, undefined, (repositoryInput) => {
        calls.push("get-message");
        expect(repositoryInput).toStrictEqual({
          mailboxId: "primary",
          messageId: "message-1",
        });
        return Effect.succeed(getThreadFixtureMessage());
      }),
      (reading) => reading.readMessage(input)
    );
    const encoded = Schema.encodeSync(MailboxMessageReadResult)(result);

    expect(calls).toStrictEqual(["authorize:primary", "get-message"]);
    expect(encoded).toMatchObject({
      hasAttachments: true,
      hasHtmlBody: true,
      id: "message-1",
      textBody: "Plain text body",
    });
    expect(JSON.stringify(encoded)).not.toMatch(
      /tracker\.test|mimeType|invoice\.pdf|attachment-1/u
    );
  });

  it("does not read message storage after authorization denial", async () => {
    let reads = 0;
    const input = Schema.decodeUnknownSync(ReadMailboxMessageInput)({
      _tag: "Folder",
      folderId: "inbox",
      mailboxId: "primary",
      messageId: "message-1",
    });

    await expect(
      runReading(
        authorizationWith(() =>
          Effect.fail(
            new AuthPolicy.AuthorizationError({
              reason: "missing-permission",
            })
          )
        ),
        repositoryWith(undefined, undefined, () => {
          reads += 1;
          return Effect.succeed(getThreadFixtureMessage());
        }),
        (reading) => reading.readMessage(input)
      )
    ).rejects.toMatchObject({ reason: "missing-permission" });
    expect(reads).toBe(0);
  });

  it("does not read a message outside the selected label", async () => {
    const input = Schema.decodeUnknownSync(ReadMailboxMessageInput)({
      _tag: "Label",
      labelId: "finance",
      mailboxId: "primary",
      messageId: "message-1",
    });

    await expect(
      runReading(
        authorizationWith(({ resource }) => Effect.succeed(resource)),
        repositoryWith(),
        (reading) => reading.readMessage(input)
      )
    ).rejects.toMatchObject({
      _tag: "MailboxMessageReadingError",
      reason: "not-found",
    });
  });

  it("projects thread text and metadata without exposing raw HTML", async () => {
    const input = Schema.decodeUnknownSync(OpenMailboxThreadInput)({
      _tag: "Folder",
      folderId: "inbox",
      mailboxId: "primary",
      messageId: "message-1",
      threadId: "thread-1",
    });
    const result = await runReading(
      authorizationWith(({ resource }) => Effect.succeed(resource)),
      repositoryWith(),
      (reading) => reading.openThread(input)
    );
    const encoded = Schema.encodeSync(MailboxThreadResult)(result);

    expect(encoded).toMatchObject({
      hasMore: true,
      messages: [
        {
          attachments: [{ fileName: "invoice.pdf" }],
          hasHtmlBody: true,
          textBody: "Plain text body",
        },
      ],
      thread: { id: "thread-1", messageCount: 2 },
    });
    expect(JSON.stringify(encoded)).not.toContain("tracker.test");
  });

  it("authorizes a complete thread before repository access", async () => {
    let reads = 0;
    const input = Schema.decodeUnknownSync(OpenMailboxThreadInput)({
      _tag: "Folder",
      folderId: "inbox",
      mailboxId: "primary",
      messageId: "message-1",
      threadId: "thread-1",
    });

    await expect(
      runReading(
        authorizationWith(() =>
          Effect.fail(
            new AuthPolicy.AuthorizationError({
              reason: "missing-permission",
            })
          )
        ),
        repositoryWith(undefined, () => {
          reads += 1;
          return Effect.succeed(thread);
        }),
        (reading) => reading.openThread(input)
      )
    ).rejects.toMatchObject({ reason: "missing-permission" });
    expect(reads).toBe(0);
  });

  it("authorizes every message in a complete folder-scoped thread", async () => {
    let authorizedMessages = 0;
    const encodedThread = Schema.encodeSync(GetThreadResult)(thread);
    const completeThread = Schema.decodeUnknownSync(GetThreadResult)({
      messages: encodedThread.messages,
      thread: encodedThread.thread,
    });
    const input = Schema.decodeUnknownSync(OpenMailboxThreadInput)({
      _tag: "Folder",
      folderId: "inbox",
      mailboxId: "primary",
      messageId: "message-1",
      threadId: "thread-1",
    });
    const result = await runReading(
      authorizationWith(
        () =>
          Effect.fail(
            new AuthPolicy.AuthorizationError({
              reason: "missing-permission",
            })
          ),
        ({ resource }) =>
          Effect.succeed({
            _tag: "FolderMessageRead" as const,
            folderId: resource.folderId,
            mailboxId: resource.mailboxId,
          }),
        ({ resource }) => {
          authorizedMessages += 1;
          return Effect.succeed({
            ...resource,
            folderId: Schema.decodeUnknownSync(FolderId)("inbox"),
          });
        }
      ),
      repositoryWith(undefined, () => Effect.succeed(completeThread)),
      (reading) => reading.openThread(input)
    );

    expect({ authorizedMessages, threadId: result.thread.id }).toStrictEqual({
      authorizedMessages: 2,
      threadId: "thread-1",
    });
  });

  it("does not open a thread outside the selected view", async () => {
    const input = Schema.decodeUnknownSync(OpenMailboxThreadInput)({
      _tag: "Folder",
      folderId: "trash",
      mailboxId: "primary",
      messageId: "message-1",
      threadId: "thread-1",
    });

    await expect(
      runReading(
        authorizationWith(({ resource }) => Effect.succeed(resource)),
        repositoryWith(),
        (reading) => reading.openThread(input)
      )
    ).rejects.toMatchObject({
      _tag: "MailboxMessageReadingError",
      reason: "not-found",
    });
  });

  it("does not load a thread when its anchor belongs to another thread", async () => {
    let threadReads = 0;
    const input = Schema.decodeUnknownSync(OpenMailboxThreadInput)({
      _tag: "Label",
      labelId: "work",
      mailboxId: "primary",
      messageId: "message-1",
      threadId: "thread-other",
    });

    await expect(
      runReading(
        authorizationWith(({ resource }) => Effect.succeed(resource)),
        repositoryWith(
          undefined,
          () => {
            threadReads += 1;
            return Effect.succeed(thread);
          },
          () => Effect.succeed(getThreadFixtureMessage())
        ),
        (reading) => reading.openThread(input)
      )
    ).rejects.toMatchObject({
      _tag: "MailboxMessageReadingError",
      reason: "not-found",
    });
    expect(threadReads).toBe(0);
  });

  it("rejects a repository page outside the selected folder", async () => {
    const view = Schema.decodeUnknownSync(MailboxMessageView)({
      _tag: "Folder",
      folderId: "archive",
      mailboxId: "primary",
    });

    await expect(
      runReading(
        authorizationWith(({ resource }) => Effect.succeed(resource)),
        repositoryWith(),
        (reading) => reading.listView(view)
      )
    ).rejects.toMatchObject({
      _tag: "MailboxMessageReadingError",
      reason: "storage",
    });
  });
});
