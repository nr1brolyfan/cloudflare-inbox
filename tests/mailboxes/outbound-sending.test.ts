import { UserId } from "@effect-auth/core/Identifiers";
import * as AuthPermission from "@effect-auth/core/Permission";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import type { MailAuthorization as MailAuthorizationService } from "#/authorization/mail-authorization";
import { MailAuthorization } from "#/authorization/mail-authorization";
import { MailboxDomainError } from "#/mailboxes/errors";
import { OutboundDeliverySchema } from "#/mailboxes/outbound";
import {
  MailboxOutboundSending,
  MailboxOutboundSendingLive,
  SendMailboxDraftCommand,
  SendMailboxDraftResult,
  UndoMailboxSendCommand,
} from "#/mailboxes/outbound-sending";
import type { MailboxRepository as MailboxRepositoryService } from "#/mailboxes/repository";
import { MailboxRepository } from "#/mailboxes/repository";

const scheduledDelivery = Schema.decodeUnknownSync(OutboundDeliverySchema)({
  attemptCount: 0,
  createdAt: 1000,
  id: "delivery-1",
  mailboxId: "primary",
  messageId: "message-1",
  sendAt: 11_000,
  status: "scheduled",
  updatedAt: 1000,
  version: 1,
});
const cancelledDelivery = Schema.decodeUnknownSync(OutboundDeliverySchema)({
  ...scheduledDelivery,
  cancelledAt: 2000,
  status: "cancelled",
  updatedAt: 2000,
  version: 2,
});
const scheduledResult = Schema.decodeUnknownSync(SendMailboxDraftResult)({
  delivery: scheduledDelivery,
  serverNow: 1000,
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
    getMessage: unused,
    getOutboundDelivery: unused,
    getThread: unused,
    listDraftAttachments: unused,
    listFolders: unused,
    listLabels: unused,
    listMessages: unused,
    moveMessage: unused,
    removeMessageLabel: unused,
    reserveDraftAttachment: unused,
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
    requireMailboxDraftSend: unusedAuthorization,
    requireMailboxMessageRead: unusedAuthorization,
    requireMessage: unusedAuthorization,
    requireRuleManage: unusedAuthorization,
    ...overrides,
  });

const runSending = <A>(
  authorization: MailAuthorizationService,
  repository: MailboxRepositoryService,
  use: (
    service: MailboxOutboundSending
  ) => Effect.Effect<A, unknown, AuthPermission.CurrentPrincipal>
) =>
  Effect.runPromise(
    MailboxOutboundSending.pipe(
      Effect.flatMap(use),
      Effect.provide(
        MailboxOutboundSendingLive.pipe(
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

describe("mailbox outbound sending", () => {
  it("authorizes the existing draft before scheduling without a sendAt", async () => {
    const calls: string[] = [];
    let repositoryInput: unknown;
    const command = Schema.decodeUnknownSync(SendMailboxDraftCommand)({
      draftId: "draft-1",
      expectedVersion: 3,
      mailboxId: "primary",
      operationId: "operation-send",
    });
    const result = await runSending(
      authorizationWith({
        requireDraft: ({ action, resource }) => {
          calls.push(`authorize-${action}`);
          return Effect.succeed(resource);
        },
      }),
      repositoryWith({
        scheduleOutbound: (input) => {
          calls.push("schedule");
          repositoryInput = input;
          return Effect.succeed(scheduledResult);
        },
      }),
      (service) => service.send(command)
    );

    expect(calls).toStrictEqual(["authorize-send", "schedule"]);
    expect(repositoryInput).toStrictEqual(command);
    expect(repositoryInput).not.toHaveProperty("sendAt");
    expect(result).toMatchObject({
      delivery: { id: "delivery-1", mailboxId: "primary" },
      serverNow: 1000,
    });
  });

  it("requires mailbox-scoped send capabilities before cancellation", async () => {
    const calls: string[] = [];
    let repositoryInput: unknown;
    const command = Schema.decodeUnknownSync(UndoMailboxSendCommand)({
      expectedVersion: 1,
      mailboxId: "primary",
      operationId: "operation-undo",
      outboundDeliveryId: "delivery-1",
    });
    const result = await runSending(
      authorizationWith({
        requireMailboxDraftSend: ({ resource }) => {
          calls.push("authorize");
          return Effect.succeed(resource);
        },
      }),
      repositoryWith({
        cancelOutboundDelivery: (input) => {
          calls.push("cancel");
          repositoryInput = input;
          return Effect.succeed(cancelledDelivery);
        },
      }),
      (service) => service.undo(command)
    );

    expect({ calls, repositoryInput, result }).toMatchObject({
      calls: ["authorize", "cancel"],
      repositoryInput: {
        expectedVersion: 1,
        mailboxId: "primary",
        operationId: "operation-undo",
        outboundDeliveryId: "delivery-1",
      },
      result: { id: "delivery-1", mailboxId: "primary", status: "cancelled" },
    });
  });

  it("maps a late undo and rejects mismatched delivery identity", async () => {
    const command = Schema.decodeUnknownSync(UndoMailboxSendCommand)({
      expectedVersion: 1,
      mailboxId: "primary",
      operationId: "operation-undo",
      outboundDeliveryId: "delivery-1",
    });
    const authorization = authorizationWith({
      requireMailboxDraftSend: ({ resource }) => Effect.succeed(resource),
    });
    const conflict = await runSending(
      authorization,
      repositoryWith({
        cancelOutboundDelivery: () =>
          Effect.fail(
            new MailboxDomainError({
              message: "Delivery is no longer scheduled",
              operation: "cancel-outbound",
              reason: "invalid-state",
              resourceId: "delivery-1",
              resourceType: "outbound",
            })
          ),
      }),
      (service) => service.undo(command).pipe(Effect.flip)
    );
    const mismatch = await runSending(
      authorization,
      repositoryWith({
        cancelOutboundDelivery: () =>
          Effect.succeed(
            Schema.decodeUnknownSync(OutboundDeliverySchema)({
              ...cancelledDelivery,
              id: "delivery-other",
            })
          ),
      }),
      (service) => service.undo(command).pipe(Effect.flip)
    );

    expect(conflict).toMatchObject({
      _tag: "MailboxOutboundSendingError",
      operation: "undo",
      reason: "conflict",
    });
    expect(mismatch).toMatchObject({
      _tag: "MailboxOutboundSendingError",
      operation: "undo",
      reason: "storage",
    });
  });
});
