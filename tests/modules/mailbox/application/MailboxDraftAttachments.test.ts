import { UserId } from "@effect-auth/core/Identifiers";
import * as AuthPermission from "@effect-auth/core/Permission";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import { MailboxDraftAttachments } from "#/modules/mailbox/application/MailboxDraftAttachments";
import type { MailboxDraftAttachmentsService } from "#/modules/mailbox/application/MailboxDraftAttachments";
import { Sha256Digest } from "#/modules/mailbox/domain/Mailbox";
import {
  DraftAttachmentReservationSchema,
  DraftAttachmentUploadResult,
  ReserveDraftAttachmentCommand,
  UploadDraftAttachmentCommand,
} from "#/modules/mailbox/domain/MailboxDraftAttachment";
import { DraftAttachmentBlobStore } from "#/modules/mailbox/ports/DraftAttachmentBlobStore";
import type { DraftAttachmentBlobStoreService } from "#/modules/mailbox/ports/DraftAttachmentBlobStore";
import { MailboxAuthorization } from "#/modules/mailbox/ports/MailboxAuthorization";
import type { MailboxAuthorizationService } from "#/modules/mailbox/ports/MailboxAuthorization";
import { MailboxDraftRepository } from "#/modules/mailbox/ports/MailboxDraftRepository";
import type { MailboxDraftRepositoryService } from "#/modules/mailbox/ports/MailboxDraftRepository";

const digest = "a".repeat(64);
const reservation = Schema.decodeUnknownSync(DraftAttachmentReservationSchema)({
  createdAt: 1000,
  draftId: "draft-1",
  expiresAt: 901_000,
  fileName: "brief.pdf",
  id: "attachment-1",
  mailboxId: "primary",
  mimeType: "application/pdf",
  size: 3,
  status: "reserved",
});
const completion = Schema.decodeUnknownSync(DraftAttachmentUploadResult)({
  attachment: {
    ...reservation,
    contentSha256: digest,
    status: "stored",
    storedAt: 2000,
  },
  draftVersion: 2,
});
const unused = () => Effect.die(new Error("Unexpected repository operation"));
const unusedAuthorization = () =>
  Effect.die(new Error("Unexpected authorization operation"));

const repositoryWith = (
  overrides: Partial<MailboxDraftRepositoryService>
): MailboxDraftRepositoryService =>
  MailboxDraftRepository.of({
    completeDraftAttachment: unused,
    createDraft: unused,
    getDraft: unused,
    getDraftAttachment: unused,
    listDraftAttachments: unused,
    listDrafts: unused,
    reserveDraftAttachment: unused,
    updateDraft: unused,
    ...overrides,
  });

const authorizationWith = (
  requireAttachmentUpload: MailboxAuthorizationService["requireAttachmentUpload"]
) =>
  MailboxAuthorization.of({
    requireAttachmentRead: unusedAuthorization,
    requireInboundAttachmentDownload: unusedAuthorization,
    requireAttachmentUpload,
    requireDraft: unusedAuthorization,
    requireDraftCreate: unusedAuthorization,
    requireExport: unusedAuthorization,
    requireFolder: unusedAuthorization,
    requireFolderMessageRead: unusedAuthorization,
    requireMailbox: unusedAuthorization,
    requireMailboxDraftSend: unusedAuthorization,
    requireMailboxMessageRead: unusedAuthorization,
    requireMailboxMessageModify: unusedAuthorization,
    requireMessage: unusedAuthorization,
    requireRuleManage: unusedAuthorization,
  });

const runAttachments = <A>(
  authorization: MailboxAuthorizationService,
  repository: MailboxDraftRepositoryService,
  blobs: DraftAttachmentBlobStoreService,
  effect: (
    service: MailboxDraftAttachmentsService
  ) => Effect.Effect<A, unknown, AuthPermission.CurrentPrincipal>
) =>
  Effect.runPromise(
    MailboxDraftAttachments.pipe(
      Effect.flatMap(effect),
      Effect.provide(
        MailboxDraftAttachments.layerNoDeps.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(MailboxAuthorization, authorization),
              Layer.succeed(MailboxDraftRepository, repository),
              Layer.succeed(DraftAttachmentBlobStore, blobs)
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

describe("mailbox draft attachments", () => {
  it("authorizes before creating an identity-checked reservation", async () => {
    const calls: string[] = [];
    const command = Schema.decodeUnknownSync(ReserveDraftAttachmentCommand)({
      draftId: "draft-1",
      fileName: "brief.pdf",
      mailboxId: "primary",
      mimeType: "application/pdf",
      operationId: "reserve-1",
      size: 3,
    });
    const result = await runAttachments(
      authorizationWith(({ resource }) => {
        calls.push("authorize");
        return Effect.succeed(resource);
      }),
      repositoryWith({
        reserveDraftAttachment: (input) => {
          calls.push("reserve");
          expect(input).toStrictEqual(command);
          return Effect.succeed(reservation);
        },
      }),
      DraftAttachmentBlobStore.of({ store: unused }),
      (service) => service.reserve(command)
    );

    expect({ calls, result }).toMatchObject({
      calls: ["authorize", "reserve"],
      result: { id: "attachment-1", status: "reserved" },
    });
  });

  it("stores verified bytes before atomically completing the reservation", async () => {
    const calls: string[] = [];
    const command = Schema.decodeUnknownSync(UploadDraftAttachmentCommand)({
      attachmentId: "attachment-1",
      content: new Uint8Array([1, 2, 3]),
      draftId: "draft-1",
      mailboxId: "primary",
    });
    const result = await runAttachments(
      authorizationWith(({ resource }) => {
        calls.push("authorize");
        return Effect.succeed(resource);
      }),
      repositoryWith({
        getDraftAttachment: () => {
          calls.push("get");
          return Effect.succeed(reservation);
        },
        completeDraftAttachment: (input) => {
          calls.push("complete");
          expect(input.contentSha256).toBe(digest);
          return Effect.succeed(completion);
        },
      }),
      DraftAttachmentBlobStore.of({
        store: ({ content }) => {
          calls.push("store");
          expect([...content]).toStrictEqual([1, 2, 3]);
          return Effect.succeed(Schema.decodeUnknownSync(Sha256Digest)(digest));
        },
      }),
      (service) => service.upload(command)
    );

    expect({ calls, result }).toMatchObject({
      calls: ["authorize", "get", "store", "complete"],
      result: { draftVersion: 2 },
    });
  });

  it("rejects a size mismatch before touching blob storage", async () => {
    let stored = false;
    const error = await runAttachments(
      authorizationWith(({ resource }) => Effect.succeed(resource)),
      repositoryWith({
        getDraftAttachment: () => Effect.succeed(reservation),
      }),
      DraftAttachmentBlobStore.of({
        store: () => {
          stored = true;
          return Effect.die("must not store");
        },
      }),
      (service) =>
        service
          .upload(
            Schema.decodeUnknownSync(UploadDraftAttachmentCommand)({
              attachmentId: "attachment-1",
              content: new Uint8Array([1]),
              draftId: "draft-1",
              mailboxId: "primary",
            })
          )
          .pipe(Effect.flip)
    );

    expect({ error, stored }).toMatchObject({
      error: { _tag: "MailboxDraftAttachmentError", reason: "invalid-input" },
      stored: false,
    });
  });
});
