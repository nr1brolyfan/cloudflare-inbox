import { UserId } from "@effect-auth/core/Identifiers";
import * as AuthPermission from "@effect-auth/core/Permission";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import type { MailAuthorization as MailAuthorizationService } from "#/authorization/mail-authorization";
import { MailAuthorization } from "#/authorization/mail-authorization";
import { MailboxDomainError, MailboxRepositoryError } from "#/mailboxes/errors";
import { OutboundDeliverySchema } from "#/mailboxes/outbound";
import {
  GetMailboxOutboundDeliveryQuery,
  MailboxOutboundDeliveryReading,
  MailboxOutboundDeliveryReadingClock,
  MailboxOutboundDeliveryReadingLive,
} from "#/mailboxes/outbound-delivery-reading";
import type { MailboxRepository as MailboxRepositoryService } from "#/mailboxes/repository";
import { MailboxRepository } from "#/mailboxes/repository";

const delivery = Schema.decodeUnknownSync(OutboundDeliverySchema)({
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
const query = Schema.decodeUnknownSync(GetMailboxOutboundDeliveryQuery)({
  mailboxId: "primary",
  outboundDeliveryId: "delivery-1",
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

const runReading = <A>(
  authorization: MailAuthorizationService,
  repository: MailboxRepositoryService,
  use: (
    service: MailboxOutboundDeliveryReading
  ) => Effect.Effect<A, unknown, AuthPermission.CurrentPrincipal>
) =>
  Effect.runPromise(
    MailboxOutboundDeliveryReading.pipe(
      Effect.flatMap(use),
      Effect.provide(
        MailboxOutboundDeliveryReadingLive.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(MailAuthorization, authorization),
              Layer.succeed(MailboxRepository, repository),
              Layer.succeed(
                MailboxOutboundDeliveryReadingClock,
                MailboxOutboundDeliveryReadingClock.of({ now: () => 2500 })
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

describe("mailbox outbound delivery reading", () => {
  it("authorizes before loading and returns the explicit observation time", async () => {
    const calls: string[] = [];
    const result = await runReading(
      authorizationWith({
        requireMailboxDraftSend: ({ resource }) => {
          calls.push("authorize");
          return Effect.succeed(resource);
        },
      }),
      repositoryWith({
        getOutboundDelivery: (input) => {
          calls.push("get");
          expect(input).toStrictEqual(query);
          return Effect.succeed(delivery);
        },
      }),
      (service) => service.get(query)
    );

    expect(calls).toStrictEqual(["authorize", "get"]);
    expect(result).toStrictEqual({ delivery, serverNow: 2500 });
  });

  it("maps missing deliveries separately from storage failures", async () => {
    const authorization = authorizationWith({
      requireMailboxDraftSend: ({ resource }) => Effect.succeed(resource),
    });
    const missing = await runReading(
      authorization,
      repositoryWith({
        getOutboundDelivery: () =>
          Effect.fail(
            new MailboxDomainError({
              message: "Missing outbound delivery",
              operation: "get-outbound",
              reason: "not-found",
              resourceId: "delivery-1",
              resourceType: "outbound",
            })
          ),
      }),
      (service) => service.get(query).pipe(Effect.flip)
    );
    const storage = await runReading(
      authorization,
      repositoryWith({
        getOutboundDelivery: () =>
          Effect.fail(
            new MailboxRepositoryError({
              cause: new Error("D1 unavailable"),
              commitState: "not-committed",
              message: "Read failed",
              operation: "read",
            })
          ),
      }),
      (service) => service.get(query).pipe(Effect.flip)
    );

    expect(missing).toMatchObject({
      _tag: "MailboxOutboundDeliveryReadingError",
      reason: "not-found",
    });
    expect(storage).toMatchObject({
      _tag: "MailboxOutboundDeliveryReadingError",
      reason: "storage",
    });
  });

  it("rejects mailbox and delivery identity mismatches", async () => {
    const error = await runReading(
      authorizationWith({
        requireMailboxDraftSend: ({ resource }) => Effect.succeed(resource),
      }),
      repositoryWith({
        getOutboundDelivery: () =>
          Effect.succeed(
            Schema.decodeUnknownSync(OutboundDeliverySchema)({
              ...delivery,
              id: "delivery-other",
            })
          ),
      }),
      (service) => service.get(query).pipe(Effect.flip)
    );

    expect(error).toMatchObject({
      _tag: "MailboxOutboundDeliveryReadingError",
      reason: "storage",
    });
  });
});
