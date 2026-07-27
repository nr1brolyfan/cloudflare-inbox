import { AuthResult } from "@effect-auth/core/AuthFlow";
import type { AuthRateLimitService } from "@effect-auth/core/AuthRateLimit";
import type { MagicLinkLoginService } from "@effect-auth/core/MagicLink";
import type { SessionCookieService } from "@effect-auth/core/Sessions";
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

const makeHandler = () => {
  const require = vi.fn<AuthRateLimitService["require"]>(() => Effect.void);
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
  it("maps an invalid challenge to the existing invalid-credentials contract", async () => {
    const { dispose, handler, require, verify } = makeHandler();

    try {
      const response = await handler(request());

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toStrictEqual({
        _tag: "AuthInvalidCredentialsError",
        code: "invalid_credentials",
        message: "Invalid credentials",
      });
      expect(require).toHaveBeenCalledOnce();
      expect(verify).toHaveBeenCalledOnce();
    } finally {
      await dispose();
    }
  });

  it("rejects foreign origins before rate limiting or challenge verification", async () => {
    const { dispose, handler, require, verify } = makeHandler();

    try {
      const response = await handler(request("https://foreign.test"));

      expect(response.status).toBe(403);
      expect(require).not.toHaveBeenCalled();
      expect(verify).not.toHaveBeenCalled();
    } finally {
      await dispose();
    }
  });
});
