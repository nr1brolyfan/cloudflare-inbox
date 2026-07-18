import { describe, expect, it } from "vitest";

import { forwardMailboxMutation } from "./backend";

const mailbox = {
  createdAt: 1000,
  createdByUserId: "user-a",
  displayName: "Inbox",
  id: "primary",
  status: "active",
  updatedAt: 1000,
  version: 1,
} as const;

describe("Website Backend forwarding", () => {
  it("forwards only trusted request metadata and the mailbox payload", async () => {
    let forwarded: Request | undefined;
    const result = await forwardMailboxMutation({
      backend: {
        fetch: (request) => {
          forwarded = request;
          return Promise.resolve(Response.json(mailbox, { status: 201 }));
        },
      },
      incoming: new Request("https://inbox.test/_server", {
        headers: {
          cookie: "__Host-session=session-a.secret",
          origin: "https://inbox.test",
          referer: "https://inbox.test/",
          "user-agent": "test-browser",
          "x-forwarded-for": "203.0.113.10",
        },
      }),
      method: "POST",
      path: "/api/mailboxes/bootstrap-owner",
      payload: { displayName: "Inbox" },
    });

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
    const error = {
      _tag: "AuthPolicyDeniedError",
      code: "policy_denied",
      message: "Mailbox operation denied",
    };

    const result = await forwardMailboxMutation({
      backend: {
        fetch: () => {
          requests += 1;
          return Promise.resolve(Response.json(error, { status: 403 }));
        },
      },
      incoming: new Request("https://inbox.test/_server", {
        headers: { origin: "https://inbox.test" },
      }),
      method: "PATCH",
      path: "/api/mailboxes/primary",
      payload: { displayName: "Recruiting" },
    });

    expect(result).toStrictEqual({ error, ok: false, status: 403 });
    expect(requests).toBe(1);
  });

  it("replaces malformed Backend responses with a generic gateway error", async () => {
    const result = await forwardMailboxMutation({
      backend: {
        fetch: () =>
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
      },
      incoming: new Request("https://inbox.test/_server", {
        headers: { origin: "https://inbox.test" },
      }),
      method: "POST",
      path: "/api/mailboxes/bootstrap-owner",
      payload: { displayName: "Inbox" },
    });

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
