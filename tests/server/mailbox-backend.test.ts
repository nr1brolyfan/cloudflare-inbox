import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import { MailboxInlineAttachmentInput } from "#/mailboxes/attachment-reading";
import { GetDraftAttachmentInput } from "#/mailboxes/draft-attachments";
import {
  CreateMailboxDraftCommand,
  GetMailboxDraftQuery,
} from "#/mailboxes/draft-editing";
import { MailboxDraftListInput } from "#/mailboxes/draft-reading";
import { MailboxMessageActionCommand } from "#/mailboxes/message-actions";
import { MailboxMessageHtmlInput } from "#/mailboxes/message-html";
import {
  MailboxMessageListInput,
  OpenMailboxThreadInput,
} from "#/mailboxes/message-reading";
import { GetMailboxOutboundDeliveryQuery } from "#/mailboxes/outbound-delivery-reading";
import {
  SendMailboxDraftCommand,
  UndoMailboxSendCommand,
} from "#/mailboxes/outbound-sending";
import type { MailboxBackendOperationsShape } from "#/server/mailbox-backend";
import {
  MailboxBackendOperations,
  MailboxBackendOperationsLive,
} from "#/server/mailbox-backend";
import { BackendClient } from "#/server/website-platform";

const mailbox = {
  createdAt: 1000,
  createdByUserId: "user-a",
  displayName: "Inbox",
  id: "primary",
  status: "active",
  updatedAt: 1000,
  version: 1,
} as const;
const navigation = {
  mailbox: { displayName: "Inbox", id: "primary" },
  folders: [
    {
      id: "inbox",
      kind: "inbox",
      messageCount: 4,
      name: "Inbox",
      unreadCount: 2,
    },
  ],
  labels: [],
} as const;
const messages = {
  items: [
    {
      activityAt: 2000,
      direction: "inbound",
      folderId: "inbox",
      hasAttachments: false,
      id: "message-1",
      read: false,
      recipients: [{ address: "owner@example.test" }],
      sender: { address: "sender@example.test" },
      snippet: "Preview",
      starred: false,
      subject: "Hello",
      threadId: "thread-1",
      version: 1,
    },
  ],
} as const;
const thread = {
  hasMore: false,
  messages: [
    {
      activityAt: 2000,
      attachments: [],
      cc: [],
      direction: "inbound",
      hasHtmlBody: false,
      id: "message-1",
      read: false,
      sender: { address: "sender@example.test" },
      textBody: "Body",
      to: [{ address: "owner@example.test" }],
    },
  ],
  thread: {
    id: "thread-1",
    latestActivityAt: 2000,
    messageCount: 1,
    subject: "Hello",
    unreadCount: 1,
  },
} as const;
const messageAction = {
  folderId: "archive",
  id: "message-1",
  read: false,
  starred: false,
  version: 2,
} as const;
const messageHtml = {
  _tag: "Label",
  document: "<html><body><p>Hello</p></body></html>",
  labelId: "work/urgent",
  mailboxId: "team/primary",
  messageId: "message/one",
} as const;
const draft = {
  attachments: [],
  content: {
    bcc: [],
    cc: [],
    subject: "Quarterly update",
    textBody: "Draft body",
    to: [{ address: "person@example.test" }],
  },
  createdAt: 1000,
  id: "draft/one",
  mailboxId: "team/primary",
  updatedAt: 1000,
  version: 1,
} as const;
const drafts = {
  items: [
    {
      hasAttachments: false,
      id: "draft/one",
      mailboxId: "team/primary",
      recipients: [{ address: "person@example.test" }],
      snippet: "Draft body",
      subject: "Quarterly update",
      updatedAt: 1000,
      version: 1,
    },
  ],
  nextCursor: "next/page",
} as const;
const scheduledDelivery = {
  attemptCount: 0,
  createdAt: 1000,
  id: "delivery/one",
  mailboxId: "team/primary",
  messageId: "message/outbound",
  sendAt: 11_000,
  status: "scheduled",
  updatedAt: 1000,
  version: 1,
} as const;
const cancelledDelivery = {
  ...scheduledDelivery,
  cancelledAt: 2000,
  status: "cancelled",
  updatedAt: 2000,
  version: 2,
} as const;

const runForward = <A>(
  fetch: (request: Request) => Promise<Response>,
  operation: (operations: MailboxBackendOperationsShape) => Effect.Effect<A>
) =>
  Effect.runPromise(
    MailboxBackendOperations.pipe(
      Effect.flatMap(operation),
      Effect.provide(
        MailboxBackendOperationsLive.pipe(
          Layer.provide(
            Layer.succeed(
              BackendClient,
              BackendClient.of({
                fetch: (_, request) => Effect.promise(() => fetch(request)),
              })
            )
          )
        )
      )
    )
  );

describe("Website mailbox Backend forwarding", () => {
  it("streams a bounded draft attachment upload and validates its identity", async () => {
    let forwarded: Request | undefined;
    const incoming = new Request("https://inbox.test/_server", {
      body: new Uint8Array([1, 2, 3]),
      headers: {
        "content-length": "3",
        "content-type": "application/octet-stream",
        cookie: "__Host-session=session-a.secret",
        origin: "https://inbox.test",
        "x-forwarded-for": "203.0.113.1",
      },
      method: "PUT",
    });
    const input = Schema.decodeUnknownSync(GetDraftAttachmentInput)({
      attachmentId: "attachment/one",
      draftId: "draft/one",
      mailboxId: "team/primary",
    });
    const upload = {
      attachment: {
        contentSha256: "a".repeat(64),
        createdAt: 1000,
        draftId: input.draftId,
        expiresAt: 901_000,
        fileName: "brief.pdf",
        id: input.attachmentId,
        mailboxId: input.mailboxId,
        mimeType: "application/pdf",
        size: 3,
        status: "stored",
        storedAt: 2000,
      },
      draftVersion: 2,
    } as const;
    const result = await runForward(
      (request) => {
        forwarded = request;
        return Promise.resolve(Response.json(upload));
      },
      (operations) => operations.uploadDraftAttachment({ ...input, incoming })
    );

    expect(result).toStrictEqual({ ok: true, upload });
    expect(new URL(forwarded?.url ?? "https://invalid.test").pathname).toBe(
      "/api/mailboxes/team%2Fprimary/drafts/draft%2Fone/attachments/attachment%2Fone/content"
    );
    expect(forwarded?.headers.get("x-forwarded-for")).toBeNull();
    await expect(forwarded?.arrayBuffer()).resolves.toStrictEqual(
      new Uint8Array([1, 2, 3]).buffer
    );
  });

  it("forwards a create command without adding hidden draft fields", async () => {
    let forwarded: Request | undefined;
    const incoming = new Request("https://inbox.test/_server", {
      headers: { cookie: "__Host-session=session-a.secret" },
    });
    const command = Schema.decodeUnknownSync(CreateMailboxDraftCommand)({
      content: draft.content,
      mailboxId: "team/primary",
      operationId: "operation-create",
    });
    const result = await runForward(
      (request) => {
        forwarded = request;
        return Promise.resolve(Response.json(draft, { status: 201 }));
      },
      (operations) => operations.createDraft({ command, incoming })
    );

    expect(result).toStrictEqual({ draft, ok: true });
    expect(forwarded).toBeDefined();
    expect(new URL(forwarded?.url ?? "https://invalid.test").pathname).toBe(
      "/api/mailboxes/team%2Fprimary/drafts"
    );
    await expect(forwarded?.json()).resolves.toStrictEqual({
      content: draft.content,
      operationId: "operation-create",
    });
  });

  it("forwards and validates a paginated draft summary list", async () => {
    let forwarded: Request | undefined;
    const incoming = new Request("https://inbox.test/_server", {
      headers: { cookie: "__Host-session=session-a.secret" },
    });
    const query = Schema.decodeUnknownSync(MailboxDraftListInput)({
      mailboxId: "team/primary",
      page: { cursor: "page/2 ?", limit: 10 },
    });
    const result = await runForward(
      (request) => {
        forwarded = request;
        return Promise.resolve(Response.json(drafts));
      },
      (operations) => operations.listDrafts({ incoming, query })
    );

    expect(result).toStrictEqual({ drafts, ok: true });
    expect({
      body: forwarded?.body,
      cookie: forwarded?.headers.get("cookie"),
      method: forwarded?.method,
      pathname:
        forwarded === undefined ? undefined : new URL(forwarded.url).pathname,
      search:
        forwarded === undefined ? undefined : new URL(forwarded.url).search,
    }).toStrictEqual({
      body: null,
      cookie: "__Host-session=session-a.secret",
      method: "GET",
      pathname: "/api/mailboxes/team%2Fprimary/drafts",
      search: "?cursor=page%2F2+%3F&limit=10",
    });
    expect(JSON.stringify(result)).not.toContain("textBody");
  });

  it("rejects a draft list item from another mailbox", async () => {
    const incoming = new Request("https://inbox.test/_server");
    const query = Schema.decodeUnknownSync(MailboxDraftListInput)({
      mailboxId: "primary",
    });
    const result = await runForward(
      () => Promise.resolve(Response.json(drafts)),
      (operations) => operations.listDrafts({ incoming, query })
    );

    expect(result).toMatchObject({ ok: false, status: 502 });
  });

  it("forwards send and undo payloads without path identity fields", async () => {
    const forwarded: Request[] = [];
    const incoming = new Request("https://inbox.test/_server", {
      headers: {
        cookie: "__Host-session=session-a.secret",
        origin: "https://inbox.test",
      },
    });
    const sendCommand = Schema.decodeUnknownSync(SendMailboxDraftCommand)({
      draftId: "draft/one",
      expectedVersion: 1,
      mailboxId: "team/primary",
      operationId: "operation-send",
    });
    const undoCommand = Schema.decodeUnknownSync(UndoMailboxSendCommand)({
      expectedVersion: 1,
      mailboxId: "team/primary",
      operationId: "operation-undo",
      outboundDeliveryId: "delivery/one",
    });
    const send = await runForward(
      (request) => {
        forwarded.push(request);
        return Promise.resolve(
          Response.json({ delivery: scheduledDelivery, serverNow: 1000 })
        );
      },
      (operations) => operations.sendDraft({ command: sendCommand, incoming })
    );
    const undo = await runForward(
      (request) => {
        forwarded.push(request);
        return Promise.resolve(Response.json(cancelledDelivery));
      },
      (operations) => operations.undoSend({ command: undoCommand, incoming })
    );

    expect({ send, undo }).toStrictEqual({
      send: {
        ok: true,
        send: { delivery: scheduledDelivery, serverNow: 1000 },
      },
      undo: { delivery: cancelledDelivery, ok: true },
    });
    await expect(
      Promise.all(
        forwarded.map(async (request) => ({
          body: await request.json(),
          cookie: request.headers.get("cookie"),
          origin: request.headers.get("origin"),
          path: new URL(request.url).pathname,
        }))
      )
    ).resolves.toStrictEqual([
      {
        body: { expectedVersion: 1, operationId: "operation-send" },
        cookie: "__Host-session=session-a.secret",
        origin: "https://inbox.test",
        path: "/api/mailboxes/team%2Fprimary/drafts/draft%2Fone/send",
      },
      {
        body: { expectedVersion: 1, operationId: "operation-undo" },
        cookie: "__Host-session=session-a.secret",
        origin: "https://inbox.test",
        path: "/api/mailboxes/team%2Fprimary/outbound/delivery%2Fone/undo",
      },
    ]);
  });

  it("rejects send and undo responses with mismatched identities", async () => {
    const incoming = new Request("https://inbox.test/_server");
    const sendCommand = Schema.decodeUnknownSync(SendMailboxDraftCommand)({
      draftId: "draft-1",
      expectedVersion: 1,
      mailboxId: "primary",
      operationId: "operation-send",
    });
    const undoCommand = Schema.decodeUnknownSync(UndoMailboxSendCommand)({
      expectedVersion: 1,
      mailboxId: "team/primary",
      operationId: "operation-undo",
      outboundDeliveryId: "delivery/expected",
    });
    const send = await runForward(
      () =>
        Promise.resolve(
          Response.json({ delivery: scheduledDelivery, serverNow: 1000 })
        ),
      (operations) => operations.sendDraft({ command: sendCommand, incoming })
    );
    const undo = await runForward(
      () => Promise.resolve(Response.json(cancelledDelivery)),
      (operations) => operations.undoSend({ command: undoCommand, incoming })
    );

    expect(send).toMatchObject({ ok: false, status: 502 });
    expect(undo).toMatchObject({ ok: false, status: 502 });
  });

  it("forwards an outbound status GET without a body and preserves auth context", async () => {
    let forwarded: Request | undefined;
    const incoming = new Request("https://inbox.test/_server", {
      headers: {
        cookie: "__Host-session=session-a.secret",
        origin: "https://inbox.test",
      },
    });
    const query = Schema.decodeUnknownSync(GetMailboxOutboundDeliveryQuery)({
      mailboxId: "team/primary",
      outboundDeliveryId: "delivery/one",
    });
    const outbound = { delivery: scheduledDelivery, serverNow: 2500 };
    const result = await runForward(
      (request) => {
        forwarded = request;
        return Promise.resolve(Response.json(outbound));
      },
      (operations) => operations.getOutboundDelivery({ incoming, query })
    );

    expect(result).toStrictEqual({ ok: true, outbound });
    expect({
      body: forwarded?.body,
      cookie: forwarded?.headers.get("cookie"),
      method: forwarded?.method,
      origin: forwarded?.headers.get("origin"),
      pathname:
        forwarded === undefined ? undefined : new URL(forwarded.url).pathname,
    }).toStrictEqual({
      body: null,
      cookie: "__Host-session=session-a.secret",
      method: "GET",
      origin: "https://inbox.test",
      pathname: "/api/mailboxes/team%2Fprimary/outbound/delivery%2Fone",
    });
  });

  it("rejects an outbound status response with mismatched identities", async () => {
    const incoming = new Request("https://inbox.test/_server");
    const query = Schema.decodeUnknownSync(GetMailboxOutboundDeliveryQuery)({
      mailboxId: "team/primary",
      outboundDeliveryId: "delivery/expected",
    });
    const result = await runForward(
      () =>
        Promise.resolve(
          Response.json({ delivery: scheduledDelivery, serverNow: 2500 })
        ),
      (operations) => operations.getOutboundDelivery({ incoming, query })
    );

    expect(result).toMatchObject({
      error: { code: "internal_error", message: "Invalid Backend response" },
      ok: false,
      status: 502,
    });
  });

  it("rejects a draft response with mismatched path identity", async () => {
    const incoming = new Request("https://inbox.test/_server");
    const query = Schema.decodeUnknownSync(GetMailboxDraftQuery)({
      draftId: "draft/expected",
      mailboxId: "team/primary",
    });
    const result = await runForward(
      () => Promise.resolve(Response.json(draft)),
      (operations) => operations.getDraft({ incoming, query })
    );

    expect(result).toMatchObject({
      error: { code: "internal_error", message: "Invalid Backend response" },
      ok: false,
      status: 502,
    });
  });

  it("forwards and validates an inline attachment binary response", async () => {
    let forwarded: Request | undefined;
    const incoming = new Request("https://inbox.test/_server", {
      headers: {
        cookie: "__Host-session=session-a.secret",
        origin: "https://inbox.test",
      },
    });
    const query = Schema.decodeUnknownSync(MailboxInlineAttachmentInput)({
      _tag: "Folder",
      attachmentId: "attachment/one",
      folderId: "inbox/team",
      mailboxId: "team/primary",
      messageId: "message/one",
    });
    const result = await runForward(
      (request) => {
        forwarded = request;
        return Promise.resolve(
          new Response(new Uint8Array([1, 2, 3]), {
            headers: {
              "content-length": "3",
              "content-type": "image/png",
            },
          })
        );
      },
      (operations) => operations.getInlineAttachment({ incoming, query })
    );

    expect(result).toStrictEqual({
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: "image/png",
      ok: true,
    });
    expect({
      pathname:
        forwarded === undefined ? undefined : new URL(forwarded.url).pathname,
      search:
        forwarded === undefined ? undefined : new URL(forwarded.url).search,
    }).toStrictEqual({
      pathname:
        "/api/mailboxes/team%2Fprimary/messages/message%2Fone/attachments/attachment%2Fone/inline",
      search: "?folder=inbox%2Fteam",
    });
  });

  it("rejects inconsistent inline attachment metadata", async () => {
    const incoming = new Request("https://inbox.test/_server");
    const query = Schema.decodeUnknownSync(MailboxInlineAttachmentInput)({
      _tag: "Label",
      attachmentId: "attachment-1",
      labelId: "work",
      mailboxId: "primary",
      messageId: "message-1",
    });
    const result = await runForward(
      () =>
        Promise.resolve(
          new Response(new Uint8Array([1, 2, 3]), {
            headers: {
              "content-length": "4",
              "content-type": "image/png",
            },
          })
        ),
      (operations) => operations.getInlineAttachment({ incoming, query })
    );

    expect(result).toMatchObject({ ok: false, status: 502 });
  });

  it("forwards an independently authorized message HTML read", async () => {
    let forwarded: Request | undefined;
    const incoming = new Request("https://inbox.test/_server", {
      headers: { cookie: "__Host-session=session-a.secret" },
    });
    const query = Schema.decodeUnknownSync(MailboxMessageHtmlInput)({
      _tag: "Label",
      labelId: "work/urgent",
      mailboxId: "team/primary",
      messageId: "message/one",
    });
    const result = await runForward(
      (request) => {
        forwarded = request;
        return Promise.resolve(Response.json(messageHtml));
      },
      (operations) => operations.getMessageHtml({ incoming, query })
    );

    expect(result).toStrictEqual({ html: messageHtml, ok: true });
    expect({
      cookie: forwarded?.headers.get("cookie"),
      method: forwarded?.method,
      pathname:
        forwarded === undefined ? undefined : new URL(forwarded.url).pathname,
      search:
        forwarded === undefined ? undefined : new URL(forwarded.url).search,
    }).toStrictEqual({
      cookie: "__Host-session=session-a.secret",
      method: "GET",
      pathname: "/api/mailboxes/team%2Fprimary/messages/message%2Fone/html",
      search: "?label=work%2Furgent",
    });
  });

  it("rejects message HTML returned for a different view identity", async () => {
    const incoming = new Request("https://inbox.test/_server");
    const query = Schema.decodeUnknownSync(MailboxMessageHtmlInput)({
      _tag: "Folder",
      folderId: "inbox",
      mailboxId: "primary",
      messageId: "message-1",
    });
    const result = await runForward(
      () => Promise.resolve(Response.json(messageHtml)),
      (operations) => operations.getMessageHtml({ incoming, query })
    );

    expect(result).toStrictEqual({
      error: {
        _tag: "AuthInternalError",
        code: "internal_error",
        message: "Invalid Backend response",
      },
      ok: false,
      status: 502,
    });
  });

  it("forwards a message action with encoded path identity", async () => {
    let forwarded: Request | undefined;
    const incoming = new Request("https://inbox.test/_server", {
      headers: { cookie: "__Host-session=session-a.secret" },
    });
    const command = Schema.decodeUnknownSync(MailboxMessageActionCommand)({
      _tag: "Archive",
      expectedVersion: 1,
      mailboxId: "team/primary",
      messageId: "message/one",
      operationId: "operation-1",
    });
    const responseAction = { ...messageAction, id: "message/one" };
    const result = await runForward(
      (request) => {
        forwarded = request;
        return Promise.resolve(Response.json(responseAction));
      },
      (operations) => operations.actOnMessage({ command, incoming })
    );

    expect(result).toStrictEqual({ action: responseAction, ok: true });
    expect({
      body: await forwarded?.json(),
      method: forwarded?.method,
      path:
        forwarded === undefined ? undefined : new URL(forwarded.url).pathname,
    }).toStrictEqual({
      body: {
        _tag: "Archive",
        expectedVersion: 1,
        operationId: "operation-1",
      },
      method: "PATCH",
      path: "/api/mailboxes/team%2Fprimary/messages/message%2Fone",
    });
  });

  it("encodes mailbox message label views with URLSearchParams", async () => {
    let forwarded: Request | undefined;
    const incoming = new Request("https://inbox.test/_server", {
      headers: { cookie: "__Host-session=session-a.secret" },
    });
    const query = Schema.decodeUnknownSync(MailboxMessageListInput)({
      _tag: "Label",
      cursor: "page/2 ?",
      hasAttachment: true,
      labelId: "work/urgent ?",
      mailboxId: "team/primary",
      query: "quarterly report",
      read: false,
      starred: true,
    });
    const result = await runForward(
      (request) => {
        forwarded = request;
        return Promise.resolve(Response.json(messages));
      },
      (operations) => operations.listMessages({ incoming, query })
    );

    expect(result).toStrictEqual({ messages, ok: true });
    expect(
      forwarded === undefined
        ? undefined
        : {
            cookie: forwarded.headers.get("cookie"),
            method: forwarded.method,
            path: new URL(forwarded.url).pathname,
            search: new URL(forwarded.url).search,
          }
    ).toStrictEqual({
      cookie: "__Host-session=session-a.secret",
      method: "GET",
      path: "/api/mailboxes/team%2Fprimary/messages",
      search:
        "?label=work%2Furgent+%3F&q=quarterly+report&read=false&starred=true&attachment=true&cursor=page%2F2+%3F",
    });
  });

  it("decodes nullable optional fields from Backend JSON responses", async () => {
    const incoming = new Request("https://inbox.test/_server");
    const query = Schema.decodeUnknownSync(MailboxMessageListInput)({
      _tag: "Folder",
      folderId: "inbox",
      mailboxId: "primary",
    });
    const result = await runForward(
      () =>
        Promise.resolve(
          Response.json({
            items: [{ ...messages.items[0], sender: null }],
            nextCursor: null,
          })
        ),
      (operations) => operations.listMessages({ incoming, query })
    );
    expect(result).toStrictEqual({
      messages: {
        items: [{ ...messages.items[0], sender: undefined }],
        nextCursor: undefined,
      },
      ok: true,
    });
  });

  it("encodes thread path segments and validates the response", async () => {
    let path: string | undefined;
    let search: string | undefined;
    const incoming = new Request("https://inbox.test/_server");
    const query = Schema.decodeUnknownSync(OpenMailboxThreadInput)({
      _tag: "Folder",
      folderId: "inbox",
      mailboxId: "team/primary",
      messageId: "message-1",
      threadId: "thread/one ?",
    });
    const responseThread = {
      ...thread,
      thread: { ...thread.thread, id: query.threadId },
    };
    const result = await runForward(
      (request) => {
        const url = new URL(request.url);
        const { pathname, search: queryString } = url;
        path = pathname;
        search = queryString;
        return Promise.resolve(Response.json(responseThread));
      },
      (operations) => operations.getThread({ incoming, query })
    );

    expect({ path, result, search }).toStrictEqual({
      path: "/api/mailboxes/team%2Fprimary/threads/thread%2Fone%20%3F",
      result: { ok: true, thread: responseThread },
      search: "?folder=inbox&message=message-1",
    });
  });

  it("rejects a thread response for a different requested thread", async () => {
    const incoming = new Request("https://inbox.test/_server");
    const query = Schema.decodeUnknownSync(OpenMailboxThreadInput)({
      _tag: "Folder",
      folderId: "inbox",
      mailboxId: "primary",
      messageId: "message-1",
      threadId: "thread-requested",
    });
    const result = await runForward(
      () => Promise.resolve(Response.json(thread)),
      (operations) => operations.getThread({ incoming, query })
    );

    expect(result).toStrictEqual({
      error: {
        _tag: "AuthInternalError",
        code: "internal_error",
        message: "Invalid Backend response",
      },
      ok: false,
      status: 502,
    });
  });

  it("forwards and validates the current mailbox navigation read", async () => {
    let forwarded: Request | undefined;
    const incoming = new Request("https://inbox.test/_server", {
      headers: {
        cookie: "__Host-session=session-a.secret",
        origin: "https://inbox.test",
        "x-forwarded-for": "203.0.113.10",
      },
    });
    const result = await runForward(
      (request) => {
        forwarded = request;
        return Promise.resolve(Response.json(navigation));
      },
      (operations) => operations.getNavigation(incoming)
    );

    expect(result).toStrictEqual({ navigation, ok: true });
    expect(forwarded).toBeDefined();
    expect({
      contentType: forwarded?.headers.get("content-type"),
      cookie: forwarded?.headers.get("cookie"),
      method: forwarded?.method,
      path:
        forwarded === undefined ? undefined : new URL(forwarded.url).pathname,
      proxy: forwarded?.headers.get("x-forwarded-for"),
    }).toStrictEqual({
      contentType: null,
      cookie: "__Host-session=session-a.secret",
      method: "GET",
      path: "/api/mailboxes/current/navigation",
      proxy: null,
    });
  });

  it("rejects invalid navigation count invariants", async () => {
    const incoming = new Request("https://inbox.test/_server");
    const result = await runForward(
      () =>
        Promise.resolve(
          Response.json({
            ...navigation,
            folders: [
              {
                ...navigation.folders[0],
                messageCount: 1,
                unreadCount: 2,
              },
            ],
          })
        ),
      (operations) => operations.getNavigation(incoming)
    );

    expect(result).toStrictEqual({
      error: {
        _tag: "AuthInternalError",
        code: "internal_error",
        message: "Invalid Backend response",
      },
      ok: false,
      status: 502,
    });
  });

  it("forwards only trusted request metadata and the mailbox payload", async () => {
    let forwarded: Request | undefined;
    const incoming = new Request("https://inbox.test/_server", {
      headers: {
        cookie: "__Host-session=session-a.secret",
        origin: "https://inbox.test",
        referer: "https://inbox.test/",
        "user-agent": "test-browser",
        "x-forwarded-for": "203.0.113.10",
      },
    });
    const result = await runForward(
      (request) => {
        forwarded = request;
        return Promise.resolve(Response.json(mailbox, { status: 201 }));
      },
      (operations) =>
        operations.bootstrapOwner({ displayName: "Inbox", incoming })
    );

    expect(result).toStrictEqual({ mailbox, ok: true });
    expect(forwarded).toBeDefined();
    expect({
      body: await forwarded?.json(),
      cookie: forwarded?.headers.get("cookie"),
      method: forwarded?.method,
      origin: forwarded?.headers.get("origin"),
      path:
        forwarded === undefined ? undefined : new URL(forwarded.url).pathname,
      proxy: forwarded?.headers.get("x-forwarded-for"),
      referer: forwarded?.headers.get("referer"),
      userAgent: forwarded?.headers.get("user-agent"),
    }).toStrictEqual({
      body: { displayName: "Inbox" },
      cookie: "__Host-session=session-a.secret",
      method: "POST",
      origin: "https://inbox.test",
      path: "/api/mailboxes/bootstrap-owner",
      proxy: null,
      referer: "https://inbox.test/",
      userAgent: "test-browser",
    });
  });

  it("encodes mailbox IDs as one rename path segment", async () => {
    let path: string | undefined;
    const incoming = new Request("https://inbox.test/_server");

    await runForward(
      (request) => {
        path = new URL(request.url).pathname;
        return Promise.resolve(Response.json(mailbox));
      },
      (operations) =>
        operations.rename({
          displayName: "Recruiting",
          incoming,
          mailboxId: "team/primary ?",
        })
    );

    expect(path).toBe("/api/mailboxes/team%2Fprimary%20%3F");
  });

  it("preserves Backend denial status without retries", async () => {
    let requests = 0;
    const incoming = new Request("https://inbox.test/_server", {
      headers: { origin: "https://inbox.test" },
    });
    const error = {
      _tag: "AuthPolicyDeniedError",
      code: "policy_denied",
      message: "Mailbox operation denied",
    };

    const result = await runForward(
      () => {
        requests += 1;
        return Promise.resolve(Response.json(error, { status: 403 }));
      },
      (operations) =>
        operations.rename({
          displayName: "Recruiting",
          incoming,
          mailboxId: "primary",
        })
    );

    expect(result).toStrictEqual({ error, ok: false, status: 403 });
    expect(requests).toBe(1);
  });

  it("preserves a typed step-up response without retries", async () => {
    let requests = 0;
    const incoming = new Request("https://inbox.test/_server", {
      headers: { origin: "https://inbox.test" },
    });

    const result = await runForward(
      () => {
        requests += 1;
        return Promise.resolve(
          Response.json(
            {
              _tag: "AuthStepUpRequiredError",
              code: "step_up_required",
              message: "provider policy detail",
            },
            { status: 403 }
          )
        );
      },
      (operations) =>
        operations.bootstrapOwner({ displayName: "Inbox", incoming })
    );

    expect(result).toStrictEqual({
      error: {
        _tag: "AuthStepUpRequiredError",
        code: "step_up_required",
        message: "Recent authentication required",
      },
      ok: false,
      status: 403,
    });
    expect(requests).toBe(1);
  });

  it("does not expose administration denial messages to mailbox reads", async () => {
    const incoming = new Request("https://inbox.test/_server");
    const query = Schema.decodeUnknownSync(MailboxMessageListInput)({
      _tag: "Folder",
      folderId: "inbox",
      mailboxId: "primary",
    });
    const result = await runForward(
      () =>
        Promise.resolve(
          Response.json(
            {
              _tag: "AuthPolicyDeniedError",
              code: "policy_denied",
              message: "Mailbox owner account required",
            },
            { status: 403 }
          )
        ),
      (operations) => operations.listMessages({ incoming, query })
    );

    expect(result).toStrictEqual({
      error: {
        _tag: "AuthPolicyDeniedError",
        code: "policy_denied",
        message: "Mailbox operation denied",
      },
      ok: false,
      status: 403,
    });
  });

  it("replaces malformed Backend responses with a generic gateway error", async () => {
    const incoming = new Request("https://inbox.test/_server", {
      headers: { origin: "https://inbox.test" },
    });
    const result = await runForward(
      () =>
        Promise.resolve(
          Response.json(
            {
              _tag: "DatabaseError",
              code: "internal_error",
              message: "select * from auth_session failed",
            },
            { status: 503 }
          )
        ),
      (operations) =>
        operations.bootstrapOwner({ displayName: "Inbox", incoming })
    );

    expect(result).toStrictEqual({
      error: {
        _tag: "AuthInternalError",
        code: "internal_error",
        message: "Invalid Backend response",
      },
      ok: false,
      status: 502,
    });
  });
});
