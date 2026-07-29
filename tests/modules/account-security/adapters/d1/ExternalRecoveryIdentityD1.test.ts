import { DatabaseSync } from "node:sqlite";

import type { D1Database } from "@cloudflare/workers-types";
import {
  ChallengeId,
  CredentialId,
  SessionId,
  SessionToken,
  UnixMillis as AuthUnixMillis,
  UserId,
} from "@effect-auth/core/Identifiers";
import * as AuthPermission from "@effect-auth/core/Permission";
import type { ValidatedSession } from "@effect-auth/core/Sessions";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  ExternalRecoveryIdentityD1Layer,
  ExternalRecoveryIdentityRuntime,
} from "#/modules/account-security/adapters/d1/ExternalRecoveryIdentityD1";
import { RecoverySafeIdentityD1Layer } from "#/modules/account-security/adapters/d1/RecoverySafeIdentityD1";
import {
  ExternalRecoveryChallengeSecret,
  EnrollExternalRecoveryIdentityCommand,
  ExternalRecoveryIdentityManagement,
  ExternalRecoveryIdentityManagementError,
  ReadExternalRecoveryIdentityOperationQuery,
  VerifyExternalRecoveryIdentityCommand,
} from "#/modules/account-security/application/ExternalRecoveryIdentityManagement";
import { RecoverySafeIdentityRejected } from "#/modules/account-security/domain/RecoverySafeIdentityError";
import { ExternalRecoveryIdentityChallenge } from "#/modules/account-security/ports/ExternalRecoveryIdentityChallenge";
import { ExternalRecoveryIdentityDelivery } from "#/modules/account-security/ports/ExternalRecoveryIdentityDelivery";
import { RecoverySafeIdentityPolicy } from "#/modules/account-security/ports/RecoverySafeIdentityPolicy";
import { SensitiveOperationStepUpClock } from "#/modules/account-security/ports/SensitiveOperationStepUpClock";
import { AdministrativeAudit } from "#/modules/administrative-audit/contracts/AdministrativeAudit";
import { AdministrativeAuditRuntimeLayer } from "#/modules/administrative-audit/layers/AdministrativeAuditLayer";
import {
  MailboxBootstrapConfig,
  MailboxBootstrapConfigValue,
} from "#/modules/organization/contracts/MailboxBootstrapConfig";
import { ControlPlaneD1Layer } from "#/platform/control-plane-d1/ControlPlaneBatch";
import { ControlPlaneD1Binding } from "#/platform/control-plane-d1/ControlPlaneDatabase";
import type { ControlPlaneDatabase } from "#/platform/control-plane-d1/ControlPlaneDatabase";
import { CurrentRequestAuth } from "#/shared/RequestAuth";
import {
  CurrentRequestCorrelation,
  RequestCorrelation,
} from "#/shared/RequestCorrelation";

import {
  applyControlPlaneMigrations,
  makeTestD1Database,
} from "../../../../support/d1";
import type { TestD1DatabaseLike } from "../../../../support/d1";

const now = Date.now();
const challengeSecret = Schema.decodeUnknownSync(
  ExternalRecoveryChallengeSecret
)("a".repeat(43));
const enrollmentCommand = (
  address = "person@external.test",
  operationId = "00000000-0000-4000-8000-000000000031"
) =>
  Schema.decodeUnknownSync(EnrollExternalRecoveryIdentityCommand)({
    address,
    operationId,
  });
const verificationCommand = (
  input: Partial<{
    challengeId: string;
    expectedVersion: number;
    operationId: string;
    secret: string;
  }> = {}
) =>
  Schema.decodeUnknownSync(VerifyExternalRecoveryIdentityCommand)({
    challengeId: "challenge-a",
    expectedVersion: 1,
    operationId: "00000000-0000-4000-8000-000000000032",
    secret: challengeSecret,
    ...input,
  });
const operationQuery = (operationId = "00000000-0000-4000-8000-000000000031") =>
  Schema.decodeUnknownSync(ReadExternalRecoveryIdentityOperationQuery)({
    operationId,
  });
const requestContext = Schema.decodeUnknownSync(RequestCorrelation)({
  correlationId: "00000000-0000-4000-8000-000000000002",
  requestId: "00000000-0000-4000-8000-000000000001",
});

const validatedSession = (
  authenticationEvents: ValidatedSession["currentSession"]["authenticationEvents"] = [
    {
      credentialId: CredentialId("credential-a"),
      type: "password" as const,
      verifiedAt: AuthUnixMillis(now - 100),
      version: 1 as const,
    },
  ],
  user = "user-a",
  session = "session-a"
): ValidatedSession => {
  const userId = UserId(user);
  const sessionId = SessionId(session);
  const currentSession = {
    aal: "aal1" as const,
    amr: authenticationEvents.length === 0 ? [] : ["pwd"],
    authenticationEvents,
    authTime: AuthUnixMillis(now - 100),
    expiresAt: AuthUnixMillis(now + 60 * 60 * 1000),
    sessionId,
    userId,
  };
  return {
    actor: { sessionId, userId },
    currentSession,
    issued: {
      ...currentSession,
      token: SessionToken(`${session}.secret`),
    },
  };
};

const insertSession = (database: DatabaseSync, session: ValidatedSession) => {
  database
    .prepare(
      "insert into auth_user (id, created_at, updated_at) values (?, ?, ?)"
    )
    .run(session.actor.userId, now - 1000, now - 1000);
  database
    .prepare(
      `insert into auth_user_identity
        (id, user_id, scope_type, scope_id, kind, value, normalized_value,
         verified_at, is_primary_login, created_at, updated_at)
       values (?, ?, 'global', 'global', 'email', ?, ?, ?, 1, ?, ?)`
    )
    .run(
      `login-${session.actor.userId}`,
      session.actor.userId,
      `${session.actor.userId}@personal.test`,
      `${session.actor.userId}@personal.test`,
      now - 1000,
      now - 1000,
      now - 1000
    );
  database
    .prepare(
      `insert into auth_session
        (id, user_id, secret_hash, created_at, expires_at, auth_time,
         authentication_events, aal, amr)
       values (?, ?, 'hash', ?, ?, ?, ?, ?, ?)`
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

const managementLive = (
  database: DatabaseSync,
  d1: TestD1DatabaseLike,
  delivered: string[],
  recoveryPolicyLive: Layer.Layer<
    RecoverySafeIdentityPolicy,
    never,
    ControlPlaneDatabase | MailboxBootstrapConfig
  > = RecoverySafeIdentityD1Layer
) => {
  const challengeLive = Layer.succeed(
    ExternalRecoveryIdentityChallenge,
    ExternalRecoveryIdentityChallenge.of({
      consume: (challengeId) =>
        Effect.sync(() => {
          database
            .prepare(
              "update auth_verification set consumed_at = ? where id = ? and consumed_at is null"
            )
            .run(now, challengeId);
        }),
      hashSecret: (secret) =>
        Effect.succeed(secret === challengeSecret ? "hash" : "different-hash"),
      inspect: ({ challengeId, identityId, secret, userId }) =>
        Effect.gen(function* () {
          const row = database
            .prepare(
              `select subject, metadata, consumed_at from auth_verification
                where id = ? and type = 'external-recovery-identity-verification'`
            )
            .get(challengeId) as
            | { consumed_at: number | null; metadata: string; subject: string }
            | undefined;
          if (
            row === undefined ||
            row.subject !== identityId ||
            JSON.parse(row.metadata).userId !== userId ||
            row.consumed_at !== null ||
            secret !== challengeSecret
          ) {
            return yield* new ExternalRecoveryIdentityManagementError({
              operation: "verify",
              reason: "challenge-invalid",
            });
          }
        }),
      issue: ({ identityId, userId }) =>
        Effect.sync(() => {
          const challengeId = ChallengeId("challenge-a");
          const expiresAt = now + 30 * 60 * 1000;
          database
            .prepare(
              `insert into auth_verification
                (id, type, subject, secret_hash, created_at, expires_at, metadata)
               values (?, 'external-recovery-identity-verification', ?, 'hash',
                       ?, ?, ?)`
            )
            .run(
              challengeId,
              identityId,
              now,
              expiresAt,
              JSON.stringify({ userId })
            );
          return {
            challengeId,
            expiresAt,
            secret: Redacted.make(challengeSecret),
          };
        }),
    })
  );
  const deliveryLive = Layer.succeed(
    ExternalRecoveryIdentityDelivery,
    ExternalRecoveryIdentityDelivery.of({
      sendVerification: ({ address }) =>
        Effect.sync(() => {
          delivered.push(address);
        }),
    })
  );
  const controlPlaneLive = ControlPlaneD1Layer.pipe(
    Layer.provide(
      Layer.succeed(
        ControlPlaneD1Binding,
        ControlPlaneD1Binding.of({ database: d1 as unknown as D1Database })
      )
    )
  );

  return ExternalRecoveryIdentityD1Layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        AdministrativeAudit.layerNoDeps.pipe(
          Layer.provide(AdministrativeAuditRuntimeLayer)
        ),
        challengeLive,
        deliveryLive,
        Layer.succeed(
          ExternalRecoveryIdentityRuntime,
          ExternalRecoveryIdentityRuntime.of({
            now: () => now,
            randomId: (() => {
              const ids = [
                "00000000-0000-4000-8000-000000000030",
                "guard-enroll",
                "guard-verify",
              ];
              return () => ids.shift() ?? "guard-fallback";
            })(),
          })
        ),
        recoveryPolicyLive,
        Layer.succeed(
          SensitiveOperationStepUpClock,
          SensitiveOperationStepUpClock.of({ now: () => now })
        )
      )
    ),
    Layer.provide(controlPlaneLive),
    Layer.provide(
      Layer.succeed(
        MailboxBootstrapConfig,
        MailboxBootstrapConfig.of(
          Schema.decodeUnknownSync(MailboxBootstrapConfigValue)({
            initialAddress: "inbox@company.test",
            initialDomain: "company.test",
            ownerEmailAllowlist: ["owner@company.test"],
          })
        )
      )
    )
  );
};

const beforeBatch = (
  database: TestD1DatabaseLike,
  mutation: () => void
): TestD1DatabaseLike => ({
  batch: (statements) => {
    mutation();
    return database.batch(statements);
  },
  prepare: database.prepare,
});

const countRows = (database: DatabaseSync, table: string) =>
  (
    database.prepare(`select count(*) as count from ${table}`).get() as {
      count: number;
    }
  ).count;

const RecoveryPolicyStorageFailureLayer = Layer.succeed(
  RecoverySafeIdentityPolicy,
  RecoverySafeIdentityPolicy.of({
    requireSafeAddress: () =>
      Effect.fail(
        new RecoverySafeIdentityRejected({
          cause: new Error("managed-domain storage unavailable"),
          reason: "storage",
        })
      ),
  })
);

const loseResponseAfterCommit = (
  database: TestD1DatabaseLike
): TestD1DatabaseLike => ({
  batch: async (statements) => {
    await database.batch(statements);
    throw new Error("D1 response lost after commit");
  },
  prepare: database.prepare,
});

const loseResponseWithoutCommit = (
  database: TestD1DatabaseLike
): TestD1DatabaseLike => ({
  batch: () => Promise.reject(new Error("D1 request outcome unknown")),
  prepare: database.prepare,
});

const runAuthenticated = <A, E, R>(
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
      CurrentRequestAuth.of({ sessionSecretHash: "hash", validated: session })
    ),
    Effect.provideService(
      AuthPermission.CurrentPrincipal,
      AuthPermission.CurrentPrincipal.of(
        AuthPermission.PermissionSubject.user(session.actor.userId)
      )
    ),
    Effect.provideService(CurrentRequestCorrelation, requestContext)
  );

describe("external recovery identity management", () => {
  it("preserves recovery-policy storage classification for enrollment", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      const d1 = makeTestD1Database(database);
      const session = validatedSession();
      insertSession(database, session);
      const live = managementLive(
        database,
        d1,
        [],
        RecoveryPolicyStorageFailureLayer
      );

      const error = await Effect.runPromise(
        runAuthenticated(
          Effect.gen(function* () {
            const management = yield* ExternalRecoveryIdentityManagement;
            return yield* management
              .enroll(enrollmentCommand())
              .pipe(Effect.flip);
          }).pipe(Effect.provide(live)),
          session
        )
      );

      expect(error).toMatchObject({ operation: "enroll", reason: "storage" });
      expect(countRows(database, "app_external_recovery_identity")).toBe(0);
    } finally {
      database.close();
    }
  });

  it("preserves recovery-policy storage classification for verification", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      const d1 = makeTestD1Database(database);
      const session = validatedSession();
      insertSession(database, session);
      await Effect.runPromise(
        runAuthenticated(
          Effect.gen(function* () {
            const management = yield* ExternalRecoveryIdentityManagement;
            return yield* management.enroll(enrollmentCommand());
          }).pipe(Effect.provide(managementLive(database, d1, []))),
          session
        )
      );
      const storageFailureLive = managementLive(
        database,
        d1,
        [],
        RecoveryPolicyStorageFailureLayer
      );

      const error = await Effect.runPromise(
        runAuthenticated(
          Effect.gen(function* () {
            const management = yield* ExternalRecoveryIdentityManagement;
            return yield* management
              .verify(verificationCommand())
              .pipe(Effect.flip);
          }).pipe(Effect.provide(storageFailureLive)),
          session
        )
      );

      expect(error).toMatchObject({ operation: "verify", reason: "storage" });
      expect(
        database
          .prepare("select status, version from app_external_recovery_identity")
          .get()
      ).toMatchObject({ status: "pending", version: 1 });
    } finally {
      database.close();
    }
  });
  it("enrolls and verifies without creating login authority", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      const d1 = makeTestD1Database(database);
      const session = validatedSession();
      insertSession(database, session);
      const delivered: string[] = [];
      const live = managementLive(database, d1, delivered);

      const pending = await Effect.runPromise(
        runAuthenticated(
          Effect.gen(function* () {
            const management = yield* ExternalRecoveryIdentityManagement;
            return yield* management.enroll(
              Schema.decodeUnknownSync(EnrollExternalRecoveryIdentityCommand)({
                address: "Person@external.test",
                operationId: "00000000-0000-4000-8000-000000000031",
              })
            );
          }).pipe(Effect.provide(live)),
          session
        )
      );
      const verified = await Effect.runPromise(
        runAuthenticated(
          Effect.gen(function* () {
            const management = yield* ExternalRecoveryIdentityManagement;
            return yield* management.verify(
              Schema.decodeUnknownSync(VerifyExternalRecoveryIdentityCommand)({
                challengeId: ChallengeId("challenge-a"),
                expectedVersion: 1,
                operationId: "00000000-0000-4000-8000-000000000032",
                secret: challengeSecret,
              })
            );
          }).pipe(Effect.provide(live)),
          session
        )
      );

      expect({
        delivered,
        pending: pending.state,
        verified: verified.state,
      }).toStrictEqual({
        delivered: ["Person@external.test"],
        pending: {
          _tag: "Pending",
          challengeExpiresAt: now + 30 * 60 * 1000,
        },
        verified: { _tag: "Verified", verifiedAt: now },
      });
      expect(
        database
          .prepare(
            `select
               (select count(*) from app_administrative_audit_event) as audits,
               (select count(*) from auth_user_identity
                 where normalized_value = 'person@external.test') as login_identities,
               (select consumed_at from auth_verification
                 where id = 'challenge-a') as consumed_at`
          )
          .get()
      ).toMatchObject({ audits: 2, consumed_at: now, login_identities: 0 });
    } finally {
      database.close();
    }
  });

  it("replays enrollment without another challenge or delivery and rejects changed intent, kind, or actor", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      const d1 = makeTestD1Database(database);
      const session = validatedSession();
      const otherSession = validatedSession(undefined, "user-b", "session-b");
      insertSession(database, session);
      insertSession(database, otherSession);
      const delivered: string[] = [];
      const live = managementLive(database, d1, delivered);
      const enroll = (activeSession: ValidatedSession, address: string) =>
        runAuthenticated(
          Effect.gen(function* () {
            const management = yield* ExternalRecoveryIdentityManagement;
            return yield* management.enroll(
              Schema.decodeUnknownSync(EnrollExternalRecoveryIdentityCommand)({
                address,
                operationId: "00000000-0000-4000-8000-000000000031",
              })
            );
          }).pipe(Effect.provide(live)),
          activeSession
        );

      const first = await Effect.runPromise(
        enroll(session, "Person@external.test")
      );
      const replay = await Effect.runPromise(
        enroll(session, "Person@external.test")
      );
      const changedAddress = await Effect.runPromise(
        enroll(session, "other@external.test").pipe(Effect.flip)
      );
      const changedKind = await Effect.runPromise(
        runAuthenticated(
          Effect.gen(function* () {
            const management = yield* ExternalRecoveryIdentityManagement;
            return yield* management
              .verify(
                Schema.decodeUnknownSync(VerifyExternalRecoveryIdentityCommand)(
                  {
                    challengeId: "challenge-a",
                    expectedVersion: 1,
                    operationId: "00000000-0000-4000-8000-000000000031",
                    secret: challengeSecret,
                  }
                )
              )
              .pipe(Effect.flip);
          }).pipe(Effect.provide(live)),
          session
        )
      );
      const changedActor = await Effect.runPromise(
        enroll(otherSession, "Person@external.test").pipe(Effect.flip)
      );

      expect(replay).toStrictEqual(first);
      expect([changedAddress, changedKind, changedActor]).toMatchObject([
        { reason: "operation-conflict" },
        { reason: "operation-conflict" },
        { reason: "operation-conflict" },
      ]);
      expect(delivered).toStrictEqual(["Person@external.test"]);
      expect(
        database
          .prepare("select count(*) as count from auth_verification")
          .get()
      ).toMatchObject({ count: 1 });
    } finally {
      database.close();
    }
  });

  it("replays verification after challenge consumption and distinguishes operation conflicts from optimistic version conflicts", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      const d1 = makeTestD1Database(database);
      const session = validatedSession();
      insertSession(database, session);
      const live = managementLive(database, d1, []);
      const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        Effect.runPromise(
          runAuthenticated(
            effect.pipe(Effect.provide(live)) as Effect.Effect<
              A,
              E,
              | AuthPermission.CurrentPrincipal
              | CurrentRequestAuth
              | RequestCorrelation
            >,
            session
          )
        );
      await run(
        Effect.gen(function* () {
          const management = yield* ExternalRecoveryIdentityManagement;
          return yield* management.enroll(enrollmentCommand());
        })
      );
      const verifyCommand = verificationCommand();
      const optimisticConflict = await run(
        Effect.gen(function* () {
          const management = yield* ExternalRecoveryIdentityManagement;
          return yield* management
            .verify(
              verificationCommand({
                expectedVersion: 2,
                operationId: "00000000-0000-4000-8000-000000000033",
              })
            )
            .pipe(Effect.flip);
        })
      );
      const first = await run(
        Effect.gen(function* () {
          const management = yield* ExternalRecoveryIdentityManagement;
          return yield* management.verify(verifyCommand);
        })
      );
      const replay = await run(
        Effect.gen(function* () {
          const management = yield* ExternalRecoveryIdentityManagement;
          return yield* management.verify(verifyCommand);
        })
      );
      const changedChallenge = await run(
        Effect.gen(function* () {
          const management = yield* ExternalRecoveryIdentityManagement;
          return yield* management
            .verify(verificationCommand({ challengeId: "changed" }))
            .pipe(Effect.flip);
        })
      );
      const changedVersion = await run(
        Effect.gen(function* () {
          const management = yield* ExternalRecoveryIdentityManagement;
          return yield* management
            .verify(verificationCommand({ expectedVersion: 2 }))
            .pipe(Effect.flip);
        })
      );
      const changedSecret = await run(
        Effect.gen(function* () {
          const management = yield* ExternalRecoveryIdentityManagement;
          return yield* management
            .verify(verificationCommand({ secret: "b".repeat(43) }))
            .pipe(Effect.flip);
        })
      );
      expect(replay).toStrictEqual(first);
      expect({
        changedChallenge,
        changedSecret,
        changedVersion,
        optimisticConflict,
      }).toMatchObject({
        changedChallenge: { reason: "operation-conflict" },
        changedSecret: { reason: "operation-conflict" },
        changedVersion: { reason: "operation-conflict" },
        optimisticConflict: { reason: "version-conflict" },
      });
      expect(
        database
          .prepare(
            "select count(*) as count from app_external_recovery_operation_receipt"
          )
          .get()
      ).toMatchObject({ count: 2 });
      expect(() =>
        database.exec(
          `insert into app_external_recovery_operation_receipt
           select '00000000-0000-4000-8000-000000000034', operation_kind,
             actor_user_id, identity_id, challenge_id, expected_identity_version,
             'different-hash', result_user_id, result_status,
             result_challenge_expires_at, result_created_at, result_updated_at,
             result_verified_at, result_revoked_at, result_version,
             committed_at, schema_version
           from app_external_recovery_operation_receipt
           where operation_kind = 'verify'`
        )
      ).toThrow(/binding/u);
    } finally {
      database.close();
    }
  });

  it("rejects enrollment without recent step-up before issuing a challenge", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      const d1 = makeTestD1Database(database);
      const session = validatedSession([]);
      insertSession(database, session);
      const delivered: string[] = [];
      const live = managementLive(database, d1, delivered);

      const error = await Effect.runPromise(
        runAuthenticated(
          Effect.gen(function* () {
            const management = yield* ExternalRecoveryIdentityManagement;
            return yield* management
              .enroll(
                Schema.decodeUnknownSync(EnrollExternalRecoveryIdentityCommand)(
                  {
                    address: "person@external.test",
                    operationId: "00000000-0000-4000-8000-000000000031",
                  }
                )
              )
              .pipe(Effect.flip);
          }).pipe(Effect.provide(live)),
          session
        )
      );

      expect(error).toMatchObject({ reason: "step-up-required" });
      expect({
        audits: database
          .prepare(
            "select count(*) as count from app_administrative_audit_event"
          )
          .get(),
        challenges: database
          .prepare("select count(*) as count from auth_verification")
          .get(),
        delivered,
        identities: database
          .prepare(
            "select count(*) as count from app_external_recovery_identity"
          )
          .get(),
      }).toMatchObject({
        audits: { count: 0 },
        challenges: { count: 0 },
        delivered: [],
        identities: { count: 0 },
      });
    } finally {
      database.close();
    }
  });

  it("rechecks session revocation inside the enrollment batch", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      const session = validatedSession();
      insertSession(database, session);
      const delivered: string[] = [];
      const d1 = beforeBatch(makeTestD1Database(database), () => {
        database
          .prepare("update auth_session set revoked_at = ? where id = ?")
          .run(now, session.actor.sessionId);
      });
      const live = managementLive(database, d1, delivered);

      const error = await Effect.runPromise(
        runAuthenticated(
          Effect.gen(function* () {
            const management = yield* ExternalRecoveryIdentityManagement;
            return yield* management
              .enroll(
                Schema.decodeUnknownSync(EnrollExternalRecoveryIdentityCommand)(
                  {
                    address: "person@external.test",
                    operationId: "00000000-0000-4000-8000-000000000031",
                  }
                )
              )
              .pipe(Effect.flip);
          }).pipe(Effect.provide(live)),
          session
        )
      );

      expect(error).toMatchObject({ reason: "restricted-session" });
      expect(delivered).toStrictEqual(["person@external.test"]);
      expect(
        database
          .prepare(
            `select
               (select count(*) from app_external_recovery_identity) as identities,
               (select count(*) from app_administrative_audit_event) as audits,
               (select count(*) from app_authorization_guard) as guards,
               (select consumed_at from auth_verification
                 where id = 'challenge-a') as consumed_at`
          )
          .get()
      ).toMatchObject({
        audits: 0,
        consumed_at: now,
        guards: 0,
        identities: 0,
      });
    } finally {
      database.close();
    }
  });

  it("rechecks session revocation inside the verification batch", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      const session = validatedSession();
      insertSession(database, session);
      const baseD1 = makeTestD1Database(database);
      await Effect.runPromise(
        runAuthenticated(
          Effect.gen(function* () {
            const management = yield* ExternalRecoveryIdentityManagement;
            return yield* management.enroll(enrollmentCommand());
          }).pipe(Effect.provide(managementLive(database, baseD1, []))),
          session
        )
      );
      const changedD1 = beforeBatch(baseD1, () => {
        database
          .prepare("update auth_session set revoked_at = ? where id = ?")
          .run(now, session.actor.sessionId);
      });

      const error = await Effect.runPromise(
        runAuthenticated(
          Effect.gen(function* () {
            const management = yield* ExternalRecoveryIdentityManagement;
            return yield* management
              .verify(verificationCommand())
              .pipe(Effect.flip);
          }).pipe(Effect.provide(managementLive(database, changedD1, []))),
          session
        )
      );

      expect(error).toMatchObject({ reason: "restricted-session" });
      expect(
        database
          .prepare(
            `select
               (select consumed_at from auth_verification
                 where id = 'challenge-a') as consumed_at,
               (select status from app_external_recovery_identity
                 where challenge_id = 'challenge-a') as identity_status,
               (select version from app_external_recovery_identity
                 where challenge_id = 'challenge-a') as identity_version,
               (select count(*) from app_external_recovery_operation_receipt)
                 as receipts,
               (select count(*) from app_administrative_audit_event) as audits`
          )
          .get()
      ).toMatchObject({
        audits: 1,
        consumed_at: null,
        identity_status: "pending",
        identity_version: 1,
        receipts: 1,
      });
    } finally {
      database.close();
    }
  });

  it("recovers an enrollment whose committed D1 response is lost", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      const session = validatedSession();
      insertSession(database, session);
      const d1 = loseResponseAfterCommit(makeTestD1Database(database));
      const live = managementLive(database, d1, []);

      const result = await Effect.runPromise(
        runAuthenticated(
          Effect.gen(function* () {
            const management = yield* ExternalRecoveryIdentityManagement;
            return yield* management.enroll(
              Schema.decodeUnknownSync(EnrollExternalRecoveryIdentityCommand)({
                address: "person@external.test",
                operationId: "00000000-0000-4000-8000-000000000031",
              })
            );
          }).pipe(Effect.provide(live)),
          session
        )
      );

      expect(result.state._tag).toBe("Pending");
      expect(
        database
          .prepare(
            `select
               (select count(*) from app_external_recovery_identity) as identities,
               (select count(*) from app_administrative_audit_event) as audits,
               (select count(*) from app_external_recovery_operation_receipt) as receipts,
               (select count(*) from app_authorization_guard) as guards,
               (select consumed_at from auth_verification
                 where id = 'challenge-a') as consumed_at`
          )
          .get()
      ).toMatchObject({
        audits: 1,
        consumed_at: null,
        guards: 0,
        identities: 1,
        receipts: 1,
      });
    } finally {
      database.close();
    }
  });

  it("keeps an unknown commit state unknown when no receipt exists", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      const session = validatedSession();
      insertSession(database, session);
      const d1 = loseResponseWithoutCommit(makeTestD1Database(database));
      const live = managementLive(database, d1, []);

      const error = await Effect.runPromise(
        runAuthenticated(
          Effect.gen(function* () {
            const management = yield* ExternalRecoveryIdentityManagement;
            return yield* management
              .enroll(enrollmentCommand())
              .pipe(Effect.flip);
          }).pipe(Effect.provide(live)),
          session
        )
      );

      expect(error).toMatchObject({
        commitState: "unknown",
        reason: "storage",
      });
      expect(
        database
          .prepare(
            `select
               (select count(*) from app_external_recovery_identity) as identities,
               (select count(*) from app_external_recovery_operation_receipt) as receipts,
               (select count(*) from app_administrative_audit_event) as audits`
          )
          .get()
      ).toMatchObject({ audits: 0, identities: 0, receipts: 0 });
    } finally {
      database.close();
    }
  });

  it("recovers a committed verification after its challenge was consumed", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      const session = validatedSession();
      insertSession(database, session);
      const baseD1 = makeTestD1Database(database);
      await Effect.runPromise(
        runAuthenticated(
          Effect.gen(function* () {
            const management = yield* ExternalRecoveryIdentityManagement;
            return yield* management.enroll(enrollmentCommand());
          }).pipe(Effect.provide(managementLive(database, baseD1, []))),
          session
        )
      );

      const verified = await Effect.runPromise(
        runAuthenticated(
          Effect.gen(function* () {
            const management = yield* ExternalRecoveryIdentityManagement;
            return yield* management.verify(verificationCommand());
          }).pipe(
            Effect.provide(
              managementLive(database, loseResponseAfterCommit(baseD1), [])
            )
          ),
          session
        )
      );

      expect(verified).toMatchObject({
        state: { _tag: "Verified", verifiedAt: now },
        version: 2,
      });
      expect(
        database
          .prepare(
            `select
               (select consumed_at from auth_verification where id = 'challenge-a') as consumed_at,
               (select count(*) from app_external_recovery_operation_receipt) as receipts`
          )
          .get()
      ).toMatchObject({ consumed_at: now, receipts: 2 });
    } finally {
      database.close();
    }
  });

  it("keeps receipt readback actor-scoped and denies restricted sessions", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      const d1 = makeTestD1Database(database);
      const session = validatedSession();
      const otherSession = validatedSession(undefined, "user-b", "session-b");
      insertSession(database, session);
      insertSession(database, otherSession);
      const live = managementLive(database, d1, []);
      await Effect.runPromise(
        runAuthenticated(
          Effect.gen(function* () {
            const management = yield* ExternalRecoveryIdentityManagement;
            return yield* management.enroll(enrollmentCommand());
          }).pipe(Effect.provide(live)),
          session
        )
      );
      const read = (activeSession: ValidatedSession) =>
        runAuthenticated(
          Effect.gen(function* () {
            const management = yield* ExternalRecoveryIdentityManagement;
            return yield* management.readOperation(operationQuery());
          }).pipe(Effect.provide(live)),
          activeSession
        );
      const receipt = await Effect.runPromise(read(session));
      const isolated = await Effect.runPromise(
        read(otherSession).pipe(Effect.flip)
      );
      const restricted = {
        ...session,
        currentSession: {
          ...session.currentSession,
          claims: { requirements: ["email_verification"] },
        },
        issued: {
          ...session.issued,
          claims: { requirements: ["email_verification"] },
        },
      } as ValidatedSession;
      const restrictedRead = await Effect.runPromise(
        read(restricted).pipe(Effect.flip)
      );
      const restrictedReplay = await Effect.runPromise(
        runAuthenticated(
          Effect.gen(function* () {
            const management = yield* ExternalRecoveryIdentityManagement;
            return yield* management
              .enroll(enrollmentCommand())
              .pipe(Effect.flip);
          }).pipe(Effect.provide(live)),
          restricted
        )
      );

      expect(receipt).toMatchObject({
        actorUserId: "user-a",
        operationKind: "enroll",
        result: { email: { address: "person@external.test" } },
      });
      expect(receipt).not.toHaveProperty("verificationSecretHash");
      expect(isolated).toMatchObject({ reason: "not-found" });
      expect([restrictedRead, restrictedReplay]).toMatchObject([
        { reason: "restricted-session" },
        { reason: "restricted-session" },
      ]);
    } finally {
      database.close();
    }
  });

  it("enforces receipt state binding and immutability in D1", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      const d1 = makeTestD1Database(database);
      const session = validatedSession();
      insertSession(database, session);
      await Effect.runPromise(
        runAuthenticated(
          Effect.gen(function* () {
            const management = yield* ExternalRecoveryIdentityManagement;
            return yield* management.enroll(enrollmentCommand());
          }).pipe(Effect.provide(managementLive(database, d1, []))),
          session
        )
      );

      expect(() =>
        database.exec(
          "update app_external_recovery_operation_receipt set committed_at = committed_at + 1"
        )
      ).toThrow(/immutable/u);
      const receiptColumns = database
        .prepare("pragma table_info(app_external_recovery_operation_receipt)")
        .all();
      const storedReceipt = database
        .prepare("select * from app_external_recovery_operation_receipt")
        .get();
      const receiptColumnNames = receiptColumns.map(({ name }) => name);
      expect({
        containsAddress: receiptColumnNames.some((name) =>
          [
            "result_address",
            "result_normalized_address",
            "result_comparison_key",
          ].includes(String(name))
        ),
        containsEmail: JSON.stringify(storedReceipt).includes(
          "person@external.test"
        ),
      }).toStrictEqual({ containsAddress: false, containsEmail: false });
      expect(() =>
        database.exec("delete from app_external_recovery_operation_receipt")
      ).toThrow(/retained/u);
      expect(() =>
        database.exec(
          `insert or replace into app_external_recovery_operation_receipt
           select * from app_external_recovery_operation_receipt`
        )
      ).toThrow(/immutable/u);
      expect(() =>
        database.exec(
          `insert into app_external_recovery_operation_receipt
           select '00000000-0000-4000-8000-000000000039', operation_kind,
             actor_user_id, identity_id, challenge_id, expected_identity_version,
             verification_secret_hash, result_user_id, result_status,
             result_challenge_expires_at,
             result_created_at, result_updated_at, result_verified_at,
             result_revoked_at, result_version, committed_at, schema_version
           from app_external_recovery_operation_receipt`
        )
      ).toThrow(/binding/u);
    } finally {
      database.close();
    }
  });

  it("rolls back identity and audit when receipt insertion fails", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      const d1 = makeTestD1Database(database);
      const session = validatedSession();
      insertSession(database, session);
      database.exec(`create trigger fail_recovery_receipt
        before insert on app_external_recovery_operation_receipt
        begin
          select raise(abort, 'receipt failed');
        end`);
      const live = managementLive(database, d1, []);

      const error = await Effect.runPromise(
        runAuthenticated(
          Effect.gen(function* () {
            const management = yield* ExternalRecoveryIdentityManagement;
            return yield* management
              .enroll(enrollmentCommand())
              .pipe(Effect.flip);
          }).pipe(Effect.provide(live)),
          session
        )
      );

      expect(error).toMatchObject({
        commitState: "unknown",
        reason: "storage",
      });
      expect(
        database
          .prepare(
            `select
               (select count(*) from app_external_recovery_identity) as identities,
               (select count(*) from app_external_recovery_operation_receipt) as receipts,
               (select count(*) from app_administrative_audit_event) as audits,
               (select consumed_at from auth_verification where id = 'challenge-a') as consumed_at`
          )
          .get()
      ).toMatchObject({
        audits: 0,
        consumed_at: null,
        identities: 0,
        receipts: 0,
      });
    } finally {
      database.close();
    }
  });

  it("rolls back challenge consumption when verification audit fails", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      const d1 = makeTestD1Database(database);
      const session = validatedSession();
      insertSession(database, session);
      const live = managementLive(database, d1, []);
      await Effect.runPromise(
        runAuthenticated(
          Effect.gen(function* () {
            const management = yield* ExternalRecoveryIdentityManagement;
            return yield* management.enroll(
              Schema.decodeUnknownSync(EnrollExternalRecoveryIdentityCommand)({
                address: "person@external.test",
                operationId: "00000000-0000-4000-8000-000000000031",
              })
            );
          }).pipe(Effect.provide(live)),
          session
        )
      );
      database.exec(`create trigger fail_recovery_verification_audit
        before insert on app_administrative_audit_event
        when new.action = 'external-recovery-identity.verify'
        begin
          select raise(abort, 'verification audit failed');
        end`);

      const error = await Effect.runPromise(
        runAuthenticated(
          Effect.gen(function* () {
            const management = yield* ExternalRecoveryIdentityManagement;
            return yield* management
              .verify(
                Schema.decodeUnknownSync(VerifyExternalRecoveryIdentityCommand)(
                  {
                    challengeId: "challenge-a",
                    expectedVersion: 1,
                    operationId: "00000000-0000-4000-8000-000000000032",
                    secret: challengeSecret,
                  }
                )
              )
              .pipe(Effect.flip);
          }).pipe(Effect.provide(live)),
          session
        )
      );

      expect(error).toMatchObject({ reason: "storage" });
      expect(
        database
          .prepare(
            `select recovery.status, recovery.version, challenge.consumed_at,
                    (select count(*) from app_external_recovery_operation_receipt
                      where operation_kind = 'verify') as verification_receipts
               from app_external_recovery_identity as recovery
               join auth_verification as challenge
                 on challenge.id = recovery.challenge_id`
          )
          .get()
      ).toMatchObject({
        consumed_at: null,
        status: "pending",
        verification_receipts: 0,
        version: 1,
      });
    } finally {
      database.close();
    }
  });
});
