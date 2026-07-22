/* oxlint-disable vitest/max-expects -- One atomic lifecycle assertion verifies plaintext, hashes, replacement, and audit together. */
import { DatabaseSync } from "node:sqlite";

import type { D1Database } from "@cloudflare/workers-types";
import { decodeAuditEvent } from "@effect-auth/core/AuditLog";
import { AuthRateLimit } from "@effect-auth/core/AuthRateLimit";
import { WebCryptoLive } from "@effect-auth/core/Crypto";
import {
  CredentialId,
  SessionId,
  SessionToken,
  UnixMillis,
  UserId,
} from "@effect-auth/core/Identifiers";
import * as AuthPermission from "@effect-auth/core/Permission";
import { RecoveryCodesLive } from "@effect-auth/core/RecoveryCode";
import type { ValidatedSession } from "@effect-auth/core/Sessions";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { describe, expect, it } from "vitest";

import { RecoveryCodeAdministration } from "#/auth/recovery-code-administration";
import type { CurrentRequestAuthShape } from "#/auth/session";
import { CurrentRequestAuth } from "#/auth/session";
import { SensitiveOperationStepUpClock } from "#/auth/step-up-policy";
import { ControlPlaneLive } from "#/control-plane/batch";
import { ControlPlaneD1Binding } from "#/control-plane/database";
import { RecoveryCodeAdministrationLive } from "#/control-plane/recovery-code-administration-live";

import { applyControlPlaneMigrations, makeTestD1Database } from "../support/d1";

const now = Date.now();
const userId = UserId("user-a");
const sessionId = SessionId("session-a");
const currentSession = {
  aal: "aal1" as const,
  amr: ["pwd"],
  authenticationEvents: [
    {
      credentialId: CredentialId("password-a"),
      type: "password" as const,
      verifiedAt: UnixMillis(now - 100),
      version: 1 as const,
    },
  ],
  authTime: UnixMillis(now - 100),
  expiresAt: UnixMillis(now + 60 * 60 * 1000),
  sessionId,
  userId,
};
const session = {
  actor: { sessionId, userId },
  currentSession,
  issued: {
    ...currentSession,
    token: SessionToken("session-a.secret"),
  },
} satisfies ValidatedSession;

const insertAccount = (database: DatabaseSync) => {
  database
    .prepare(
      "insert into auth_user (id, created_at, updated_at) values (?, ?, ?)"
    )
    .run(userId, now - 2000, now - 2000);
  database
    .prepare(
      `insert into auth_session
        (id, user_id, secret_hash, created_at, expires_at, auth_time,
         authentication_events, aal, amr)
       values (?, ?, 'session-secret-hash', ?, ?, ?, ?, ?, ?)`
    )
    .run(
      sessionId,
      userId,
      now - 1000,
      session.issued.expiresAt,
      session.issued.authTime,
      JSON.stringify(session.issued.authenticationEvents),
      session.issued.aal,
      JSON.stringify(session.issued.amr)
    );
  const expiresAt = now + 60 * 60 * 1000;
  database
    .prepare(
      `insert into auth_verification
        (id, type, subject, secret_hash, created_at, expires_at, metadata)
       values ('recovery-challenge-a',
               'external-recovery-identity-verification', 'recovery-a',
               'hash', ?, ?, '{"userId":"user-a"}')`
    )
    .run(now - 1000, expiresAt);
  database
    .prepare(
      `insert into app_external_recovery_identity
        (id, user_id, address, normalized_address, comparison_key, status,
         challenge_id, challenge_expires_at, enrollment_operation_id,
         created_at, updated_at, version)
       values ('recovery-a', 'user-a', 'recovery@external.test',
               'recovery@external.test', 'recovery@external.test', 'pending',
               'recovery-challenge-a', ?,
               '00000000-0000-4000-8000-000000000020', ?, ?, 1)`
    )
    .run(expiresAt, now - 1000, now - 1000);
  database
    .prepare(
      "update auth_verification set consumed_at = ? where id = 'recovery-challenge-a'"
    )
    .run(now - 500);
  database
    .prepare(
      `update app_external_recovery_identity
          set status = 'verified', verified_at = ?, updated_at = ?, version = 2
        where id = 'recovery-a'`
    )
    .run(now - 500, now - 500);
};

const provideRequest = <A, E, R>(
  effect: Effect.Effect<
    A,
    E,
    AuthPermission.CurrentPrincipal | CurrentRequestAuthShape | R
  >
) =>
  effect.pipe(
    Effect.provideService(
      CurrentRequestAuth,
      CurrentRequestAuth.of({
        sessionSecretHash: "session-secret-hash",
        validated: session,
      })
    ),
    Effect.provideService(
      AuthPermission.CurrentPrincipal,
      AuthPermission.CurrentPrincipal.of(
        AuthPermission.PermissionSubject.user(userId)
      )
    )
  );

describe("recovery-code administration", () => {
  it("atomically replaces active hashes and emits metadata-only audit", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      insertAccount(database);
      const d1 = makeTestD1Database(database);
      const controlPlaneLive = ControlPlaneLive.pipe(
        Layer.provide(
          Layer.succeed(
            ControlPlaneD1Binding,
            ControlPlaneD1Binding.of({ database: d1 as unknown as D1Database })
          )
        )
      );
      const layer = RecoveryCodeAdministrationLive.pipe(
        Layer.provide([
          controlPlaneLive,
          RecoveryCodesLive.pipe(Layer.provide(WebCryptoLive())),
          Layer.succeed(
            AuthRateLimit,
            AuthRateLimit.of({ require: () => Effect.void })
          ),
          Layer.succeed(
            SensitiveOperationStepUpClock,
            SensitiveOperationStepUpClock.of({ now: () => now })
          ),
        ])
      );
      const generate = Effect.gen(function* () {
        const administration = yield* RecoveryCodeAdministration;
        return yield* administration.generate({});
      }).pipe(Effect.provide(layer), provideRequest);

      const first = await Effect.runPromise(generate);
      const second = await Effect.runPromise(generate);
      const rows = database
        .prepare(
          `select code_hash, used_at, revoked_at, metadata
             from auth_recovery_code order by created_at, id`
        )
        .all() as {
        code_hash: string;
        metadata: string;
        revoked_at: number | null;
        used_at: number | null;
      }[];
      const auditRows = database
        .prepare("select event from auth_audit_log order by created_at, id")
        .all() as { event: string }[];

      expect(first.codes).toHaveLength(10);
      expect(new Set(first.codes).size).toBe(10);
      expect(second.codes).toHaveLength(10);
      expect(rows).toHaveLength(20);
      expect(rows.filter((row) => row.revoked_at !== null)).toHaveLength(10);
      expect(rows.filter((row) => row.revoked_at === null)).toHaveLength(10);
      expect(rows.every((row) => row.used_at === null)).toBeTruthy();
      expect(
        rows.every((row) => row.code_hash.startsWith("sha256:"))
      ).toBeTruthy();
      for (const code of [...first.codes, ...second.codes]) {
        expect(JSON.stringify(rows)).not.toContain(code);
        expect(JSON.stringify(auditRows)).not.toContain(code);
      }
      expect(auditRows).toHaveLength(2);
      expect(
        decodeAuditEvent(JSON.parse(auditRows[1]?.event ?? ""))
      ).toMatchObject({
        payload: { codeCount: 10 },
        type: "app.recovery_codes.generated",
      });
    } finally {
      database.close();
    }
  });
});
