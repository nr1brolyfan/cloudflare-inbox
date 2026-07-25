import { UserId } from "@effect-auth/core/Identifiers";
import * as AuthPermission from "@effect-auth/core/Permission";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  MailboxInboundAttachmentInput,
  MailboxInboundAttachmentReading,
} from "#/modules/mailbox/application/MailboxInboundAttachmentReading";
import { AttachmentId, FolderId } from "#/modules/mailbox/domain/Mailbox";
import {
  GetMessageResult,
  InboundAttachmentBlobLocation,
} from "#/modules/mailbox/domain/MailboxMessage";
import { InboundAttachmentBlobReader } from "#/modules/mailbox/ports/InboundAttachmentBlobReader";
import { MailboxAuthorization } from "#/modules/mailbox/ports/MailboxAuthorization";
import type { MailboxAuthorizationService } from "#/modules/mailbox/ports/MailboxAuthorization";
import { MailboxMessageRepository } from "#/modules/mailbox/ports/MailboxMessageRepository";
import type { MailboxMessageRepositoryService } from "#/modules/mailbox/ports/MailboxMessageRepository";

const message = Schema.decodeUnknownSync(GetMessageResult)({
  activityAt: 1000,
  attachments: [
    {
      disposition: "attachment",
      fileName: "résumé.pdf",
      id: "attachment-1",
      messageId: "message-1",
      mimeType: "application/pdf",
      size: 4,
    },
  ],
  bcc: [],
  cc: [],
  direction: "inbound",
  folderId: "inbox",
  hasAttachments: true,
  id: "message-1",
  labelIds: ["work"],
  mailboxId: "primary",
  read: false,
  receivedAt: 1000,
  recipients: [{ address: "owner@example.test" }],
  references: [],
  size: 4,
  snippet: "Preview",
  starred: false,
  subject: "Hello",
  threadId: "thread-1",
  to: [{ address: "owner@example.test" }],
  version: 1,
});
const location = Schema.decodeUnknownSync(InboundAttachmentBlobLocation)({
  attachmentId: "attachment-1",
  disposition: "attachment",
  fileName: "résumé.pdf",
  folderId: "inbox",
  inboundIngestId: "ingest-1",
  mailboxId: "primary",
  messageId: "message-1",
  mimeType: "application/pdf",
  receivedAt: 1000,
  size: 4,
  sourceIndex: 0,
});
const folderId = Schema.decodeUnknownSync(FolderId)("inbox");
const unused = () => Effect.die(new Error("Unexpected operation"));

const authorization = MailboxAuthorization.of({
  requireAttachmentRead: () =>
    Effect.succeed({
      _tag: "Attachment" as const,
      attachmentId: location.attachmentId,
      folderId,
      mailboxId: location.mailboxId,
      messageId: location.messageId,
    }),
  requireInboundAttachmentDownload: () =>
    Effect.succeed({
      _tag: "Attachment" as const,
      attachmentId: location.attachmentId,
      folderId,
      mailboxId: location.mailboxId,
      messageId: location.messageId,
    }),
  requireAttachmentUpload: unused,
  requireDraft: unused,
  requireDraftCreate: unused,
  requireExport: unused,
  requireFolder: unused,
  requireFolderMessageRead: ({ resource }) =>
    Effect.succeed({
      _tag: "FolderMessageRead" as const,
      folderId: resource.folderId,
      mailboxId: resource.mailboxId,
    }),
  requireMailbox: unused,
  requireMailboxDraftSend: unused,
  requireMailboxMessageRead: ({ resource }) => Effect.succeed(resource),
  requireMessage: ({ resource }) => Effect.succeed({ ...resource, folderId }),
  requireRuleManage: unused,
}) satisfies MailboxAuthorizationService;

const runRead = (
  input: unknown,
  overrides: {
    readonly authorizedAttachmentId?: string;
    readonly repositoryLocation?: typeof location;
  } = {}
) => {
  const repository = MailboxMessageRepository.of({
    addMessageLabel: unused,
    getAttachmentBlob: unused,
    getInboundAttachmentBlob: () =>
      Effect.succeed(overrides.repositoryLocation ?? location),
    getMessage: () => Effect.succeed(message),
    getThread: unused,
    listMessages: unused,
    moveMessage: unused,
    removeMessageLabel: unused,
    searchMessages: unused,
    setMessageRead: unused,
    setMessageStarred: unused,
  }) satisfies MailboxMessageRepositoryService;
  const auth = MailboxAuthorization.of({
    ...authorization,
    requireInboundAttachmentDownload: () =>
      Effect.succeed({
        _tag: "Attachment" as const,
        attachmentId:
          overrides.authorizedAttachmentId === undefined
            ? location.attachmentId
            : Schema.decodeUnknownSync(AttachmentId)(
                overrides.authorizedAttachmentId
              ),
        folderId,
        mailboxId: location.mailboxId,
        messageId: location.messageId,
      }),
  });
  return Effect.runPromise(
    Schema.decodeUnknownEffect(MailboxInboundAttachmentInput)(input).pipe(
      Effect.flatMap((decoded) =>
        MailboxInboundAttachmentReading.pipe(
          Effect.flatMap((reading) => reading.get(decoded))
        )
      ),
      Effect.provide(
        MailboxInboundAttachmentReading.layerNoDeps.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(MailboxAuthorization, auth),
              Layer.succeed(MailboxMessageRepository, repository),
              Layer.succeed(
                InboundAttachmentBlobReader,
                InboundAttachmentBlobReader.of({
                  read: () => Effect.succeed(new Uint8Array([0, 1, 2, 255])),
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
};

const validInput = {
  _tag: "Folder",
  attachmentId: "attachment-1",
  folderId: "inbox",
  mailboxId: "primary",
  messageId: "message-1",
} as const;

describe("mailbox inbound attachment reading", () => {
  it("returns exact ordinary inbound bytes after all ancestry checks", async () => {
    await expect(runRead(validInput)).resolves.toStrictEqual({
      bytes: new Uint8Array([0, 1, 2, 255]),
      fileName: "résumé.pdf",
      mimeType: "application/pdf",
    });
  });

  it.each([
    ["mailbox", { ...validInput, mailboxId: "other" }],
    ["message", { ...validInput, messageId: "message-2" }],
    ["attachment", { ...validInput, attachmentId: "attachment-2" }],
    ["folder", { ...validInput, folderId: "trash" }],
  ])("conceals a cross-%s identifier", async (_name, input) => {
    await expect(runRead(input)).rejects.toMatchObject({
      _tag: "MailboxInboundAttachmentError",
      reason: "not-found",
    });
  });

  it("fails closed when attachment authorization resolves another attachment", async () => {
    await expect(
      runRead(validInput, { authorizedAttachmentId: "attachment-2" })
    ).rejects.toMatchObject({ reason: "not-found" });
  });
});
