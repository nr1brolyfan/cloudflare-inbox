import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { describe, expect, it } from "vitest";

import type {
  MailboxBackendOperationsShape,
  MailboxServerResult,
} from "#/server/mailbox-backend";
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

describe("Website mailbox Backend forwarding", () => {
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
