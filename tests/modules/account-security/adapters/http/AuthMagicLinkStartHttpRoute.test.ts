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

const request = (body: unknown = payload, origin = "https://mail.test") =>
  new Request("https://backend.test/auth/magic-link/start", {
    method: "POST",
    headers: { "content-type": "application/json", origin },
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
    const route = makeHandler();
    try {
      const response = await route.handler(request());
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toStrictEqual({
        identity: payload.identity,
        expiresAt: 123_456,
      });
      expect(route.require).toHaveBeenCalledOnce();
      expect(route.start).toHaveBeenCalledOnce();
    } finally {
      await route.dispose();
    }
  });

  it("rejects foreign origins and malformed payloads", async () => {
    const route = makeHandler();
    try {
      const [foreign, credentialed, malformed] = await Promise.all([
        route.handler(request(payload, "https://foreign.test")),
        route.handler(
          new Request("https://backend.test/auth/magic-link/start", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              referer: "https://attacker@mail.test/path",
            },
            body: JSON.stringify(payload),
          })
        ),
        route.handler(request({ identity: { kind: "email" } })),
      ]);
      expect([
        foreign.status,
        credentialed.status,
        malformed.status,
      ]).toStrictEqual([403, 403, 400]);
      expect(route.start).not.toHaveBeenCalled();
    } finally {
      await route.dispose();
    }
  });

  it("preserves rate limits and policy denials", async () => {
    const limited = makeHandler({
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
    const denied = makeHandler({
      start: () =>
        Effect.fail(
          new MagicLinkStartError({
            message: "Email initiation denied",
            cause: new RecoverySafeEmailInitiationDenied(),
          })
        ),
    });
    try {
      const [rateLimit, policy] = await Promise.all([
        limited.handler(request()),
        denied.handler(request()),
      ]);
      expect(rateLimit.status).toBe(429);
      expect(rateLimit.headers.get("retry-after")).toBe("45");
      expect(policy.status).toBe(403);
    } finally {
      await Promise.all([limited.dispose(), denied.dispose()]);
    }
  });
});
