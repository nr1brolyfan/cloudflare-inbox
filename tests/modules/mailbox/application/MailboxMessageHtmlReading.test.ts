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
import { GetMessageResult } from "#/mailboxes/messages";
import {
  MailboxMessageHtmlInput,
  MailboxMessageHtmlReading,
  mailboxMessageHtmlCsp,
  renderSandboxedMessageHtml,
} from "#/modules/mailbox/application/MailboxMessageHtmlReading";
import { MailboxMessageRepository } from "#/modules/mailbox/ports/MailboxMessageRepository";
import type { MailboxMessageRepositoryService } from "#/modules/mailbox/ports/MailboxMessageRepository";

const message = Schema.decodeUnknownSync(GetMessageResult)({
  activityAt: 1000,
  attachments: [],
  bcc: [],
  cc: [],
  direction: "inbound",
  folderId: "inbox",
  hasAttachments: false,
  htmlBody:
    '<meta http-equiv="refresh" content="0;https://tracker.test"><base href="https://tracker.test"><script>alert(1)</script><a href="https://tracker.test" ping="https://tracker.test/ping" onclick="alert(1)">Open</a><form action="https://tracker.test"><button formaction="https://tracker.test">Send</button></form><img src="https://tracker.test/pixel">',
  id: "message-1",
  labelIds: ["work"],
  mailboxId: "primary",
  read: false,
  receivedAt: 1000,
  recipients: [{ address: "owner@example.test" }],
  references: [],
  sender: { address: "sender@example.test" },
  size: 100,
  snippet: "Preview",
  starred: false,
  subject: "Hello",
  textBody: "Hello",
  threadId: "thread-1",
  to: [{ address: "owner@example.test" }],
  version: 1,
});
const inboxFolderId = Schema.decodeUnknownSync(FolderId)("inbox");
const unused = () => Effect.die(new Error("Unexpected repository operation"));
const unusedAuthorization = () =>
  Effect.die(new Error("Unexpected authorization operation"));

const repositoryWithMessage = (
  value = message
): MailboxMessageRepositoryService =>
  MailboxMessageRepository.of({
    getMessage: () => Effect.succeed(value),
    getThread: unused,
    listMessages: unused,
    moveMessage: unused,
    searchMessages: unused,
    setMessageRead: unused,
    setMessageStarred: unused,
  });

const authorization = MailAuthorization.of({
  requireAttachmentRead: unusedAuthorization,
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
  requireMessage: ({ resource }) =>
    Effect.succeed({ ...resource, folderId: inboxFolderId }),
  requireRuleManage: unusedAuthorization,
}) satisfies MailAuthorizationService;

const runHtmlRead = (
  input: Schema.Schema.Type<typeof MailboxMessageHtmlInput>,
  repository = repositoryWithMessage(),
  authorizationService = authorization
) =>
  Effect.runPromise(
    MailboxMessageHtmlReading.pipe(
      Effect.flatMap((reading) => reading.get(input)),
      Effect.provide(
        MailboxMessageHtmlReading.layerNoDeps.pipe(
          Layer.provide(
            Layer.merge(
              Layer.succeed(MailAuthorization, authorizationService),
              Layer.succeed(MailboxMessageRepository, repository)
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

describe("mailbox message HTML", () => {
  it("removes execution and navigation primitives while preserving content", () => {
    const document = renderSandboxedMessageHtml(message.htmlBody ?? "");

    expect({
      hasBlockedImage: document.includes("<img>"),
      hasContent: document.includes("Open"),
      hasCspDefault: mailboxMessageHtmlCsp.includes("default-src 'none'"),
      hasCspSandbox: mailboxMessageHtmlCsp.includes("sandbox"),
      hasExternalLink: document.includes('href="https://tracker.test/"'),
      hasLinkIsolation: document.includes('rel="noopener noreferrer nofollow"'),
      hasNewContext: document.includes('target="_blank"'),
      hasUnsafePrimitive:
        /<script|<meta|<base|tracker\.test\/pixel|\sping=|\sonclick=|\saction=|\sformaction=/u.test(
          document
        ),
    }).toStrictEqual({
      hasBlockedImage: true,
      hasContent: true,
      hasCspDefault: true,
      hasCspSandbox: true,
      hasExternalLink: true,
      hasLinkIsolation: true,
      hasNewContext: true,
      hasUnsafePrimitive: false,
    });
  });

  it("rewrites only unambiguous CID images and safe absolute links", () => {
    const document = renderSandboxedMessageHtml(
      '<html data-preview-status="500"><body><img src="cid:image%40mail.test" srcset="https://tracker.test/2x 2x"><img src="https://tracker.test/pixel"><a href="mailto:owner@example.test">Mail</a><a href="/relative">Relative</a><a href="javascript:alert(1)">Script</a></body></html>',
      {
        cidUrlByContentId: new Map([["image@mail.test", "/safe/attachment"]]),
      }
    );

    expect(document).toContain('<img src="/safe/attachment">');
    expect(document).toContain('href="mailto:owner@example.test"');
    expect(document).not.toMatch(
      /data-preview-(?:access-failure|status)|tracker\.test|srcset=|href="\/relative|javascript:/u
    );
  });

  it("authorizes and returns HTML only for the requested view", async () => {
    const folderInput = Schema.decodeUnknownSync(MailboxMessageHtmlInput)({
      _tag: "Folder",
      folderId: "inbox",
      mailboxId: "primary",
      messageId: "message-1",
    });
    const result = await runHtmlRead(folderInput);

    expect(result.document).toContain("Open");
    await expect(
      runHtmlRead(
        Schema.decodeUnknownSync(MailboxMessageHtmlInput)({
          _tag: "Label",
          labelId: "other",
          mailboxId: "primary",
          messageId: "message-1",
        })
      )
    ).rejects.toMatchObject({
      _tag: "MailboxMessageHtmlError",
      reason: "not-found",
    });
  });

  it("binds a unique safe CID to an attachment-ID route", async () => {
    const folderInput = Schema.decodeUnknownSync(MailboxMessageHtmlInput)({
      _tag: "Folder",
      folderId: "inbox",
      mailboxId: "primary",
      messageId: "message-1",
    });
    const withCid = Schema.decodeUnknownSync(GetMessageResult)({
      ...Schema.encodeSync(GetMessageResult)(message),
      attachments: [
        {
          contentId: "image@mail.test",
          disposition: "inline",
          fileName: "image.png",
          id: "attachment-1",
          messageId: "message-1",
          mimeType: "image/png",
          size: 3,
        },
      ],
      hasAttachments: true,
      htmlBody: '<p>Hello</p><img src="cid:image%40mail.test">',
    });
    const result = await runHtmlRead(
      folderInput,
      repositoryWithMessage(withCid)
    );

    expect(result.document).toContain(
      'src="/api/mailboxes/primary/messages/message-1/attachments/attachment-1/inline?folder=inbox"'
    );
  });

  it("fails closed when any two MIME parts share a Content-ID", async () => {
    const folderInput = Schema.decodeUnknownSync(MailboxMessageHtmlInput)({
      _tag: "Folder",
      folderId: "inbox",
      mailboxId: "primary",
      messageId: "message-1",
    });
    const withDuplicateCid = Schema.decodeUnknownSync(GetMessageResult)({
      ...Schema.encodeSync(GetMessageResult)(message),
      attachments: [
        {
          contentId: "image@mail.test",
          disposition: "inline",
          fileName: "image.png",
          id: "attachment-1",
          messageId: "message-1",
          mimeType: "image/png",
          size: 3,
        },
        {
          contentId: "image@mail.test",
          disposition: "attachment",
          fileName: "document.pdf",
          id: "attachment-2",
          messageId: "message-1",
          mimeType: "application/pdf",
          size: 4,
        },
      ],
      hasAttachments: true,
      htmlBody: '<img src="cid:image%40mail.test">',
    });
    const result = await runHtmlRead(
      folderInput,
      repositoryWithMessage(withDuplicateCid)
    );

    expect(result.document).not.toContain("/attachments/");
  });

  it("conceals messages outside a folder-scoped grant", async () => {
    const folderInput = Schema.decodeUnknownSync(MailboxMessageHtmlInput)({
      _tag: "Folder",
      folderId: "inbox",
      mailboxId: "primary",
      messageId: "message-1",
    });
    const deniedAuthorization = MailAuthorization.of({
      ...authorization,
      requireMessage: () =>
        Effect.fail(
          new AuthPolicy.AuthorizationError({ reason: "missing-permission" })
        ),
    });

    await expect(
      runHtmlRead(folderInput, repositoryWithMessage(), deniedAuthorization)
    ).rejects.toMatchObject({
      _tag: "MailboxMessageHtmlError",
      reason: "not-found",
    });
  });
});
