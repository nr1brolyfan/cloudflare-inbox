import { AuthResult } from "@effect-auth/core/AuthFlow";
import type { AuthRateLimitService } from "@effect-auth/core/AuthRateLimit";
import type { MagicLinkLoginService } from "@effect-auth/core/MagicLink";
import { RateLimitExceededError } from "@effect-auth/core/RateLimiter";
import type { RateLimitPolicyId } from "@effect-auth/core/RateLimiter";
import type { SessionCookieService } from "@effect-auth/core/Sessions";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import { describe, expect, it, vi } from "vitest";

import { makeAuthMagicLinkVerifyHandler } from "#/modules/account-security/adapters/http/AuthMagicLinkVerifyHttpRoute";

const request = (origin = "https://mail.test") =>
  new Request("https://backend.test/auth/magic-link/verify", {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({
      challengeId: "invalid-challenge",
      secret: "invalid-secret",
    }),
  });

const makeHandler = (
  requireEffect: AuthRateLimitService["require"] = () => Effect.void
) => {
  const require = vi.fn<AuthRateLimitService["require"]>(requireEffect);
  const verify = vi.fn<MagicLinkLoginService["verify"]>(() =>
    Effect.succeed(AuthResult.InvalidCredentials())
  );
  const route = HttpRouter.add(
    "POST",
    "/auth/magic-link/verify",
    makeAuthMagicLinkVerifyHandler({
      allowedOrigin: "https://mail.test",
      authRateLimit: { require } as AuthRateLimitService,
      magicLink: { verify } as unknown as MagicLinkLoginService,
      sessionCookie: {
        read: () => Effect.die("not used"),
        commit: () => Effect.die("not used"),
        clear: Effect.die("not used"),
      } as SessionCookieService,
    })
  );
  return {
    ...HttpRouter.toWebHandler(route, { disableLogger: true }),
    require,
    verify,
  };
};

describe("isolated magic-link verify route", () => {
  it("maps invalid challenges to the existing contract", async () => {
    const route = makeHandler();
    try {
      const response = await route.handler(request());
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toStrictEqual({
        _tag: "AuthInvalidCredentialsError",
        code: "invalid_credentials",
        message: "Invalid credentials",
      });
      expect(route.require).toHaveBeenCalledOnce();
      expect(route.verify).toHaveBeenCalledOnce();
    } finally {
      await route.dispose();
    }
  });

  it("rejects foreign origins before verification", async () => {
    const route = makeHandler();
    try {
      const response = await route.handler(request("https://foreign.test"));
      expect(response.status).toBe(403);
      expect(route.require).not.toHaveBeenCalled();
      expect(route.verify).not.toHaveBeenCalled();
    } finally {
      await route.dispose();
    }
  });

  it("preserves the rate-limit response and Retry-After", async () => {
    const route = makeHandler(() =>
      Effect.fail(
        new RateLimitExceededError({
          policyId: "auth.magic_link.verify.ip" as RateLimitPolicyId,
          retryAfter: Duration.seconds(30),
          limit: 10,
          remaining: 0,
        })
      )
    );
    try {
      const response = await route.handler(request());
      expect(response.status).toBe(429);
      expect(response.headers.get("retry-after")).toBe("30");
      await expect(response.json()).resolves.toMatchObject({
        _tag: "AuthRateLimitedError",
        code: "rate_limited",
      });
      expect(route.verify).not.toHaveBeenCalled();
    } finally {
      await route.dispose();
    }
  });
});
