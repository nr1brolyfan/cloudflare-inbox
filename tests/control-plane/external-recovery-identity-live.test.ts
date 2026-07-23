import { DatabaseSync } from "node:sqlite";

import type { D1Database } from "@cloudflare/workers-types";
import type { D1EffectQbDatabaseLike } from "@effect-auth/core/EffectQbSqliteStorage";
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
  ExternalRecoveryChallengeSecret,
  EnrollExternalRecoveryIdentityCommand,
  ExternalRecoveryIdentityChallenge,
  ExternalRecoveryIdentityDelivery,
  ExternalRecoveryIdentityManagement,
  ExternalRecoveryIdentityManagementError,
  VerifyExternalRecoveryIdentityCommand,
} from "#/auth/external-recovery-identity-management";
import type { CurrentRequestAuthShape } from "#/auth/session";
import { CurrentRequestAuth } from "#/auth/session";
import { SensitiveOperationStepUpClock } from "#/auth/step-up-policy";
import {
  ExternalRecoveryIdentityManagementLive,
  ExternalRecoveryIdentityRuntime,
} from "#/control-plane/external-recovery-identity-live";
import {
  MailboxAdministrationConfig,
  MailboxAdministrationOwnerEmail,
} from "#/control-plane/mailbox-administration-live";
import { RecoverySafeIdentityPolicyLive } from "#/control-plane/recovery-safe-identity-live";
import {
  AdministrativeAuditLayer,
  AdministrativeAuditRuntimeLayer,
} from "#/modules/administrative-audit/layers/AdministrativeAuditLayer";
import {
  BackendRequestContext,
  CurrentBackendRequestContext,
} from "#/observability/request-context";
import { ControlPlaneD1Layer } from "#/platform/control-plane-d1/ControlPlaneBatch";
import { ControlPlaneD1Binding } from "#/platform/control-plane-d1/ControlPlaneDatabase";

import { applyControlPlaneMigrations, makeTestD1Database } from "../support/d1";

const now = Date.now();
const challengeSecret = Schema.decodeUnknownSync(
  ExternalRecoveryChallengeSecret
)("a".repeat(43));
const requestContext = Schema.decodeUnknownSync(BackendRequestContext)({
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
  ]
): ValidatedSession => {
  const userId = UserId("user-a");
  const sessionId = SessionId("session-a");
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
      token: SessionToken("session-a.secret"),
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
       values ('login-a', ?, 'global', 'global', 'email', 'user@personal.test',
               'user@personal.test', ?, 1, ?, ?)`
    )
    .run(session.actor.userId, now - 1000, now - 1000, now - 1000);
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
  d1: D1EffectQbDatabaseLike,
  delivered: string[]
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

  return ExternalRecoveryIdentityManagementLive.pipe(
    Layer.provide(
      Layer.mergeAll(
        AdministrativeAuditLayer.pipe(
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
        RecoverySafeIdentityPolicyLive,
        Layer.succeed(
          SensitiveOperationStepUpClock,
          SensitiveOperationStepUpClock.of({ now: () => now })
        )
      )
    ),
    Layer.provide(controlPlaneLive),
    Layer.provide(
      Layer.succeed(
        MailboxAdministrationConfig,
        MailboxAdministrationConfig.of({
          ownerEmail: Schema.decodeUnknownSync(MailboxAdministrationOwnerEmail)(
            "owner@company.test"
          ),
        })
      )
    )
  );
};

const beforeBatch = (
  database: D1EffectQbDatabaseLike,
  mutation: () => void
): D1EffectQbDatabaseLike => ({
  batch: (statements) => {
    mutation();
    return database.batch(statements);
  },
  prepare: database.prepare,
});

const loseResponseAfterCommit = (
  database: D1EffectQbDatabaseLike
): D1EffectQbDatabaseLike => ({
  batch: async (statements) => {
    await database.batch(statements);
    throw new Error("D1 response lost after commit");
  },
  prepare: database.prepare,
});

const runAuthenticated = <A, E, R>(
  effect: Effect.Effect<
    A,
    E,
    | AuthPermission.CurrentPrincipal
    | BackendRequestContext
    | CurrentRequestAuthShape
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
    Effect.provideService(CurrentBackendRequestContext, requestContext)
  );

describe("external recovery identity management", () => {
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

  it("does not compensate an enrollment whose commit result is unknown", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      const session = validatedSession();
      insertSession(database, session);
      const d1 = loseResponseAfterCommit(makeTestD1Database(database));
      const live = managementLive(database, d1, []);

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

      expect(error).toMatchObject({
        commitState: "unknown",
        reason: "storage",
      });
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
        audits: 1,
        consumed_at: null,
        guards: 0,
        identities: 1,
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
            `select recovery.status, recovery.version, challenge.consumed_at
               from app_external_recovery_identity as recovery
               join auth_verification as challenge
                 on challenge.id = recovery.challenge_id`
          )
          .get()
      ).toMatchObject({ consumed_at: null, status: "pending", version: 1 });
    } finally {
      database.close();
    }
  });
});
