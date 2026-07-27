import type { AuthRateLimitService } from "@effect-auth/core/AuthRateLimit";
import { MagicLinkStartError } from "@effect-auth/core/MagicLink";
import { RateLimitExceededError } from "@effect-auth/core/RateLimiter";
import type { RateLimitPolicyId } from "@effect-auth/core/RateLimiter";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import { describe, expect, it, vi } from "vitest";

import type { MagicLinkStarterShape } from "#/modules/account-security/adapters/effect-auth/MagicLinkStartEffectAuth";
import { RecoverySafeEmailInitiationDenied } from "#/modules/account-security/adapters/effect-auth/RecoverySafeEmailInitiationEffectAuth";
import { makeAuthMagicLinkStartHandler } from "#/modules/account-security/adapters/http/AuthMagicLinkStartHttpRoute";

const payload = {
  identity: {
    scope: { type: "global" },
    kind: "email",
    value: "owner@external.test",
  },
};

const request = (body: unknown = payload, origin?: string) =>
  new Request("https://backend.test/auth/magic-link/start", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: origin ?? "https://mail.test",
    },
    body: JSON.stringify(body),
  });

const makeHandler = (options?: {
  readonly require?: AuthRateLimitService["require"];
  readonly start?: MagicLinkStarterShape["start"];
}) => {
  const require = vi.fn<AuthRateLimitService["require"]>(
    options?.require ?? (() => Effect.void)
  );
  const start = vi.fn<MagicLinkStarterShape["start"]>(
    options?.start ?? (() => Effect.succeed({ expiresAt: 123_456 }))
  );
  const route = HttpRouter.add(
    "POST",
    "/auth/magic-link/start",
    makeAuthMagicLinkStartHandler({
      allowedOrigin: "https://mail.test",
      authRateLimit: { require } as AuthRateLimitService,
      starter: { start },
    })
  );

  return {
    ...HttpRouter.toWebHandler(route, { disableLogger: true }),
    require,
    start,
  };
};

describe("isolated magic-link start route", () => {
  it("returns the existing success contract", async () => {
    const { dispose, handler, require, start } = makeHandler();

    try {
      const response = await handler(request());

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toStrictEqual({
        identity: payload.identity,
        expiresAt: 123_456,
      });
      expect(require).toHaveBeenCalledOnce();
      expect(start).toHaveBeenCalledWith({
        identity: payload.identity,
        locale: undefined,
        metadata: undefined,
      });
    } finally {
      await dispose();
    }
  });

  it("rejects missing or foreign request origins before starting", async () => {
    const { dispose, handler, require, start } = makeHandler();

    try {
      const [missing, foreign] = await Promise.all([
        handler(
          new Request("https://backend.test/auth/magic-link/start", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          })
        ),
        handler(request(payload, "https://foreign.test")),
      ]);

      expect([missing.status, foreign.status]).toStrictEqual([403, 403]);
      expect(require).not.toHaveBeenCalled();
      expect(start).not.toHaveBeenCalled();
    } finally {
      await dispose();
    }
  });

  it("returns a sanitized bad-request response for malformed payloads", async () => {
    const { dispose, handler, require, start } = makeHandler();

    try {
      const response = await handler(request({ identity: { kind: "email" } }));

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toStrictEqual({
        _tag: "AuthBadRequestError",
        code: "bad_request",
        message: "Invalid request",
      });
      expect(require).not.toHaveBeenCalled();
      expect(start).not.toHaveBeenCalled();
    } finally {
      await dispose();
    }
  });

  it("preserves the decodable rate-limit response and Retry-After header", async () => {
    const { dispose, handler, start } = makeHandler({
      require: () =>
        Effect.fail(
          new RateLimitExceededError({
            policyId: "auth.magic_link.start.ip" as RateLimitPolicyId,
            retryAfter: Duration.seconds(45),
            limit: 10,
            remaining: 0,
          })
        ),
    });

    try {
      const response = await handler(request());

      expect(response.status).toBe(429);
      expect(response.headers.get("retry-after")).toBe("45");
      await expect(response.json()).resolves.toStrictEqual({
        _tag: "AuthRateLimitedError",
        code: "rate_limited",
        message: "Too many requests",
        retryAfter: { _id: "Duration", _tag: "Millis", millis: 45_000 },
      });
      expect(start).not.toHaveBeenCalled();
    } finally {
      await dispose();
    }
  });

  it("consumes rate-limit policy before rejecting caller-provided secrets", async () => {
    const { dispose, handler, require, start } = makeHandler();

    try {
      const response = await handler(request({ ...payload, secret: "caller" }));

      expect(response.status).toBe(400);
      expect(require).toHaveBeenCalledOnce();
      expect(start).not.toHaveBeenCalled();
    } finally {
      await dispose();
    }
  });

  it("keeps policy denials distinct from internal start failures", async () => {
    const denied = makeHandler({
      start: () =>
        Effect.fail(
          new MagicLinkStartError({
            message: "Email initiation denied",
            cause: new RecoverySafeEmailInitiationDenied(),
          })
        ),
    });
    const failed = makeHandler({
      start: () =>
        Effect.fail(
          new MagicLinkStartError({
            message: "Failed to issue magic link challenge",
            cause: new Error("D1 unavailable"),
          })
        ),
    });

    try {
      const [policyResponse, internalResponse] = await Promise.all([
        denied.handler(request()),
        failed.handler(request()),
      ]);

      expect([policyResponse.status, internalResponse.status]).toStrictEqual([
        403, 500,
      ]);
      await expect(policyResponse.json()).resolves.toMatchObject({
        code: "policy_denied",
      });
      await expect(internalResponse.json()).resolves.toStrictEqual({
        _tag: "AuthInternalError",
        code: "internal_error",
        message: "Failed to start magic link",
      });
    } finally {
      await Promise.all([denied.dispose(), failed.dispose()]);
    }
  });
});
