import { AuthUnauthenticatedError } from "@effect-auth/core/HttpApi";
import type { SessionHttpOperationsService } from "@effect-auth/core/HttpApi";
import {
  SessionId,
  SessionToken,
  UnixMillis,
  UserId,
} from "@effect-auth/core/Identifiers";
import { PermissionSubject } from "@effect-auth/core/Permission";
import type { ValidatedSession } from "@effect-auth/core/Sessions";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";

import type { RequestSessionAuthenticatorShape } from "#/auth/session";
import { makeApplicationSessionHttpOperations } from "#/http/auth-session";

const userId = UserId("user-a");
const sessionId = SessionId("recovery-session-a");
const currentSession = {
  aal: "aal1" as const,
  amr: ["external_recovery_link", "recovery_code"],
  authenticationEvents: [],
  authTime: UnixMillis(1000),
  claims: {
    recoveryRemediation: { allowed: ["second-passkey"] },
    requirements: ["recovery_remediation"],
  },
  expiresAt: UnixMillis(10_000),
  sessionId,
  userId,
} satisfies ValidatedSession["currentSession"];
const validated = {
  actor: { sessionId, userId },
  currentSession,
  issued: {
    ...currentSession,
    token: SessionToken(`${sessionId}.secret`),
  },
} satisfies ValidatedSession;

describe("application session HTTP operations", () => {
  it("denies session management to a recovery-remediation session", async () => {
    const called: string[] = [];
    const unused = (operation: string) => () =>
      Effect.sync(() => {
        called.push(operation);
        return undefined as never;
      });
    const operations = {
      current: unused("current"),
      list: unused("list"),
      logout: unused("logout"),
      refresh: unused("refresh"),
      revoke: unused("revoke"),
      revokeOthers: unused("revokeOthers"),
    } as SessionHttpOperationsService;
    const authenticator: RequestSessionAuthenticatorShape = {
      authenticate: () =>
        Effect.succeed({
          actor: validated.actor,
          principal: PermissionSubject.user(userId),
          requestAuth: {
            sessionSecretHash: "session-secret-hash",
            validated,
          },
          session: currentSession,
        }),
    };
    const guarded = makeApplicationSessionHttpOperations(
      operations,
      authenticator
    );
    const request = {
      request: { headers: { cookie: "__Host-session=recovery-session" } },
    };
    const errors = await Effect.runPromise(
      Effect.all([
        guarded
          .list(request as unknown as Parameters<typeof guarded.list>[0])
          .pipe(Effect.flip),
        guarded
          .refresh(request as unknown as Parameters<typeof guarded.refresh>[0])
          .pipe(Effect.flip),
        guarded
          .revoke(request as unknown as Parameters<typeof guarded.revoke>[0])
          .pipe(Effect.flip),
        guarded
          .revokeOthers(
            request as unknown as Parameters<typeof guarded.revokeOthers>[0]
          )
          .pipe(Effect.flip),
      ])
    );

    expect(
      errors.every((error) => error instanceof AuthUnauthenticatedError)
    ).toBeTruthy();
    expect(called).toStrictEqual([]);
  });
});
