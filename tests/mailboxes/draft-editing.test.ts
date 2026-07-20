import { UserId } from "@effect-auth/core/Identifiers";
import * as AuthPermission from "@effect-auth/core/Permission";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import type { MailAuthorization as MailAuthorizationService } from "#/authorization/mail-authorization";
import { MailAuthorization } from "#/authorization/mail-authorization";
import {
  CreateMailboxDraftCommand,
  MailboxDraftEditing,
  MailboxDraftEditingLive,
  UpdateMailboxDraftCommand,
} from "#/mailboxes/draft-editing";
import { DraftSchema } from "#/mailboxes/drafts";
import { MailboxDomainError } from "#/mailboxes/errors";
import type { MailboxRepository as MailboxRepositoryService } from "#/mailboxes/repository";
import { MailboxRepository } from "#/mailboxes/repository";

const existingDraft = Schema.decodeUnknownSync(DraftSchema)({
  attachmentIds: ["attachment-1"],
  bcc: [],
  cc: [{ address: "copy@example.test" }],
  createdAt: 1000,
  htmlBody: "<p>Existing HTML</p>",
  id: "draft-1",
  inReplyToMessageId: "message-1",
  mailboxId: "primary",
  subject: "Existing subject",
  textBody: "Existing body",
  threadId: "thread-1",
  to: [{ address: "person@example.test" }],
  updatedAt: 1000,
  version: 1,
});
const updatedDraft = Schema.decodeUnknownSync(DraftSchema)({
  ...existingDraft,
  subject: "Updated subject",
  textBody: "Updated body",
  updatedAt: 2000,
  version: 2,
});
const unused = () => Effect.die(new Error("Unexpected repository operation"));
const unusedAuthorization = () =>
  Effect.die(new Error("Unexpected authorization operation"));

const repositoryWith = (
  overrides: Partial<MailboxRepositoryService>
): MailboxRepositoryService =>
  MailboxRepository.of({
    addMessageLabel: unused,
    cancelOutboundDelivery: unused,
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
    getMessage: unused,
    getOutboundDelivery: unused,
    getThread: unused,
    listFolders: unused,
    listLabels: unused,
    listMessages: unused,
    moveMessage: unused,
    removeMessageLabel: unused,
    renameFolder: unused,
    renameLabel: unused,
    resendOutbound: unused,
    scheduleOutbound: unused,
    searchMessages: unused,
    setMessageRead: unused,
    setMessageStarred: unused,
    updateDraft: unused,
    ...overrides,
  });

const authorizationWith = (
  overrides: Partial<MailAuthorizationService>
): MailAuthorizationService =>
  MailAuthorization.of({
    requireAttachmentRead: unusedAuthorization,
    requireAttachmentUpload: unusedAuthorization,
    requireDraft: unusedAuthorization,
    requireDraftCreate: unusedAuthorization,
    requireExport: unusedAuthorization,
    requireFolder: unusedAuthorization,
    requireFolderMessageRead: unusedAuthorization,
    requireMailbox: unusedAuthorization,
    requireMailboxMessageRead: unusedAuthorization,
    requireMessage: unusedAuthorization,
    requireRuleManage: unusedAuthorization,
    ...overrides,
  });

const runEditing = <A>(
  authorization: MailAuthorizationService,
  repository: MailboxRepositoryService,
  effect: (
    service: MailboxDraftEditing
  ) => Effect.Effect<A, unknown, AuthPermission.CurrentPrincipal>
) =>
  Effect.runPromise(
    MailboxDraftEditing.pipe(
      Effect.flatMap(effect),
      Effect.provide(
        MailboxDraftEditingLive.pipe(
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

describe("mailbox draft editing", () => {
  it("authorizes create before storing only editor-visible content", async () => {
    const calls: string[] = [];
    let repositoryInput: unknown;
    const command = Schema.decodeUnknownSync(CreateMailboxDraftCommand)({
      content: {
        bcc: [],
        cc: [],
        subject: "New draft",
        textBody: "A plain-text message",
        to: [{ address: "person@example.test" }],
      },
      mailboxId: "primary",
      operationId: "operation-create",
    });
    const result = await runEditing(
      authorizationWith({
        requireDraftCreate: ({ resource }) => {
          calls.push("authorize");
          return Effect.succeed(resource);
        },
      }),
      repositoryWith({
        createDraft: (input) => {
          calls.push("create");
          repositoryInput = input;
          return Effect.succeed(
            Schema.decodeUnknownSync(DraftSchema)({
              ...input.content,
              createdAt: 1000,
              id: "draft-new",
              mailboxId: input.mailboxId,
              updatedAt: 1000,
              version: 1,
            })
          );
        },
      }),
      (service) => service.create(command)
    );

    expect({ calls, repositoryInput, result }).toMatchObject({
      calls: ["authorize", "create"],
      repositoryInput: {
        content: {
          attachmentIds: [],
          bcc: [],
          cc: [],
          subject: "New draft",
          textBody: "A plain-text message",
          to: [{ address: "person@example.test" }],
        },
        mailboxId: "primary",
        operationId: "operation-create",
      },
      result: {
        content: { subject: "New draft" },
        id: "draft-new",
        mailboxId: "primary",
        version: 1,
      },
    });
  });

  it("preserves reply, HTML, and attachment fields during a CAS update", async () => {
    const calls: string[] = [];
    let repositoryInput: unknown;
    const command = Schema.decodeUnknownSync(UpdateMailboxDraftCommand)({
      content: {
        bcc: [],
        cc: [],
        subject: "Updated subject",
        textBody: "Updated body",
        to: [{ address: "next@example.test" }],
      },
      draftId: "draft-1",
      expectedVersion: 1,
      mailboxId: "primary",
      operationId: "operation-update",
    });
    const result = await runEditing(
      authorizationWith({
        requireDraftCreate: ({ resource }) => {
          calls.push("authorize-mailbox");
          return Effect.succeed(resource);
        },
        requireDraft: ({ resource }) => {
          calls.push("authorize-draft");
          return Effect.succeed(resource);
        },
      }),
      repositoryWith({
        getDraft: () => {
          calls.push("get");
          return Effect.succeed(existingDraft);
        },
        updateDraft: (input) => {
          calls.push("update");
          repositoryInput = input;
          return Effect.succeed(updatedDraft);
        },
      }),
      (service) => service.update(command)
    );

    expect(calls).toStrictEqual([
      "authorize-mailbox",
      "authorize-draft",
      "get",
      "update",
    ]);
    expect(repositoryInput).toMatchObject({
      content: {
        attachmentIds: ["attachment-1"],
        htmlBody: "<p>Existing HTML</p>",
        inReplyToMessageId: "message-1",
        subject: "Updated subject",
        threadId: "thread-1",
        to: [{ address: "next@example.test" }],
      },
      draftId: "draft-1",
      expectedVersion: 1,
      operationId: "operation-update",
    });
    expect(result).toMatchObject({
      content: { subject: "Updated subject", textBody: "Updated body" },
      version: 2,
    });
    expect(result).not.toHaveProperty("attachmentIds");
    expect(result).not.toHaveProperty("htmlBody");
  });

  it("exposes a stable conflict without retrying the repository", async () => {
    let attempts = 0;
    const command = Schema.decodeUnknownSync(UpdateMailboxDraftCommand)({
      content: { bcc: [], cc: [], subject: "Changed", to: [] },
      draftId: "draft-1",
      expectedVersion: 1,
      mailboxId: "primary",
      operationId: "operation-conflict",
    });
    const error = await runEditing(
      authorizationWith({
        requireDraft: ({ resource }) => Effect.succeed(resource),
        requireDraftCreate: ({ resource }) => Effect.succeed(resource),
      }),
      repositoryWith({
        getDraft: () => Effect.succeed(existingDraft),
        updateDraft: () => {
          attempts += 1;
          return Effect.fail(
            new MailboxDomainError({
              message: "Draft version changed",
              operation: "update-draft",
              reason: "version-conflict",
              resourceId: "draft-1",
              resourceType: "draft",
            })
          );
        },
      }),
      (service) => service.update(command).pipe(Effect.flip)
    );

    expect({ attempts, error }).toMatchObject({
      attempts: 1,
      error: { _tag: "MailboxDraftEditingError", reason: "conflict" },
    });
  });
});
