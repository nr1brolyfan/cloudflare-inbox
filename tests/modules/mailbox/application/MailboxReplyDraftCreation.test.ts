import { UserId } from "@effect-auth/core/Identifiers";
import * as AuthPermission from "@effect-auth/core/Permission";
import * as AuthPolicy from "@effect-auth/core/Policy";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  CreateMailboxReplyDraftCommand,
  MailboxReplyDraftCreation,
} from "#/modules/mailbox/application/MailboxReplyDraftCreation";
import { FolderId } from "#/modules/mailbox/domain/Mailbox";
import { DraftSchema } from "#/modules/mailbox/domain/MailboxDraft";
import { MailboxDomainError } from "#/modules/mailbox/domain/MailboxError";
import { MailboxAuthorization } from "#/modules/mailbox/ports/MailboxAuthorization";
import type { MailboxAuthorizationService } from "#/modules/mailbox/ports/MailboxAuthorization";
import { MailboxReplyDraftRepository } from "#/modules/mailbox/ports/MailboxReplyDraftRepository";
import type { MailboxReplyDraftRepositoryService } from "#/modules/mailbox/ports/MailboxReplyDraftRepository";

const unused = () =>
  Effect.die(new Error("Unexpected authorization operation"));
const permissionDenied = () =>
  Effect.fail(
    new AuthPolicy.AuthorizationError({ reason: "missing-permission" })
  );
const authorizationWith = (
  overrides: Partial<MailboxAuthorizationService>
): MailboxAuthorizationService =>
  MailboxAuthorization.of({
    requireAttachmentRead: unused,
    requireInboundAttachmentDownload: unused,
    requireAttachmentUpload: unused,
    requireDraft: unused,
    requireDraftCreate: unused,
    requireExport: unused,
    requireFolder: unused,
    requireFolderMessageRead: unused,
    requireMailbox: unused,
    requireMailboxDraftSend: unused,
    requireMailboxMessageRead: unused,
    requireMailboxMessageModify: unused,
    requireMessage: unused,
    requireRuleManage: unused,
    ...overrides,
  });

const command = Schema.decodeUnknownSync(CreateMailboxReplyDraftCommand)({
  _tag: "Folder",
  mailboxId: "primary",
  folderId: "inbox",
  messageId: "message-1",
  threadId: "thread-1",
  operationId: "reply-op",
  sender: { address: "attacker@example.test" },
  to: [{ address: "attacker@example.test" }],
});

const draft = Schema.decodeUnknownSync(DraftSchema)({
  id: "draft-1",
  mailboxId: "primary",
  threadId: "thread-1",
  inReplyToMessageId: "message-1",
  to: [{ address: "reply@example.test" }],
  cc: [],
  bcc: [],
  subject: "Re: Subject",
  attachmentIds: [],
  createdAt: 1000,
  updatedAt: 1000,
  version: 1,
});

const repositoryWith = (
  overrides: Partial<MailboxReplyDraftRepositoryService> = {}
) =>
  MailboxReplyDraftRepository.of({
    createReplyDraft: () => Effect.succeed(draft),
    readReplyDraftOperation: () => Effect.succeed({ _tag: "NotFound" }),
    ...overrides,
  });

const run = (
  authorization: MailboxAuthorizationService,
  repository: MailboxReplyDraftRepositoryService = repositoryWith()
) =>
  MailboxReplyDraftCreation.pipe(
    Effect.flatMap((service) => service.create(command)),
    Effect.provide(
      MailboxReplyDraftCreation.layerNoDeps.pipe(
        Layer.provide(
          Layer.merge(
            Layer.succeed(MailboxAuthorization, authorization),
            Layer.succeed(MailboxReplyDraftRepository, repository)
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
  );

describe("mailbox reply draft creation", () => {
  it("requires exact message read and draft.create before returning an editor projection", async () => {
    const calls: string[] = [];
    const result = await Effect.runPromise(
      run(
        authorizationWith({
          requireFolderMessageRead: ({ resource }) => {
            calls.push("folder.read");
            return Effect.succeed({
              _tag: "FolderMessageRead",
              folderId: resource.folderId,
              mailboxId: resource.mailboxId,
            });
          },
          requireMessage: ({ resource }) => {
            calls.push("message.read");
            return Effect.succeed({
              _tag: "Message",
              folderId: Schema.decodeUnknownSync(FolderId)("inbox"),
              mailboxId: resource.mailboxId,
              messageId: resource.messageId,
            });
          },
          requireDraftCreate: ({ resource }) => {
            calls.push("draft.create");
            return Effect.succeed(resource);
          },
        })
      )
    );

    expect({ calls, command, result }).toMatchObject({
      calls: ["draft.create", "folder.read", "message.read"],
      command: {
        mailboxId: "primary",
        messageId: "message-1",
        operationId: "reply-op",
        threadId: "thread-1",
      },
      result: {
        attachments: [],
        content: { to: [{ address: "reply@example.test" }] },
      },
    });
    expect(
      Object.hasOwn(command, "sender") || Object.hasOwn(command, "to")
    ).toBeFalsy();
  });

  it("fails closed before draft.create when message ancestry differs", async () => {
    const calls: string[] = [];
    const result = await Effect.runPromiseExit(
      run(
        authorizationWith({
          requireFolderMessageRead: ({ resource }) =>
            Effect.succeed({
              _tag: "FolderMessageRead",
              folderId: resource.folderId,
              mailboxId: resource.mailboxId,
            }),
          requireMessage: ({ resource }) =>
            Effect.succeed({
              _tag: "Message",
              folderId: Schema.decodeUnknownSync(FolderId)("archive"),
              mailboxId: resource.mailboxId,
              messageId: resource.messageId,
            }),
          requireDraftCreate: ({ resource }) => {
            calls.push("draft.create");
            return Effect.succeed(resource);
          },
        })
      )
    );

    expect({ failed: result._tag, calls }).toStrictEqual({
      failed: "Failure",
      calls: ["draft.create"],
    });
  });

  it("authorizes a committed operation result without resolving the old target context", async () => {
    const calls: string[] = [];
    const result = await Effect.runPromise(
      run(
        authorizationWith({
          requireDraftCreate: ({ resource }) => {
            calls.push("draft.create");
            return Effect.succeed(resource);
          },
          requireDraft: ({ resource }) => {
            calls.push("draft.edit");
            return Effect.succeed(resource);
          },
        }),
        repositoryWith({
          createReplyDraft: () =>
            Effect.die(new Error("Must not create a duplicate draft")),
          readReplyDraftOperation: () =>
            Effect.succeed({ _tag: "Found", draft }),
        })
      )
    );

    expect({ calls, id: result.id }).toStrictEqual({
      calls: ["draft.create", "draft.edit"],
      id: "draft-1",
    });
  });

  it("requires label read and draft.create and does not create after either denial", async () => {
    const labelCommand = Schema.decodeUnknownSync(
      CreateMailboxReplyDraftCommand
    )({
      _tag: "Label",
      mailboxId: "primary",
      labelId: "work",
      messageId: "message-1",
      threadId: "thread-1",
      operationId: "reply-label",
    });
    let creates = 0;
    const repository = repositoryWith({
      createReplyDraft: () => {
        creates += 1;
        return Effect.succeed(draft);
      },
    });
    const runLabel = (authorization: MailboxAuthorizationService) =>
      MailboxReplyDraftCreation.pipe(
        Effect.flatMap((service) => service.create(labelCommand)),
        Effect.provide(
          MailboxReplyDraftCreation.layerNoDeps.pipe(
            Layer.provide(
              Layer.merge(
                Layer.succeed(MailboxAuthorization, authorization),
                Layer.succeed(MailboxReplyDraftRepository, repository)
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
      );
    // oxlint-disable-next-line unicorn/consistent-function-scoping -- Keep the denial fixture beside its permission matrix.
    const denied = () =>
      Effect.fail(
        new AuthPolicy.AuthorizationError({ reason: "missing-permission" })
      );

    await expect(
      Effect.runPromise(
        runLabel(
          authorizationWith({
            requireDraftCreate: ({ resource }) => Effect.succeed(resource),
            requireMailboxMessageRead: denied,
          })
        )
      )
    ).rejects.toMatchObject({ reason: "missing-permission" });
    await expect(
      Effect.runPromise(
        runLabel(
          authorizationWith({
            requireMailboxMessageRead: ({ resource }) =>
              Effect.succeed(resource),
            requireDraftCreate: denied,
          })
        )
      )
    ).rejects.toMatchObject({ reason: "missing-permission" });
    expect(creates).toBe(0);
  });

  it("denies operation readback before storage for both absent and conflicting operations", async () => {
    await Promise.all(
      (["absent", "conflict"] as const).map(async (storedResult) => {
        let repositoryCalls = 0;
        const repository = repositoryWith({
          readReplyDraftOperation: () => {
            repositoryCalls += 1;
            return storedResult === "absent"
              ? Effect.succeed({ _tag: "NotFound" })
              : Effect.fail(
                  new MailboxDomainError({
                    operation: "create-reply-draft",
                    reason: "idempotency-conflict",
                    message: "conflict",
                  })
                );
          },
        });

        await expect(
          Effect.runPromise(
            run(
              authorizationWith({ requireDraftCreate: permissionDenied }),
              repository
            )
          )
        ).rejects.toMatchObject({ reason: "missing-permission" });
        expect(repositoryCalls).toBe(0);
      })
    );
  });

  it("maps the recipient ceiling to a typed invalid-input error", async () => {
    await expect(
      Effect.runPromise(
        run(
          authorizationWith({
            requireFolderMessageRead: ({ resource }) =>
              Effect.succeed({
                _tag: "FolderMessageRead",
                folderId: resource.folderId,
                mailboxId: resource.mailboxId,
              }),
            requireMessage: ({ resource }) =>
              Effect.succeed({
                ...resource,
                folderId: Schema.decodeUnknownSync(FolderId)("inbox"),
              }),
            requireDraftCreate: ({ resource }) => Effect.succeed(resource),
          }),
          repositoryWith({
            createReplyDraft: () =>
              Effect.fail(
                new MailboxDomainError({
                  operation: "create-reply-draft",
                  reason: "validation",
                  message: "Reply target has too many recipients",
                })
              ),
          })
        )
      )
    ).rejects.toMatchObject({
      _tag: "MailboxReplyDraftCreationError",
      reason: "invalid-input",
    });
  });
});
