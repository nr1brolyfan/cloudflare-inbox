import { UserId } from "@effect-auth/core/Identifiers";
import * as AuthPermission from "@effect-auth/core/Permission";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  MailboxInlineAttachmentInput,
  MailboxInlineAttachmentReading,
} from "#/modules/mailbox/application/MailboxInlineAttachmentReading";
import { FolderId } from "#/modules/mailbox/domain/Mailbox";
import {
  AttachmentBlobLocation,
  GetMessageResult,
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
      contentId: "image-1",
      disposition: "inline",
      fileName: "image.png",
      id: "attachment-1",
      messageId: "message-1",
      mimeType: "image/png",
      size: 3,
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
  size: 3,
  snippet: "Preview",
  starred: false,
  subject: "Hello",
  threadId: "thread-1",
  to: [{ address: "owner@example.test" }],
  version: 1,
});
const blobLocation = Schema.decodeUnknownSync(AttachmentBlobLocation)({
  attachmentId: "attachment-1",
  contentId: "image-1",
  disposition: "inline",
  fileName: "image.png",
  folderId: "inbox",
  inboundIngestId: "ingest-1",
  mailboxId: "primary",
  messageId: "message-1",
  mimeType: "image/png",
  receivedAt: 1000,
  size: 3,
  sourceIndex: 0,
});
const folderId = Schema.decodeUnknownSync(FolderId)("inbox");
const unused = () => Effect.die(new Error("Unexpected repository operation"));
const unusedAuthorization = () =>
  Effect.die(new Error("Unexpected authorization operation"));

const repository = MailboxMessageRepository.of({
  addMessageLabel: unused,
  batchMutateMessages: unused,
  getAttachmentBlob: () => Effect.succeed(blobLocation),
  getInboundAttachmentBlob: unused,
  getMessage: () => Effect.succeed(message),
  getThread: unused,
  listMessages: unused,
  moveMessage: unused,
  removeMessageLabel: unused,
  searchMessages: unused,
  setMessageRead: unused,
  setMessageStarred: unused,
  setThreadRead: unused,
}) satisfies MailboxMessageRepositoryService;

const authorization = MailboxAuthorization.of({
  requireAttachmentRead: () =>
    Effect.succeed({
      _tag: "Attachment" as const,
      attachmentId: blobLocation.attachmentId,
      folderId,
      mailboxId: blobLocation.mailboxId,
      messageId: blobLocation.messageId,
    }),
  requireInboundAttachmentDownload: unusedAuthorization,
  requireAttachmentUpload: unusedAuthorization,
  requireDraft: unusedAuthorization,
  requireDraftCreate: unusedAuthorization,
  requireExport: unusedAuthorization,
  requireFolder: unusedAuthorization,
  requireFolderMessageRead: ({ resource }) =>
    Effect.succeed({
      _tag: "FolderMessageRead" as const,
      folderId: resource.folderId,
      mailboxId: resource.mailboxId,
    }),
  requireMailbox: unusedAuthorization,
  requireMailboxDraftSend: unusedAuthorization,
  requireMailboxMessageRead: ({ resource }) => Effect.succeed(resource),
  requireMailboxMessageModify: unusedAuthorization,
  requireMessage: ({ resource }) => Effect.succeed({ ...resource, folderId }),
  requireRuleManage: unusedAuthorization,
}) satisfies MailboxAuthorizationService;

const runRead = (input: unknown) =>
  Effect.runPromise(
    Schema.decodeUnknownEffect(MailboxInlineAttachmentInput)(input).pipe(
      Effect.flatMap((decoded) =>
        MailboxInlineAttachmentReading.pipe(
          Effect.flatMap((reading) => reading.get(decoded))
        )
      ),
      Effect.provide(
        MailboxInlineAttachmentReading.layerNoDeps.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(MailboxAuthorization, authorization),
              Layer.succeed(MailboxMessageRepository, repository),
              Layer.succeed(
                InboundAttachmentBlobReader,
                InboundAttachmentBlobReader.of({
                  read: () => Effect.succeed(new Uint8Array([1, 2, 3])),
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

describe("mailbox inline attachment reading", () => {
  it("loads bytes only after matching view and attachment authorization", async () => {
    await expect(
      runRead({
        _tag: "Folder",
        attachmentId: "attachment-1",
        folderId: "inbox",
        mailboxId: "primary",
        messageId: "message-1",
      })
    ).resolves.toStrictEqual({
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: "image/png",
    });
  });

  it("conceals an attachment outside the selected label", async () => {
    await expect(
      runRead({
        _tag: "Label",
        attachmentId: "attachment-1",
        labelId: "other",
        mailboxId: "primary",
        messageId: "message-1",
      })
    ).rejects.toMatchObject({
      _tag: "MailboxInlineAttachmentError",
      reason: "not-found",
    });
  });
});
