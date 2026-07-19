import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { describe, expect, it } from "vitest";

import type {
  DevEmailOperationsShape,
  MailboxBackendOperationsShape,
  MailboxServerResult,
} from "./backend";
import {
  BackendClient,
  DevEmailOperations,
  DevEmailOperationsLive,
  MailboxBackendOperations,
  MailboxBackendOperationsLive,
  WebsiteConfig,
} from "./backend";

const mailbox = {
  createdAt: 1000,
  createdByUserId: "user-a",
  displayName: "Inbox",
  id: "primary",
  status: "active",
  updatedAt: 1000,
  version: 1,
} as const;

const runForward = (
  fetch: (request: Request) => Promise<Response>,
  operation: (
    operations: MailboxBackendOperationsShape
  ) => Effect.Effect<MailboxServerResult>
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

const runDevEmail = <A>(
  enabled: boolean,
  fetch: (request: Request) => Promise<Response>,
  operation: (operations: DevEmailOperationsShape) => Effect.Effect<A>
) =>
  Effect.runPromise(
    DevEmailOperations.pipe(
      Effect.flatMap(operation),
      Effect.provide(
        DevEmailOperationsLive.pipe(
          Layer.provide(
            Layer.merge(
              Layer.succeed(
                BackendClient,
                BackendClient.of({
                  fetch: (_, request) => Effect.promise(() => fetch(request)),
                })
              ),
              Layer.succeed(
                WebsiteConfig,
                WebsiteConfig.of({ devEmailInboxEnabled: enabled })
              )
            )
          )
        )
      )
    )
  );

describe("Website Backend forwarding", () => {
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
    }).toStrictEqual({
      body: { displayName: "Inbox" },
      cookie: "__Host-session=session-a.secret",
      method: "POST",
      origin: "https://inbox.test",
      path: "/api/mailboxes/bootstrap-owner",
      proxy: null,
    });
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

describe("Website development email operations", () => {
  it("does not contact the Backend when the inbox is disabled", async () => {
    let requests = 0;
    const incoming = new Request("https://inbox.test/_server");
    const result = await runDevEmail(
      false,
      () => {
        requests += 1;
        return Promise.resolve(new Response());
      },
      (operations) =>
        Effect.all({
          clear: operations.clear(incoming),
          list: operations.list(incoming),
          status: operations.status,
        })
    );

    expect(result).toStrictEqual({
      clear: { enabled: false },
      list: { enabled: false },
      status: { enabled: false },
    });
    expect(requests).toBe(0);
  });

  it("uses the Backend once per enabled inbox operation", async () => {
    const requests: Request[] = [];
    const incoming = new Request("https://inbox.test/_server");
    const message = {
      createdAt: 1000,
      expiresAt: 2000,
      id: "message-a",
      kind: "MagicLink",
      recipient: "person@example.com",
      subject: "Sign in",
      text: "Open the link",
    } as const;
    const result = await runDevEmail(
      true,
      (request) => {
        requests.push(request);
        return Promise.resolve(
          request.method === "GET"
            ? Response.json({ messages: [message] })
            : Response.json({ cleared: true })
        );
      },
      (operations) =>
        Effect.gen(function* () {
          const list = yield* operations.list(incoming);
          const clear = yield* operations.clear(incoming);
          return { clear, list };
        })
    );

    expect(result).toStrictEqual({
      clear: { enabled: true },
      list: { enabled: true, messages: [message] },
    });
    expect(
      requests.map((request) => ({
        method: request.method,
        path: new URL(request.url).pathname,
      }))
    ).toStrictEqual([
      { method: "GET", path: "/api/dev-emails" },
      { method: "DELETE", path: "/api/dev-emails" },
    ]);
  });
});
