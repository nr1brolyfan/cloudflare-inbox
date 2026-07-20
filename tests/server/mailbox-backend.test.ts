import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  MailboxMessageListInput,
  OpenMailboxThreadInput,
} from "#/mailboxes/message-reading";
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
      hasAttachments: false,
      id: "message-1",
      read: false,
      recipients: [{ address: "owner@example.test" }],
      sender: { address: "sender@example.test" },
      snippet: "Preview",
      starred: false,
      subject: "Hello",
      threadId: "thread-1",
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
    const result = await runForward(
      (request) => {
        const url = new URL(request.url);
        const { pathname, search: queryString } = url;
        path = pathname;
        search = queryString;
        return Promise.resolve(Response.json(thread));
      },
      (operations) => operations.getThread({ incoming, query })
    );

    expect({ path, result, search }).toStrictEqual({
      path: "/api/mailboxes/team%2Fprimary/threads/thread%2Fone%20%3F",
      result: { ok: true, thread },
      search: "?folder=inbox&message=message-1",
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
