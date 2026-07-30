import type { AuthRateLimitService } from "@effect-auth/core/AuthRateLimit";
import { UserId } from "@effect-auth/core/Identifiers";
import { PermissionSubject } from "@effect-auth/core/Permission";
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
  session: { userId, claims: { requirements: [] } },
} as never;

const makeHandler = (options?: {
  readonly authenticate?: RequestSessionAuthenticatorShape["authenticate"];
  readonly passkeyAvailable?: boolean;
  readonly passkeyEligible?: boolean;
  readonly passwordAvailable?: boolean;
}) => {
  const require = vi.fn<AuthRateLimitService["require"]>(() => Effect.void);
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
          Effect.succeed(options?.passkeyAvailable ?? false),
        passwordAvailable: () =>
          Effect.succeed(options?.passwordAvailable ?? true),
      } as StepUpFactorReaderShape,
      passkeyIdentities: {
        eligible: () => Effect.succeed(options?.passkeyEligible ?? false),
        verifiedIdentity: () => Effect.die("not used"),
      } as PasskeyAuthenticationIdentityStoreShape,
    })
  );
  return HttpRouter.toWebHandler(route, { disableLogger: true });
};

describe("isolated step-up options route", () => {
  it("returns active password and passkey factors", async () => {
    const route = makeHandler({
      passkeyAvailable: true,
      passkeyEligible: true,
    });
    try {
      const response = await route.handler(
        new Request("https://backend.test/auth/step-up/options")
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toStrictEqual({
        factors: [{ type: "password" }, { type: "passkey" }],
      });
    } finally {
      await route.dispose();
    }
  });

  it("returns unauthenticated before reading factors", async () => {
    const route = makeHandler({
      authenticate: () =>
        Effect.fail({ _tag: "AuthUnauthenticatedError" } as never),
    });
    try {
      const response = await route.handler(
        new Request("https://backend.test/auth/step-up/options")
      );
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toMatchObject({
        code: "unauthenticated",
      });
    } finally {
      await route.dispose();
    }
  });
});
