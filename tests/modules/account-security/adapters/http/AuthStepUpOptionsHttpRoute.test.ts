import type { AuthRateLimitService } from "@effect-auth/core/AuthRateLimit";
import { UserId } from "@effect-auth/core/Identifiers";
import { PermissionSubject } from "@effect-auth/core/Permission";
import type { RateLimitPolicyId } from "@effect-auth/core/RateLimiter";
import { RateLimitExceededError } from "@effect-auth/core/RateLimiter";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import { describe, expect, it, vi } from "vitest";

import { makeAuthStepUpOptionsHandler } from "#/modules/account-security/adapters/http/AuthStepUpOptionsHttpRoute";
import type { RequestSessionAuthenticatorShape } from "#/modules/account-security/adapters/http/RequestSessionAuthentication";
import type { PasskeyAuthenticationIdentityStoreShape } from "#/modules/account-security/ports/PasskeyAuthenticationIdentityStore";
import type { StepUpFactorReaderShape } from "#/modules/account-security/ports/StepUpFactorReader";

const userId = UserId("user-a");
const authenticated = {
  actor: { sessionId: "session-a", userId },
  principal: PermissionSubject.user(userId),
  requestAuth: {
    sessionSecretHash: "secret-hash",
    validated: {
      actor: { sessionId: "session-a", userId },
      currentSession: {},
      issued: {},
    },
  },
  session: {
    userId,
    claims: { requirements: [] },
  },
} as never;

const request = () => new Request("https://backend.test/auth/step-up/options");

const makeHandler = (options?: {
  readonly authenticate?: RequestSessionAuthenticatorShape["authenticate"];
  readonly passkeyAvailable?: ReturnType<
    StepUpFactorReaderShape["passkeyAvailable"]
  >;
  readonly passkeyEligible?: ReturnType<
    PasskeyAuthenticationIdentityStoreShape["eligible"]
  >;
  readonly passwordAvailable?: ReturnType<
    StepUpFactorReaderShape["passwordAvailable"]
  >;
  readonly require?: AuthRateLimitService["require"];
}) => {
  const require = vi.fn<AuthRateLimitService["require"]>(
    options?.require ?? (() => Effect.void)
  );
  const passwordAvailable = vi.fn<StepUpFactorReaderShape["passwordAvailable"]>(
    () => options?.passwordAvailable ?? Effect.succeed(true)
  );
  const route = HttpRouter.add(
    "GET",
    "/auth/step-up/options",
    makeAuthStepUpOptionsHandler({
      authRateLimit: { require } as AuthRateLimitService,
      authenticator: {
        authenticate:
          options?.authenticate ?? (() => Effect.succeed(authenticated)),
      },
      factors: {
        passkeyAvailable: () =>
          options?.passkeyAvailable ?? Effect.succeed(false),
        passwordAvailable,
      },
      passkeyIdentities: {
        eligible: () => options?.passkeyEligible ?? Effect.succeed(false),
        verifiedIdentity: () => Effect.die("not used"),
      },
    })
  );

  return {
    ...HttpRouter.toWebHandler(route, { disableLogger: true }),
    passwordAvailable,
    require,
  };
};

describe("isolated step-up options route", () => {
  it("returns active password and passkey factors", async () => {
    const { dispose, handler, passwordAvailable, require } = makeHandler({
      passkeyAvailable: Effect.succeed(true),
      passkeyEligible: Effect.succeed(true),
    });

    try {
      const response = await handler(request());

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toStrictEqual({
        factors: [{ type: "password" }, { type: "passkey" }],
      });
      expect(require).toHaveBeenCalledWith({
        operation: "auth.step_up.options",
        userId,
      });
      expect(passwordAvailable).toHaveBeenCalledWith(userId);
    } finally {
      await dispose();
    }
  });

  it("returns unauthenticated before reading factors", async () => {
    const { dispose, handler, passwordAvailable, require } = makeHandler({
      authenticate: () =>
        Effect.fail({ _tag: "AuthUnauthenticatedError" } as never),
    });

    try {
      const response = await handler(request());

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toStrictEqual({
        _tag: "AuthUnauthenticatedError",
        code: "unauthenticated",
        message: "Unauthenticated",
      });
      expect(require).not.toHaveBeenCalled();
      expect(passwordAvailable).not.toHaveBeenCalled();
    } finally {
      await dispose();
    }
  });

  it("keeps factor storage failures internal", async () => {
    const { dispose, handler } = makeHandler({
      passwordAvailable: Effect.fail(new Error("D1 unavailable") as never),
    });

    try {
      const response = await handler(request());

      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toStrictEqual({
        _tag: "AuthInternalError",
        code: "internal_error",
        message: "Failed to complete step-up authentication",
      });
    } finally {
      await dispose();
    }
  });

  it("preserves the rate-limit wire response and Retry-After header", async () => {
    const { dispose, handler } = makeHandler({
      require: () =>
        Effect.fail(
          new RateLimitExceededError({
            policyId: "auth.step_up.options.user" as RateLimitPolicyId,
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
        message: "Too many step-up attempts",
        retryAfter: { _id: "Duration", _tag: "Millis", millis: 45_000 },
      });
    } finally {
      await dispose();
    }
  });
});
