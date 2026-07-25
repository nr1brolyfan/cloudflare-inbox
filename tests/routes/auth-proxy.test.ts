import { describe, expect, it } from "vitest";

import { forwardPrivateAuthResponse } from "#/routes/auth/$";

describe("website auth proxy response policy", () => {
  it.each([
    ["success", 200],
    ["created enrollment", 201],
    ["client error", 400],
    ["rate denial", 429],
    ["internal error", 500],
  ])("marks %s responses private and no-store", async (_name, status) => {
    const incoming = new Request(
      "https://inbox.test/auth/first-owner/password"
    );
    const forwarded: { operation: string; request: Request }[] = [];
    const response = await forwardPrivateAuthResponse(
      incoming,
      (operation, request) => {
        forwarded.push({ operation, request });
        return Promise.resolve(
          new Response("{}", {
            headers: {
              "cache-control": "public, max-age=3600",
              "content-type": "application/json",
            },
            status,
          })
        );
      }
    );

    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect(forwarded).toStrictEqual([
      { operation: "website.auth.backend", request: incoming },
    ]);
  });

  it("preserves an intentional authentication cookie", async () => {
    const response = await forwardPrivateAuthResponse(
      new Request("https://inbox.test/auth/session"),
      () =>
        Promise.resolve(
          new Response("{}", {
            headers: { "set-cookie": "__Host-session=token; Secure; HttpOnly" },
          })
        )
    );

    expect(response.headers.get("set-cookie")).toBe(
      "__Host-session=token; Secure; HttpOnly"
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});
