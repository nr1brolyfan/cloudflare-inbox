/* oxlint-disable vitest/max-expects -- One atomic commit test verifies all recovery state transitions together. */
import { DatabaseSync } from "node:sqlite";

import type { D1Database } from "@cloudflare/workers-types";
import { emptyCustomEvidencePolicyRegistry } from "@effect-auth/core/Assurance";
import { AuthFlowState } from "@effect-auth/core/AuthFlow";
import { AuthRateLimit } from "@effect-auth/core/AuthRateLimit";
import { Crypto } from "@effect-auth/core/Crypto";
import {
  AuthFlowId,
  ChallengeId,
  CredentialId,
  SessionId,
  SessionToken,
  UnixMillis,
  UserId,
} from "@effect-auth/core/Identifiers";
import { RecoveryCodeManagement } from "@effect-auth/core/RecoveryCode";
import { Sessions } from "@effect-auth/core/Sessions";
import type {
  IssuedSession,
  SessionCreateInput,
  SessionTtlPolicy,
  SessionsService,
} from "@effect-auth/core/Sessions";
import { VerificationStore } from "@effect-auth/core/Storage";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { describe, expect, it } from "vitest";

import {
  AccountRecovery,
  AccountRecoveryDelivery,
  externalRecoveryLinkEvidence,
} from "#/auth/account-recovery";
import { RecoverySafeIdentityPolicy } from "#/auth/external-recovery-identity";
import { AccountRecoveryLive } from "#/control-plane/account-recovery-live";
import { ControlPlaneD1Layer } from "#/platform/control-plane-d1/ControlPlaneBatch";
import { ControlPlaneD1Binding } from "#/platform/control-plane-d1/ControlPlaneDatabase";

import { applyControlPlaneMigrations, makeTestD1Database } from "../support/d1";

const now = Date.now();
const userId = UserId("user-a");
const flowId = AuthFlowId("account-recovery-flow-a");
const codeId = CredentialId("recovery-code-a");
const sessionId = SessionId("recovery-session-a");
const metadata = {
  externalRecoveryIdentityId: "recovery-a",
  externalRecoveryIdentityVersion: 2,
  purpose: "account-recovery",
} as const;
const evidence = externalRecoveryLinkEvidence.make({
  properties: {
    externalRecoveryIdentityId: "recovery-a",
    externalRecoveryIdentityVersion: 2,
  },
  verifiedAt: UnixMillis(now - 100),
});
const verification = {
  id: ChallengeId(flowId),
  type: "auth-flow-state",
  subject: userId,
  secretHash: "flow-secret-hash",
  createdAt: UnixMillis(now - 1000),
  expiresAt: UnixMillis(now + 60_000),
  metadata: { encoded: "flow-state" },
};
const issuedSession = {
  aal: "aal1" as const,
  amr: ["external_recovery_link", "recovery_code"],
  authenticationEvents: [evidence],
  authTime: UnixMillis(now),
  claims: {
    recoveryRemediation: { allowed: ["second-passkey"] },
    requirements: ["recovery_remediation"],
  },
  expiresAt: UnixMillis(now + 60 * 60 * 1000),
  sessionId,
  token: SessionToken(`${sessionId}.secret`),
  userId,
} satisfies IssuedSession;
const preparedRow = {
  aal: issuedSession.aal,
  amr: issuedSession.amr,
  authenticationEvents: issuedSession.authenticationEvents,
  authTime: issuedSession.authTime,
  claims: issuedSession.claims,
  createdAt: UnixMillis(now),
  expiresAt: issuedSession.expiresAt,
  id: sessionId,
  metadata,
  secretHash: "new-session-secret-hash",
  userId,
};

const insertEligibleAccount = (database: DatabaseSync) => {
  database
    .prepare(
      "insert into auth_user (id, created_at, updated_at) values (?, ?, ?)"
    )
    .run(userId, now - 10_000, now - 10_000);
  database
    .prepare(
      `insert into auth_verification
        (id, type, subject, secret_hash, created_at, expires_at, metadata)
       values (?, 'auth-flow-state', ?, ?, ?, ?, ?)`
    )
    .run(
      flowId,
      userId,
      verification.secretHash,
      verification.createdAt,
      verification.expiresAt,
      JSON.stringify(verification.metadata)
    );
  database
    .prepare(
      `insert into auth_verification
        (id, type, subject, secret_hash, created_at, expires_at, metadata)
       values ('recovery-challenge-a',
               'external-recovery-identity-verification', 'recovery-a',
               'hash', ?, ?, '{"userId":"user-a"}')`
    )
    .run(now - 2000, now + 60_000);
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
    .run(now + 60_000, now - 2000, now - 2000);
  database
    .prepare(
      "update auth_verification set consumed_at = ? where id = 'recovery-challenge-a'"
    )
    .run(now - 1500);
  database
    .prepare(
      `update app_external_recovery_identity
          set status = 'verified', verified_at = ?, updated_at = ?, version = 2
        where id = 'recovery-a'`
    )
    .run(now - 1500, now - 1500);
  database
    .prepare(
      `insert into auth_recovery_code
        (id, user_id, code_hash, created_at, metadata)
       values (?, ?, 'sha256:test-hash', ?, '{"setId":"set-a"}')`
    )
    .run(codeId, userId, now - 1000);
};

describe("account recovery", () => {
  it("atomically consumes the external proof and code into a restricted session", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      insertEligibleAccount(database);
      const d1 = makeTestD1Database(database);
      let preparedTtl: SessionTtlPolicy | undefined;
      const controlPlaneLive = ControlPlaneD1Layer.pipe(
        Layer.provide(
          Layer.succeed(
            ControlPlaneD1Binding,
            ControlPlaneD1Binding.of({ database: d1 as unknown as D1Database })
          )
        )
      );
      const layer = AccountRecoveryLive.pipe(
        Layer.provide([
          controlPlaneLive,
          Layer.mock(AuthFlowState, {
            inspect: () =>
              Effect.succeed({
                evidence: [evidence],
                expiresAt: verification.expiresAt,
                factors: [{ type: "backup-code" }],
                flowId,
                metadata,
                method: "external-recovery-link",
                userId,
              }),
            start: () => Effect.die("start is not used"),
          }),
          Layer.mock(AuthRateLimit, { require: () => Effect.void }),
          Layer.mock(Crypto, { randomToken: () => Effect.succeed("unused") }),
          Layer.mock(AccountRecoveryDelivery, {
            send: () => Effect.die("delivery is not used"),
          }),
          Layer.mock(RecoverySafeIdentityPolicy, {
            requireExternalRecoveryAddress: () => Effect.void,
          }),
          Layer.mock(RecoveryCodeManagement, {
            identifyForUser: () =>
              Effect.succeed({
                code: { createdAt: UnixMillis(now - 1000), id: codeId },
                valid: true,
              }),
          }),
          Layer.succeed(
            Sessions,
            Sessions.of({
              customEvidencePolicies: emptyCustomEvidencePolicyRegistry,
              prepareCreate: (input: SessionCreateInput) => {
                preparedTtl = input.ttl;
                return Effect.succeed({
                  row: preparedRow,
                  session: issuedSession,
                });
              },
            } as unknown as SessionsService)
          ),
          Layer.mock(VerificationStore, {
            findById: () => Effect.succeed(Option.some(verification)),
          }),
        ])
      );
      const complete = Effect.gen(function* () {
        const recovery = yield* AccountRecovery;
        return yield* recovery.complete({
          code: "AAAA-BBBB-CCCC-DDDD",
          flowId,
          secret: "s".repeat(32),
        });
      }).pipe(Effect.provide(layer));

      const result = await Effect.runPromise(complete);
      const storedVerification = database
        .prepare("select consumed_at from auth_verification where id = ?")
        .get(flowId) as { consumed_at: number | null };
      const storedCode = database
        .prepare("select used_at from auth_recovery_code where id = ?")
        .get(codeId) as { used_at: number | null };
      const storedSession = database
        .prepare("select metadata from auth_session where id = ?")
        .get(sessionId) as { metadata: string };
      const audits = database
        .prepare("select type from auth_audit_log where user_id = ?")
        .all(userId) as { type: string }[];

      expect(result).toBe(issuedSession);
      expect(storedVerification.consumed_at).not.toBeNull();
      expect(storedCode.used_at).not.toBeNull();
      expect(JSON.parse(storedSession.metadata)).toMatchObject({
        __effectAuthSession: {
          claims: { requirements: ["recovery_remediation"] },
        },
      });
      expect(audits).toContainEqual({ type: "app.account_recovery.entered" });
      expect(
        preparedTtl === undefined
          ? undefined
          : {
              absolute: Duration.toMillis(preparedTtl.absoluteTtl),
              idle: Duration.toMillis(preparedTtl.idleTtl),
              refresh: Duration.toMillis(preparedTtl.refreshAfter),
            }
      ).toStrictEqual({
        absolute: 15 * 60 * 1000,
        idle: 15 * 60 * 1000,
        refresh: 15 * 60 * 1000,
      });
      await expect(Effect.runPromise(complete)).rejects.toMatchObject({
        reason: "invalid-proof",
      });
    } finally {
      database.close();
    }
  });
});
