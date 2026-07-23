import { DatabaseSync } from "node:sqlite";

import type { D1Database } from "@cloudflare/workers-types";
import { decodeAuditEvent } from "@effect-auth/core/AuditLog";
import { AuthRateLimit } from "@effect-auth/core/AuthRateLimit";
import type { D1EffectQbDatabaseLike } from "@effect-auth/core/EffectQbSqliteStorage";
import {
  CredentialId,
  SessionId,
  SessionToken,
  UnixMillis,
  UserId,
} from "@effect-auth/core/Identifiers";
import * as AuthPermission from "@effect-auth/core/Permission";
import type { ValidatedSession } from "@effect-auth/core/Sessions";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  PasskeyCredentialAdministrationD1Layer,
  PasskeyCredentialAdministrationRuntime,
} from "#/modules/account-security/adapters/d1/PasskeyCredentialAdministrationD1";
import {
  PasskeyCredentialAdministration,
  PasskeyCredentialAdministrationError,
  RevokePasskeyCredentialCommand,
} from "#/modules/account-security/application/PasskeyCredentialAdministration";
import { SensitiveOperationStepUpClock } from "#/modules/account-security/ports/SensitiveOperationStepUpClock";
import { ControlPlaneD1Layer } from "#/platform/control-plane-d1/ControlPlaneBatch";
import { ControlPlaneD1Binding } from "#/platform/control-plane-d1/ControlPlaneDatabase";
import { CurrentRequestAuth } from "#/shared/RequestAuth";
import {
  CurrentRequestCorrelation,
  RequestCorrelation,
} from "#/shared/RequestCorrelation";

import {
  applyControlPlaneMigrations,
  makeTestD1Database,
} from "../../../../support/d1";

const now = Date.now();
const operationId = "00000000-0000-4000-8000-000000000040";
const otherOperationId = "00000000-0000-4000-8000-000000000041";
const requestContext = Schema.decodeUnknownSync(RequestCorrelation)({
  correlationId: "00000000-0000-4000-8000-000000000002",
  requestId: "00000000-0000-4000-8000-000000000001",
});

interface TestState {
  readonly rateLimitOperations: string[];
}

const validatedSession = (): ValidatedSession => {
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

  return {
    actor: { sessionId, userId },
    currentSession,
    issued: {
      ...currentSession,
      token: SessionToken("session-a.secret"),
    },
  };
};

const insertAccount = (database: DatabaseSync, session: ValidatedSession) => {
  database
    .prepare(
      "insert into auth_user (id, created_at, updated_at) values (?, ?, ?)"
    )
    .run(session.actor.userId, now - 2000, now - 2000);
  database
    .prepare(
      `insert into auth_session
        (id, user_id, secret_hash, created_at, expires_at, auth_time,
         authentication_events, aal, amr)
       values (?, ?, 'session-secret-hash', ?, ?, ?, ?, ?, ?)`
    )
    .run(
      session.actor.sessionId,
      session.actor.userId,
      now - 1000,
      session.issued.expiresAt,
      session.issued.authTime,
      JSON.stringify(session.issued.authenticationEvents),
      session.issued.aal,
      JSON.stringify(session.issued.amr)
    );
};

const insertVerifiedRecovery = (database: DatabaseSync) => {
  const expiresAt = now + 60 * 60 * 1000;
  database
    .prepare(
      `insert into auth_verification
        (id, type, subject, secret_hash, created_at, expires_at, metadata)
       values ('recovery-challenge-a',
               'external-recovery-identity-verification', 'recovery-a',
               'recovery-secret-hash', ?, ?, '{"userId":"user-a"}')`
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

const insertCredential = (
  database: DatabaseSync,
  id: string,
  createdAt: number,
  options: { readonly revokedAt?: number; readonly userId?: string } = {}
) => {
  database
    .prepare(
      `insert into auth_passkey_credential
        (id, user_id, credential_id, public_key, sign_count, transports,
         backed_up, created_at, last_used_at, revoked_at, metadata)
       values (?, ?, ?, ?, 7, '["internal"]', 1, ?, ?, ?, ?)`
    )
    .run(
      id,
      options.userId ?? "user-a",
      `webauthn-${id}`,
      `sensitive-public-key-${id}`,
      createdAt,
      createdAt + 100,
      options.revokedAt ?? null,
      `{"aaguid":"sensitive-${id}"}`
    );
};

const administrationLive = (d1: D1EffectQbDatabaseLike, state: TestState) => {
  const controlPlaneLive = ControlPlaneD1Layer.pipe(
    Layer.provide(
      Layer.succeed(
        ControlPlaneD1Binding,
        ControlPlaneD1Binding.of({ database: d1 as unknown as D1Database })
      )
    )
  );

  return PasskeyCredentialAdministrationD1Layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        controlPlaneLive,
        Layer.succeed(
          AuthRateLimit,
          AuthRateLimit.of({
            require: ({ operation }) =>
              Effect.sync(() => {
                state.rateLimitOperations.push(operation);
              }),
          })
        ),
        Layer.succeed(
          PasskeyCredentialAdministrationRuntime,
          PasskeyCredentialAdministrationRuntime.of({
            now: () => now,
            randomId: () => "passkey-revocation-guard",
          })
        ),
        Layer.succeed(
          SensitiveOperationStepUpClock,
          SensitiveOperationStepUpClock.of({ now: () => now })
        )
      )
    )
  );
};

const provideRequestAuth = <A, E, R>(
  effect: Effect.Effect<
    A,
    E,
    | AuthPermission.CurrentPrincipal
    | RequestCorrelation
    | CurrentRequestAuth
    | R
  >,
  session: ValidatedSession
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
        AuthPermission.PermissionSubject.user(session.actor.userId)
      )
    ),
    Effect.provideService(CurrentRequestCorrelation, requestContext)
  );

const runList = (
  d1: D1EffectQbDatabaseLike,
  state: TestState,
  session: ValidatedSession
) =>
  provideRequestAuth(
    Effect.gen(function* () {
      const administration = yield* PasskeyCredentialAdministration;
      return yield* administration.list({});
    }).pipe(Effect.provide(administrationLive(d1, state))),
    session
  );

const runRevoke = (
  d1: D1EffectQbDatabaseLike,
  state: TestState,
  session: ValidatedSession,
  id = "passkey-a",
  requestedOperationId = operationId
) =>
  provideRequestAuth(
    Effect.gen(function* () {
      const administration = yield* PasskeyCredentialAdministration;
      return yield* administration.revoke(
        Schema.decodeUnknownSync(RevokePasskeyCredentialCommand)({
          id,
          operationId: requestedOperationId,
        })
      );
    }).pipe(Effect.provide(administrationLive(d1, state))),
    session
  );

const countRows = (database: DatabaseSync, table: string) =>
  (
    database.prepare(`select count(*) as count from ${table}`).get() as {
      count: number;
    }
  ).count;

const setup = async () => {
  const database = new DatabaseSync(":memory:");
  await applyControlPlaneMigrations(database);
  const session = validatedSession();
  insertAccount(database, session);
  insertVerifiedRecovery(database);
  return { database, session };
};

describe("passkey credential administration", () => {
  it("lists only privacy-safe active credentials owned by the current user", async () => {
    const { database, session } = await setup();
    try {
      insertCredential(database, "passkey-a", now - 3000);
      insertCredential(database, "passkey-b", now - 2000);
      insertCredential(database, "passkey-revoked", now - 4000, {
        revokedAt: now - 1000,
      });
      database
        .prepare(
          "insert into auth_user (id, created_at, updated_at) values ('user-b', ?, ?)"
        )
        .run(now - 2000, now - 2000);
      insertCredential(database, "passkey-other-user", now - 1000, {
        userId: "user-b",
      });
      const state: TestState = { rateLimitOperations: [] };

      const result = await Effect.runPromise(
        runList(makeTestD1Database(database), state, session)
      );
      const serialized = JSON.stringify(result);

      expect(result).toMatchObject({
        credentials: [
          {
            createdAt: now - 2000,
            id: "passkey-b",
            lastUsedAt: now - 1900,
          },
          {
            createdAt: now - 3000,
            id: "passkey-a",
            lastUsedAt: now - 2900,
          },
        ],
      });
      expect(serialized).not.toContain("webauthn-");
      expect(serialized).not.toContain("sensitive-public-key");
      expect(serialized).not.toContain("aaguid");
      expect(state.rateLimitOperations).toStrictEqual([
        "auth.passkey.credentials.list",
      ]);
    } finally {
      database.close();
    }
  });

  it("atomically revokes a non-final passkey and records a metadata-only receipt and audit", async () => {
    const { database, session } = await setup();
    try {
      insertCredential(database, "passkey-a", now - 3000);
      insertCredential(database, "passkey-b", now - 2000);
      const state: TestState = { rateLimitOperations: [] };

      const receipt = await Effect.runPromise(
        runRevoke(makeTestD1Database(database), state, session)
      );

      expect(receipt).toMatchObject({
        credential: {
          createdAt: now - 3000,
          id: "passkey-a",
          lastUsedAt: now - 2900,
          revokedAt: expect.any(Number),
        },
        operationId,
      });
      expect(
        database
          .prepare(
            "select revoked_at from auth_passkey_credential where id = 'passkey-a'"
          )
          .get()
      ).toMatchObject({ revoked_at: receipt.credential.revokedAt });
      expect({
        audit: countRows(database, "auth_audit_log"),
        guards: countRows(database, "app_authorization_guard"),
        receipts: countRows(database, "app_passkey_credential_revocation"),
      }).toStrictEqual({ audit: 1, guards: 0, receipts: 1 });
      const auditRow = database
        .prepare("select event from auth_audit_log")
        .get() as { event: string };
      const audit = decodeAuditEvent(JSON.parse(auditRow.event));
      expect(audit).toMatchObject({
        payload: { credentialRecordId: "passkey-a", operationId },
        type: "app.passkey.credential.revoked",
        version: 1,
      });
      const serializedAudit = JSON.stringify(audit);
      expect({
        containsCredentialId: serializedAudit.includes("webauthn-passkey-a"),
        containsPublicKey: serializedAudit.includes("sensitive-public-key"),
        rateLimitOperations: state.rateLimitOperations,
      }).toStrictEqual({
        containsCredentialId: false,
        containsPublicKey: false,
        rateLimitOperations: ["auth.passkey.credentials.revoke"],
      });
    } finally {
      database.close();
    }
  });

  it("protects the final active passkey", async () => {
    const { database, session } = await setup();
    try {
      insertCredential(database, "passkey-a", now - 3000);

      const error = await Effect.runPromise(
        runRevoke(
          makeTestD1Database(database),
          { rateLimitOperations: [] },
          session
        ).pipe(Effect.flip)
      );

      expect(error).toBeInstanceOf(PasskeyCredentialAdministrationError);
      expect(error).toMatchObject({
        operation: "revoke",
        reason: "last-factor",
      });
      expect(countRows(database, "app_passkey_credential_revocation")).toBe(0);
      expect(
        database
          .prepare(
            "select revoked_at from auth_passkey_credential where id = 'passkey-a'"
          )
          .get()
      ).toMatchObject({ revoked_at: null });
    } finally {
      database.close();
    }
  });

  it("fails closed when verified recovery is revoked before the atomic batch", async () => {
    const { database, session } = await setup();
    try {
      insertCredential(database, "passkey-a", now - 3000);
      insertCredential(database, "passkey-b", now - 2000);
      const baseD1 = makeTestD1Database(database);
      let changed = false;
      const changedD1: D1EffectQbDatabaseLike = {
        batch: (statements) => {
          if (!changed) {
            changed = true;
            database
              .prepare(
                `update app_external_recovery_identity
                    set status = 'revoked', revoked_at = ?, updated_at = ?,
                        version = version + 1
                  where id = 'recovery-a'`
              )
              .run(now, now);
          }
          return baseD1.batch(statements);
        },
        prepare: baseD1.prepare,
      };

      const error = await Effect.runPromise(
        runRevoke(changedD1, { rateLimitOperations: [] }, session).pipe(
          Effect.flip
        )
      );

      expect(error).toMatchObject({
        operation: "revoke",
        reason: "recovery-identity-required",
      });
      expect(countRows(database, "app_passkey_credential_revocation")).toBe(0);
      expect(countRows(database, "auth_audit_log")).toBe(0);
    } finally {
      database.close();
    }
  });

  it("fails as unauthenticated when the token-bound session is revoked before the batch", async () => {
    const { database, session } = await setup();
    try {
      insertCredential(database, "passkey-a", now - 3000);
      insertCredential(database, "passkey-b", now - 2000);
      const baseD1 = makeTestD1Database(database);
      let changed = false;
      const changedD1: D1EffectQbDatabaseLike = {
        batch: (statements) => {
          if (!changed) {
            changed = true;
            database
              .prepare(
                "update auth_session set revoked_at = ? where id = 'session-a'"
              )
              .run(now);
          }
          return baseD1.batch(statements);
        },
        prepare: baseD1.prepare,
      };

      const error = await Effect.runPromise(
        runRevoke(changedD1, { rateLimitOperations: [] }, session).pipe(
          Effect.flip
        )
      );

      expect(error).toMatchObject({
        operation: "revoke",
        reason: "unauthenticated",
      });
      expect(countRows(database, "app_passkey_credential_revocation")).toBe(0);
      expect(countRows(database, "auth_audit_log")).toBe(0);
    } finally {
      database.close();
    }
  });

  it("uses an atomic timestamp no earlier than a concurrent last-use update", async () => {
    const { database, session } = await setup();
    try {
      insertCredential(database, "passkey-a", now - 3000);
      insertCredential(database, "passkey-b", now - 2000);
      const futureLastUsedAt = now + 5000;
      const baseD1 = makeTestD1Database(database);
      let changed = false;
      const changedD1: D1EffectQbDatabaseLike = {
        batch: (statements) => {
          if (!changed) {
            changed = true;
            database
              .prepare(
                "update auth_passkey_credential set last_used_at = ? where id = 'passkey-a'"
              )
              .run(futureLastUsedAt);
          }
          return baseD1.batch(statements);
        },
        prepare: baseD1.prepare,
      };

      const receipt = await Effect.runPromise(
        runRevoke(changedD1, { rateLimitOperations: [] }, session)
      );

      expect(receipt.credential).toMatchObject({
        id: "passkey-a",
        lastUsedAt: futureLastUsedAt,
      });
      expect(receipt.credential.revokedAt).toBeGreaterThanOrEqual(
        futureLastUsedAt
      );
    } finally {
      database.close();
    }
  });

  it("returns an exact durable replay before step-up and rate limiting", async () => {
    const { database, session } = await setup();
    try {
      insertCredential(database, "passkey-a", now - 3000);
      insertCredential(database, "passkey-b", now - 2000);
      const firstState: TestState = { rateLimitOperations: [] };
      const first = await Effect.runPromise(
        runRevoke(makeTestD1Database(database), firstState, session)
      );
      database
        .prepare(
          "update auth_session set authentication_events = '[]', amr = '[]' where id = 'session-a'"
        )
        .run();
      const replayState: TestState = { rateLimitOperations: [] };

      const replay = await Effect.runPromise(
        runRevoke(makeTestD1Database(database), replayState, session)
      );

      expect(replay).toStrictEqual(first);
      expect(replayState.rateLimitOperations).toStrictEqual([]);
      expect(countRows(database, "auth_audit_log")).toBe(1);
      expect(countRows(database, "app_passkey_credential_revocation")).toBe(1);
    } finally {
      database.close();
    }
  });

  it("rejects reuse of an operation ID for a different credential", async () => {
    const { database, session } = await setup();
    try {
      insertCredential(database, "passkey-a", now - 3000);
      insertCredential(database, "passkey-b", now - 2000);
      insertCredential(database, "passkey-c", now - 1000);
      const d1 = makeTestD1Database(database);
      await Effect.runPromise(
        runRevoke(d1, { rateLimitOperations: [] }, session)
      );

      const error = await Effect.runPromise(
        runRevoke(d1, { rateLimitOperations: [] }, session, "passkey-b").pipe(
          Effect.flip
        )
      );

      expect(error).toMatchObject({
        operation: "revoke",
        reason: "operation-conflict",
      });
      expect(
        database
          .prepare(
            "select revoked_at from auth_passkey_credential where id = 'passkey-b'"
          )
          .get()
      ).toMatchObject({ revoked_at: null });
    } finally {
      database.close();
    }
  });

  it("reads the durable receipt after an unknown committed batch response", async () => {
    const { database, session } = await setup();
    try {
      insertCredential(database, "passkey-a", now - 3000);
      insertCredential(database, "passkey-b", now - 2000);
      const baseD1 = makeTestD1Database(database);
      const unknownCommitD1: D1EffectQbDatabaseLike = {
        batch: async (statements) => {
          await baseD1.batch(statements);
          throw new Error("connection ended after commit");
        },
        prepare: baseD1.prepare,
      };

      const receipt = await Effect.runPromise(
        runRevoke(unknownCommitD1, { rateLimitOperations: [] }, session)
      );

      expect(receipt).toMatchObject({
        credential: { id: "passkey-a", revokedAt: expect.any(Number) },
        operationId,
      });
      expect(countRows(database, "auth_audit_log")).toBe(1);
      expect(countRows(database, "app_passkey_credential_revocation")).toBe(1);
    } finally {
      database.close();
    }
  });

  it("rejects a mismatched receipt discovered after an unknown batch response", async () => {
    const { database, session } = await setup();
    try {
      insertCredential(database, "passkey-a", now - 3000);
      insertCredential(database, "passkey-b", now - 2000);
      const baseD1 = makeTestD1Database(database);
      const conflictingD1: D1EffectQbDatabaseLike = {
        batch: () => {
          database
            .prepare(
              "update auth_passkey_credential set revoked_at = ? where id = 'passkey-b'"
            )
            .run(now);
          database
            .prepare(
              `insert into app_passkey_credential_revocation
                (operation_id, user_id, credential_record_id,
                 credential_created_at, credential_last_used_at, revoked_at)
               values (?, 'user-a', 'passkey-b', ?, ?, ?)`
            )
            .run(operationId, now - 2000, now - 1900, now);
          throw new Error("indeterminate conflicting operation");
        },
        prepare: baseD1.prepare,
      };

      const error = await Effect.runPromise(
        runRevoke(conflictingD1, { rateLimitOperations: [] }, session).pipe(
          Effect.flip
        )
      );

      expect(error).toMatchObject({
        operation: "revoke",
        reason: "operation-conflict",
      });
      expect(
        database
          .prepare(
            "select revoked_at from auth_passkey_credential where id = 'passkey-a'"
          )
          .get()
      ).toMatchObject({ revoked_at: null });
    } finally {
      database.close();
    }
  });

  it("rolls back credential and receipt when the audit insert fails", async () => {
    const { database, session } = await setup();
    try {
      insertCredential(database, "passkey-a", now - 3000);
      insertCredential(database, "passkey-b", now - 2000);
      database.exec(`create trigger fail_passkey_revocation_audit
        before insert on auth_audit_log
        when new.type = 'app.passkey.credential.revoked'
        begin
          select raise(abort, 'passkey revocation audit failed');
        end`);

      const error = await Effect.runPromise(
        runRevoke(
          makeTestD1Database(database),
          { rateLimitOperations: [] },
          session,
          "passkey-a",
          otherOperationId
        ).pipe(Effect.flip)
      );

      expect(error).toMatchObject({
        commitState: "unknown",
        operation: "revoke",
        reason: "storage",
      });
      expect(
        database
          .prepare(
            "select revoked_at from auth_passkey_credential where id = 'passkey-a'"
          )
          .get()
      ).toMatchObject({ revoked_at: null });
      expect(countRows(database, "app_passkey_credential_revocation")).toBe(0);
      expect(countRows(database, "auth_audit_log")).toBe(0);
    } finally {
      database.close();
    }
  });

  it("makes revocation receipts immutable", async () => {
    const { database, session } = await setup();
    try {
      insertCredential(database, "passkey-a", now - 3000);
      insertCredential(database, "passkey-b", now - 2000);
      await Effect.runPromise(
        runRevoke(
          makeTestD1Database(database),
          { rateLimitOperations: [] },
          session
        )
      );

      expect(() =>
        database
          .prepare(
            "update app_passkey_credential_revocation set revoked_at = revoked_at + 1"
          )
          .run()
      ).toThrow("passkey revocation receipts are immutable");
      expect(() =>
        database.prepare("delete from app_passkey_credential_revocation").run()
      ).toThrow("passkey revocation receipts are retained");
    } finally {
      database.close();
    }
  });
});
