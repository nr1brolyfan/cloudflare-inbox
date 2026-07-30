import {
  SessionCookie,
  Sessions,
  SessionValidateError,
} from "@effect-auth/core/Sessions";
import type {
  SessionsService,
  ValidatedSession,
} from "@effect-auth/core/Sessions";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import { describe, expect, it } from "vitest";

import { AuthCurrentSessionHttpRouteLayer } from "#/modules/account-security/adapters/http/AuthCurrentSessionHttpRoute";

const validatedSession = {
  currentSession: {
    sessionId: "session-1",
    userId: "user-1",
    authTime: 1000,
    expiresAt: 2000,
    aal: "aal2",
    amr: ["pwd", "webauthn"],
    mfaVerifiedAt: 1500,
    authenticationEvents: [],
    claims: {
      verifiedIdentityKinds: ["email"],
      requirements: ["recovery_remediation"],
      recoveryEnrollment: { allowed: ["passkey"] },
      recoveryRemediation: { allowed: ["passkey"] },
    },
  },
} as unknown as ValidatedSession;

const makeHandler = (
  validate: SessionsService["validate"] = () => Effect.succeed(validatedSession)
) =>
  HttpRouter.toWebHandler(
    AuthCurrentSessionHttpRouteLayer.pipe(
      Layer.provide(
        Layer.merge(
          Layer.succeed(Sessions, Sessions.of({ validate } as SessionsService)),
          Layer.succeed(
            SessionCookie,
            SessionCookie.of({
              read: (request) =>
                Effect.succeed(
                  request.headers.get("cookie") === "auth_session=valid"
                    ? Option.some("token" as never)
                    : Option.none()
                ),
              commit: () => Effect.die("not used"),
              clear: Effect.die("not used"),
            })
          )
        )
      )
    ),
    { disableLogger: true }
  );

describe("isolated current-session route", () => {
  it("returns the current-session wire body without rotating cookies", async () => {
    const { dispose, handler } = makeHandler();

    try {
      const response = await handler(
        new Request("https://backend.test/auth/session", {
          headers: { cookie: "auth_session=valid" },
        })
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("set-cookie")).toBeNull();
      await expect(response.json()).resolves.toStrictEqual({
        type: "authenticated",
        userId: "user-1",
        sessionId: "session-1",
        authTime: 1000,
        expiresAt: 2000,
        aal: "aal2",
        amr: ["pwd", "webauthn"],
        mfaVerifiedAt: 1500,
        claims: {
          verifiedIdentityKinds: ["email"],
          requirements: ["recovery_remediation"],
          recoveryEnrollment: { allowed: ["passkey"] },
        },
      });
    } finally {
      await dispose();
    }
  });

  it("returns unauthenticated for absent or invalid sessions", async () => {
    const invalid = makeHandler(() =>
      Effect.fail(
        new SessionValidateError({ message: "Session token is invalid" })
      )
    );

    try {
      const [absent, rejected] = await Promise.all([
        invalid.handler(new Request("https://backend.test/auth/session")),
        invalid.handler(
          new Request("https://backend.test/auth/session", {
            headers: { cookie: "auth_session=valid" },
          })
        ),
      ]);

      expect([absent.status, rejected.status]).toStrictEqual([401, 401]);
      await expect(rejected.json()).resolves.toStrictEqual({
        _tag: "AuthUnauthenticatedError",
        code: "unauthenticated",
        message: "Unauthenticated",
      });
    } finally {
      await invalid.dispose();
    }
  });

  it("keeps storage and policy failures internal", async () => {
    const { dispose, handler } = makeHandler(() =>
      Effect.fail(
        new SessionValidateError({
          message: "Failed to validate session",
          cause: new Error("D1 unavailable"),
        })
      )
    );

    try {
      const response = await handler(
        new Request("https://backend.test/auth/session", {
          headers: { cookie: "auth_session=valid" },
        })
      );

      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toStrictEqual({
        _tag: "AuthInternalError",
        code: "internal_error",
        message: "Failed to validate session",
      });
    } finally {
      await dispose();
    }
  });

  it("owns only GET /auth/session", async () => {
    const { dispose, handler } = makeHandler();

    try {
      const [wrongMethod, otherAuthRoute] = await Promise.all([
        handler(
          new Request("https://backend.test/auth/session", { method: "POST" })
        ),
        handler(new Request("https://backend.test/auth/sessions")),
      ]);

      expect([wrongMethod.status, otherAuthRoute.status]).toStrictEqual([
        404, 404,
      ]);
    } finally {
      await dispose();
    }
  });
});
