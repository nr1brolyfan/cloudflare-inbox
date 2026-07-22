import { UserId } from "@effect-auth/core/Identifiers";
import * as AuthPermission from "@effect-auth/core/Permission";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import type { MailAuthorization as MailAuthorizationService } from "#/authorization/mail-authorization";
import { MailAuthorization } from "#/authorization/mail-authorization";
import { DraftSchema } from "#/mailboxes/drafts";
import { MailboxDomainError } from "#/mailboxes/errors";
import {
  CreateMailboxDraftCommand,
  MailboxDraftEditing,
  UpdateMailboxDraftCommand,
} from "#/modules/mailbox/application/MailboxDraftEditing";
import type { MailboxDraftEditingService } from "#/modules/mailbox/application/MailboxDraftEditing";
import {
  MailboxDraftListInput,
  MailboxDraftListResult,
  MailboxDraftReading,
} from "#/modules/mailbox/application/MailboxDraftReading";
import { MailboxDraftRepository } from "#/modules/mailbox/ports/MailboxDraftRepository";
import type { MailboxDraftRepositoryService } from "#/modules/mailbox/ports/MailboxDraftRepository";

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
const newDraft = Schema.decodeUnknownSync(DraftSchema)({
  attachmentIds: [],
  bcc: [],
  cc: [],
  createdAt: 1000,
  id: "draft-new",
  mailboxId: "primary",
  subject: "New draft",
  textBody: "A plain-text message",
  to: [{ address: "person@example.test" }],
  updatedAt: 1000,
  version: 1,
});
const unused = () => Effect.die(new Error("Unexpected repository operation"));
const unusedAuthorization = () =>
  Effect.die(new Error("Unexpected authorization operation"));

const repositoryWith = (
  overrides: Partial<MailboxDraftRepositoryService>
): MailboxDraftRepositoryService =>
  MailboxDraftRepository.of({
    createDraft: unused,
    getDraft: unused,
    listDraftAttachments: () => Effect.succeed({ items: [] }),
    listDrafts: unused,
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
    requireMailboxDraftSend: unusedAuthorization,
    requireMailboxMessageRead: unusedAuthorization,
    requireMessage: unusedAuthorization,
    requireRuleManage: unusedAuthorization,
    ...overrides,
  });

const runEditing = <A>(
  authorization: MailAuthorizationService,
  repository: MailboxDraftRepositoryService,
  effect: (
    service: MailboxDraftEditingService
  ) => Effect.Effect<A, unknown, AuthPermission.CurrentPrincipal>
) =>
  Effect.runPromise(
    MailboxDraftEditing.pipe(
      Effect.flatMap(effect),
      Effect.provide(
        MailboxDraftEditing.layerNoDeps.pipe(
          Layer.provide(
            Layer.merge(
              Layer.succeed(MailAuthorization, authorization),
              Layer.succeed(MailboxDraftRepository, repository)
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
  it("authorizes collection listing with draft.create", async () => {
    const calls: string[] = [];
    const input = Schema.decodeUnknownSync(MailboxDraftListInput)({
      mailboxId: "primary",
      page: { limit: 10 },
    });
    const page = Schema.decodeUnknownSync(MailboxDraftListResult)({
      items: [
        {
          hasAttachments: false,
          id: "draft-1",
          mailboxId: "primary",
          recipients: [{ address: "person@example.test" }],
          snippet: "Preview",
          subject: "Draft",
          updatedAt: 1000,
          version: 1,
        },
      ],
    });
    const result = await Effect.runPromise(
      MailboxDraftReading.pipe(
        Effect.flatMap((reading) => reading.list(input)),
        Effect.provide(
          MailboxDraftReading.layerNoDeps.pipe(
            Layer.provide(
              Layer.merge(
                Layer.succeed(
                  MailAuthorization,
                  authorizationWith({
                    requireDraftCreate: ({ resource }) => {
                      calls.push(`authorize:${resource.mailboxId}`);
                      return Effect.succeed(resource);
                    },
                  })
                ),
                Layer.succeed(
                  MailboxDraftRepository,
                  repositoryWith({
                    listDrafts: (query) => {
                      calls.push(`list:${query.mailboxId}`);
                      return Effect.succeed(page);
                    },
                  })
                )
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

    expect({ calls, result }).toMatchObject({
      calls: ["authorize:primary", "list:primary"],
      result: { items: [{ id: "draft-1", snippet: "Preview" }] },
    });
  });

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
          return Effect.succeed(newDraft);
        },
        getDraft: () => Effect.succeed(newDraft),
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
    let draftReads = 0;
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
          draftReads += 1;
          return Effect.succeed(
            draftReads === 1 ? existingDraft : updatedDraft
          );
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
      "get",
      "get",
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
