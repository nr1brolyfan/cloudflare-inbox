import { DatabaseSync } from "node:sqlite";

import { emptyCustomEvidencePolicyRegistry } from "@effect-auth/core/Assurance";
import { decodeAuditEvent } from "@effect-auth/core/AuditLog";
import { AuthRateLimit } from "@effect-auth/core/AuthRateLimit";
import type { ChallengeService } from "@effect-auth/core/Challenge";
import { Challenge, ChallengeVerifyError } from "@effect-auth/core/Challenge";
import type { CryptoService } from "@effect-auth/core/Crypto";
import { Crypto } from "@effect-auth/core/Crypto";
import type { D1EffectQbDatabaseLike } from "@effect-auth/core/EffectQbSqliteStorage";
import {
  ChallengeId,
  CredentialId,
  SessionId,
  SessionToken,
  UnixMillis,
  UserId,
} from "@effect-auth/core/Identifiers";
import {
  PasskeyCredentialId,
  PasskeyOptions,
  PasskeyVerifier,
} from "@effect-auth/core/Passkey";
import * as AuthPermission from "@effect-auth/core/Permission";
import {
  RecoveryCode,
  RecoveryCodeHash,
  RecoveryCodes,
} from "@effect-auth/core/RecoveryCode";
import type { RecoveryCodesService } from "@effect-auth/core/RecoveryCode";
import { Sessions } from "@effect-auth/core/Sessions";
import type {
  SessionCreateInput,
  SessionsService,
  ValidatedSession,
} from "@effect-auth/core/Sessions";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import { externalRecoveryLinkEvidence } from "#/auth/account-recovery";
import {
  PasskeyRuntimeConfig,
  PasskeyRuntimeConfigSchema,
} from "#/auth/passkey-config";
import {
  PasskeyEnrollment,
  PasskeyEnrollmentError,
} from "#/auth/passkey-enrollment";
import type { CurrentRequestAuthShape } from "#/auth/session";
import { CurrentRequestAuth } from "#/auth/session";
import { SensitiveOperationStepUpClock } from "#/auth/step-up-policy";
import { ControlPlaneLive } from "#/control-plane/batch";
import { ControlPlaneD1Binding } from "#/control-plane/database";
import {
  PasskeyEnrollmentLive,
  PasskeyEnrollmentRuntime,
} from "#/control-plane/passkey-enrollment-live";
import {
  BackendRequestContext,
  CurrentBackendRequestContext,
} from "#/observability/request-context";

import { applyControlPlaneMigrations, makeTestD1Database } from "../support/d1";

const now = Date.now();
const challengeSecret = "passkey-challenge-secret";
const credentialPublicKey = "sensitive-passkey-public-key";
const operationId = "00000000-0000-4000-8000-000000000030";
const requestContext = Schema.decodeUnknownSync(BackendRequestContext)({
  correlationId: "00000000-0000-4000-8000-000000000002",
  requestId: "00000000-0000-4000-8000-000000000001",
});
const passkeyConfig = Schema.decodeUnknownSync(PasskeyRuntimeConfigSchema)({
  attestation: "none",
  authenticatorSelection: {
    requireResidentKey: true,
    residentKey: "required",
    userVerification: "required",
  },
  expectedOrigin: "https://inbox.example.test",
  relyingParty: {
    id: "inbox.example.test",
    name: "Cloudflare Inbox",
  },
  requireUserVerification: true,
  userVerification: "required",
});
const clientCredential = {
  id: "browser-credential",
  response: { attestationObject: "client-attestation" },
  type: "public-key" as const,
};

interface TestState {
  optionCalls: number;
  randomTokenCalls: number;
  rateLimitOperations: string[];
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

const recoveryRemediationSession = (): ValidatedSession => {
  const session = validatedSession();
  const claims = {
    recoveryRemediation: { allowed: ["second-passkey"] },
    requirements: ["recovery_remediation"],
  } as const;
  const recoveryEvidence = externalRecoveryLinkEvidence.make({
    properties: {
      externalRecoveryIdentityId: "recovery-a",
      externalRecoveryIdentityVersion: 2,
    },
    verifiedAt: UnixMillis(now - 100),
  });
  return {
    ...session,
    currentSession: {
      ...session.currentSession,
      authenticationEvents: [recoveryEvidence],
      claims,
    },
    issued: {
      ...session.issued,
      authenticationEvents: [recoveryEvidence],
      claims,
    },
  };
};

const insertSession = (database: DatabaseSync, session: ValidatedSession) => {
  const metadata =
    session.issued.claims === undefined
      ? null
      : JSON.stringify({
          __effectAuthSession: {
            claims: session.issued.claims,
            version: 1,
          },
        });
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
       values ('login-a', ?, 'global', 'global', 'email', 'user@example.test',
               'user@example.test', ?, 1, ?, ?)`
    )
    .run(session.actor.userId, now - 1000, now - 1000, now - 1000);
  database
    .prepare(
      `insert into auth_session
        (id, user_id, secret_hash, created_at, expires_at, auth_time,
          authentication_events, aal, amr, metadata)
        values (?, ?, 'session-secret-hash', ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      session.actor.sessionId,
      session.actor.userId,
      now - 1000,
      session.issued.expiresAt,
      session.issued.authTime,
      JSON.stringify(session.issued.authenticationEvents),
      session.issued.aal,
      JSON.stringify(session.issued.amr),
      metadata
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

const challengeLive = (database: DatabaseSync) => {
  const service: ChallengeService = {
    consume: () => Effect.die("consume is not used"),
    inspect: ({ challengeId, secret, type }) =>
      Effect.gen(function* () {
        const row = database
          .prepare(
            `select type, subject, expires_at, metadata, consumed_at
               from auth_verification where id = ?`
          )
          .get(challengeId) as
          | {
              consumed_at: number | null;
              expires_at: number;
              metadata: string;
              subject: string;
              type: string;
            }
          | undefined;
        if (
          row === undefined ||
          row.type !== type ||
          row.consumed_at !== null ||
          row.expires_at <= now ||
          secret === undefined ||
          Redacted.value(secret) !== challengeSecret
        ) {
          return yield* new ChallengeVerifyError({
            message: "Invalid test challenge",
          });
        }
        return {
          expiresAt: UnixMillis(row.expires_at),
          id: challengeId,
          metadata: JSON.parse(row.metadata) as Readonly<
            Record<string, unknown>
          >,
          subject: row.subject,
          type: row.type,
        };
      }),
    issue: () => Effect.die("issue is owned by the PasskeyOptions stub"),
    verify: () => Effect.die("verify is not used"),
  };
  return Layer.succeed(Challenge, service);
};

const passkeyOptionsLive = (database: DatabaseSync, state: TestState) =>
  Layer.succeed(
    PasskeyOptions,
    PasskeyOptions.of({
      startAuthentication: () => Effect.die("authentication is not used"),
      startRegistration: (input) =>
        Effect.sync(() => {
          state.optionCalls += 1;
          const challengeId = ChallengeId(
            `passkey-enrollment-challenge-${state.optionCalls}`
          );
          const expiresAt = UnixMillis(now + 30 * 60 * 1000);
          database
            .prepare(
              `insert into auth_verification
                (id, type, subject, secret_hash, created_at, expires_at,
                 metadata)
               values (?, 'passkey-registration', ?, 'passkey-secret-hash',
                       ?, ?, ?)`
            )
            .run(
              challengeId,
              input.userId,
              now,
              expiresAt,
              JSON.stringify(input.metadata)
            );
          return {
            challengeId,
            expiresAt,
            publicKey: {
              attestation: input.attestation,
              authenticatorSelection: input.authenticatorSelection,
              challenge: challengeSecret,
              pubKeyCredParams: [{ alg: -7, type: "public-key" as const }],
              rp: input.relyingParty,
              user: {
                displayName: input.userDisplayName,
                id: input.userId,
                name: input.userName,
              },
            },
          };
        }),
    })
  );

const passkeyVerifierLive = Layer.succeed(
  PasskeyVerifier,
  PasskeyVerifier.of({
    readAuthenticationCredentialId: () => Effect.die("read is not used"),
    verifyAuthentication: () => Effect.die("authentication is not used"),
    verifyRegistration: () =>
      Effect.succeed({
        backedUp: true,
        challenge: challengeSecret,
        credentialId: PasskeyCredentialId("passkey-credential-a"),
        metadata: { aaguid: "test-aaguid" },
        publicKey: credentialPublicKey,
        signCount: 0,
        transports: ["internal"],
      }),
  })
);

const cryptoService = (state: TestState): CryptoService => ({
  digestSha256: () => Effect.die("digest is not used"),
  hmacSha256: () => Effect.die("hmac is not used"),
  randomBytes: () => Effect.die("randomBytes is not used"),
  randomToken: () =>
    Effect.sync(() => {
      state.randomTokenCalls += 1;
      return state.randomTokenCalls === 1
        ? "passkey-record-a"
        : `recovery-code-${state.randomTokenCalls - 1}`;
    }),
  timingSafeEqual: () => Effect.die("timingSafeEqual is not used"),
});

const recoveryCodeValues = [
  "AAAA-BBBB-CCCC-2222",
  "AAAA-BBBB-CCCC-3333",
  "AAAA-BBBB-CCCC-4444",
  "AAAA-BBBB-CCCC-5555",
  "AAAA-BBBB-CCCC-6666",
  "AAAA-BBBB-CCCC-7777",
  "AAAA-BBBB-CCCC-8888",
  "AAAA-BBBB-CCCC-9999",
  "AAAA-BBBB-CCCC-AAAA",
  "AAAA-BBBB-CCCC-BBBB",
] as const;

const recoveryCodesService: RecoveryCodesService = {
  generate: () =>
    Effect.succeed(
      recoveryCodeValues.map((code) => Redacted.make(RecoveryCode(code)))
    ),
  hash: ({ code }) =>
    Effect.succeed(
      RecoveryCodeHash(
        `sha256:test-${recoveryCodeValues.indexOf(
          Redacted.value(code) as (typeof recoveryCodeValues)[number]
        )}`
      )
    ),
  normalize: (code) =>
    Effect.succeed(Redacted.make(RecoveryCode(Redacted.value(code)))),
  verify: () => Effect.die("verify is not used"),
};

const sessionsService: SessionsService = {
  customEvidencePolicies: emptyCustomEvidencePolicyRegistry,
  prepareCreate: (input: SessionCreateInput) => {
    const sessionId = SessionId("recovered-session-a");
    const authTime = input.now ?? UnixMillis(now);
    return Effect.succeed({
      row: {
        aal: "aal2",
        amr: ["passkey"],
        authenticationEvents: input.authenticationEvents,
        authTime,
        claims: input.claims,
        createdAt: authTime,
        expiresAt: UnixMillis(Number(authTime) + 60 * 60 * 1000),
        id: sessionId,
        metadata: input.metadata,
        secretHash: "recovered-session-secret-hash",
        userId: input.userId,
      },
      session: {
        aal: "aal2",
        amr: ["passkey"],
        authenticationEvents: input.authenticationEvents,
        authTime,
        claims: input.claims,
        expiresAt: UnixMillis(Number(authTime) + 60 * 60 * 1000),
        sessionId,
        token: SessionToken(`${sessionId}.recovered-secret`),
        userId: input.userId,
      },
    });
  },
} as unknown as SessionsService;

const enrollmentLive = (
  database: DatabaseSync,
  d1: D1EffectQbDatabaseLike,
  state: TestState
) => {
  const bindingLive = Layer.succeed(
    ControlPlaneD1Binding,
    ControlPlaneD1Binding.of({
      database: d1 as unknown as D1Database,
    })
  );

  return PasskeyEnrollmentLive.pipe(
    Layer.provide(
      Layer.mergeAll(
        ControlPlaneLive.pipe(Layer.provide(bindingLive)),
        Layer.succeed(
          AuthRateLimit,
          AuthRateLimit.of({
            require: ({ operation }) =>
              Effect.sync(() => {
                state.rateLimitOperations.push(operation);
              }),
          })
        ),
        challengeLive(database),
        Layer.succeed(Crypto, cryptoService(state)),
        Layer.succeed(RecoveryCodes, recoveryCodesService),
        Layer.succeed(Sessions, sessionsService),
        passkeyOptionsLive(database, state),
        passkeyVerifierLive,
        Layer.succeed(PasskeyRuntimeConfig, passkeyConfig),
        Layer.succeed(
          PasskeyEnrollmentRuntime,
          PasskeyEnrollmentRuntime.of({
            now: () => now,
            randomId: () => operationId,
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
    | BackendRequestContext
    | CurrentRequestAuthShape
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
    Effect.provideService(CurrentBackendRequestContext, requestContext)
  );

const start = (
  database: DatabaseSync,
  d1: D1EffectQbDatabaseLike,
  state: TestState,
  session: ValidatedSession
) =>
  provideRequestAuth(
    Effect.gen(function* () {
      const enrollment = yield* PasskeyEnrollment;
      return yield* enrollment.start({});
    }).pipe(Effect.provide(enrollmentLive(database, d1, state))),
    session
  );

const finish = (
  database: DatabaseSync,
  d1: D1EffectQbDatabaseLike,
  state: TestState,
  session: ValidatedSession,
  challengeId: string
) =>
  provideRequestAuth(
    Effect.gen(function* () {
      const enrollment = yield* PasskeyEnrollment;
      return yield* enrollment.finish({
        challengeId: ChallengeId(challengeId),
        credential: clientCredential,
      });
    }).pipe(Effect.provide(enrollmentLive(database, d1, state))),
    session
  );

const countRows = (database: DatabaseSync, table: string) =>
  (
    database.prepare(`select count(*) as count from ${table}`).get() as {
      count: number;
    }
  ).count;

const makeState = (): TestState => ({
  optionCalls: 0,
  randomTokenCalls: 0,
  rateLimitOperations: [],
});

describe("guarded passkey enrollment", () => {
  it("starts and atomically finishes enrollment using the D1 RETURNING row", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      const session = validatedSession();
      insertSession(database, session);
      insertVerifiedRecovery(database);
      const baseD1 = makeTestD1Database(database);
      let returningRows: readonly unknown[] | undefined;
      const observedD1: D1EffectQbDatabaseLike = {
        batch: async (statements) => {
          const results = await baseD1.batch(statements);
          returningRows = results[3]?.results;
          return results;
        },
        prepare: baseD1.prepare,
      };
      const state = makeState();

      const started = await Effect.runPromise(
        start(database, observedD1, state, session)
      );
      const enrolled = await Effect.runPromise(
        finish(database, observedD1, state, session, started.challengeId)
      );

      expect(enrolled).toStrictEqual({ credentialId: "passkey-credential-a" });
      expect(
        returningRows?.map(
          (row) => (row as { credential_id: string }).credential_id
        )
      ).toStrictEqual(["passkey-credential-a"]);
      const challengeRow = database
        .prepare("select consumed_at from auth_verification where id = ?")
        .get(started.challengeId) as { consumed_at: number | null };
      expect({
        auditEvents: countRows(database, "auth_audit_log"),
        consumedAt: challengeRow.consumed_at,
        credentials: countRows(database, "auth_passkey_credential"),
        guards: countRows(database, "app_authorization_guard"),
      }).toStrictEqual({
        auditEvents: 1,
        consumedAt: now,
        credentials: 1,
        guards: 0,
      });
      const auditRow = database
        .prepare(
          `select id, type, user_id, actor_user_id, occurred_at, event,
                  created_at
             from auth_audit_log`
        )
        .get() as Record<string, unknown> & { event: string };
      expect({
        decoded: decodeAuditEvent(JSON.parse(auditRow.event)),
        row: auditRow,
      }).toMatchObject({
        decoded: {
          payload: { credentialRecordId: "passkey-record-a", operationId },
          type: "app.passkey.enrolled",
          version: 1,
        },
        row: {
          actor_user_id: "user-a",
          created_at: now,
          id: `passkey-enrollment:${operationId}`,
          occurred_at: now,
          type: "app.passkey.enrolled",
          user_id: "user-a",
        },
      });
      const serializedAudit = JSON.stringify(
        database.prepare("select * from auth_audit_log").get()
      );
      expect({
        containsChallengeSecret: serializedAudit.includes(challengeSecret),
        containsPublicKey: serializedAudit.includes(credentialPublicKey),
        rateLimitOperations: state.rateLimitOperations,
      }).toStrictEqual({
        containsChallengeSecret: false,
        containsPublicKey: false,
        rateLimitOperations: [
          "auth.passkey.registration_start",
          "auth.passkey.registration_finish",
        ],
      });
    } finally {
      database.close();
    }
  });

  it("atomically completes restricted recovery with a new session and code set", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      const session = recoveryRemediationSession();
      insertSession(database, session);
      insertVerifiedRecovery(database);
      database
        .prepare(
          `insert into auth_session
            (id, user_id, secret_hash, created_at, expires_at, auth_time,
             authentication_events, aal, amr)
           values ('other-session-a', 'user-a', 'other-secret-hash', ?, ?, ?,
                   '[]', 'aal1', '["pwd"]')`
        )
        .run(now - 1000, now + 60 * 60 * 1000, now - 1000);
      database
        .prepare(
          `insert into auth_recovery_code
            (id, user_id, code_hash, created_at, metadata)
           values ('old-recovery-code-a', 'user-a', 'sha256:old', ?,
                   '{"setId":"old-set"}')`
        )
        .run(now - 1000);
      database
        .prepare(
          `insert into auth_passkey_credential
            (id, user_id, credential_id, public_key, sign_count, created_at)
           values ('old-passkey-a', 'user-a', 'old-passkey-credential-a',
                   'old-public-key', 0, ?)`
        )
        .run(now - 1000);
      database
        .prepare(
          `insert into auth_credential
            (id, user_id, type, password_hash, created_at, updated_at)
           values ('old-password-a', 'user-a', 'password', 'old-hash', ?, ?)`
        )
        .run(now - 1000, now - 1000);
      database
        .prepare(
          `insert into auth_totp_factor
            (id, user_id, secret, algorithm, digits, period, created_at,
             confirmed_at)
           values ('old-totp-a', 'user-a', 'old-secret', 'SHA1', 6, 30, ?, ?)`
        )
        .run(now - 1000, now - 1000);
      const d1 = makeTestD1Database(database);
      const state = makeState();

      const started = await Effect.runPromise(
        start(database, d1, state, session)
      );
      const result = await Effect.runPromise(
        finish(database, d1, state, session, started.challengeId)
      );
      const sessions = database
        .prepare(
          "select id, revoked_at, metadata from auth_session order by id"
        )
        .all() as {
        id: string;
        metadata: string | null;
        revoked_at: number | null;
      }[];
      const codes = database
        .prepare(
          `select id, code_hash, used_at, revoked_at
             from auth_recovery_code order by id`
        )
        .all() as {
        code_hash: string;
        id: string;
        revoked_at: number | null;
        used_at: number | null;
      }[];
      const audits = database
        .prepare("select type from auth_audit_log order by type")
        .all() as { type: string }[];
      const oldCredentials = {
        passkey: database
          .prepare(
            "select revoked_at from auth_passkey_credential where id = 'old-passkey-a'"
          )
          .get() as { revoked_at: number | null },
        password: database
          .prepare(
            "select revoked_at from auth_credential where id = 'old-password-a'"
          )
          .get() as { revoked_at: number | null },
        totp: database
          .prepare(
            "select revoked_at from auth_totp_factor where id = 'old-totp-a'"
          )
          .get() as { revoked_at: number | null },
      };
      const identities = database
        .prepare(
          `select kind, revoked_at, is_primary_login
             from auth_user_identity where user_id = 'user-a' order by kind`
        )
        .all() as {
        is_primary_login: number;
        kind: string;
        revoked_at: number | null;
      }[];
      const activeCodes = codes.filter(
        (code) => code.used_at === null && code.revoked_at === null
      );
      const recoveredSession = sessions.find(
        (stored) => stored.id === "recovered-session-a"
      );
      const serializedStorage = JSON.stringify({ audits, codes, sessions });

      const summary = {
        activeCodeCount: activeCodes.length,
        auditTypes: audits.map((audit) => audit.type),
        codesReturned: result.remediation?.body.codes,
        credentialId: result.credentialId,
        newSession: recoveredSession,
        loginIdentities: identities.map((identity) => ({
          isPrimaryLogin: identity.is_primary_login,
          kind: identity.kind,
          revoked: identity.revoked_at !== null,
        })),
        oldCredentialsRevoked: Object.values(oldCredentials).every(
          (credential) => credential.revoked_at !== null
        ),
        oldCodesRevoked: codes
          .filter((code) => code.id === "old-recovery-code-a")
          .every((code) => code.revoked_at !== null),
        oldSessionsRevoked: sessions
          .filter((stored) => stored.id !== "recovered-session-a")
          .every((stored) => stored.revoked_at !== null),
        plaintextPersisted: recoveryCodeValues.some((code) =>
          serializedStorage.includes(code)
        ),
        returnedSessionId: result.remediation?.session.sessionId,
      };
      expect(structuredClone(summary)).toStrictEqual({
        activeCodeCount: 10,
        auditTypes: ["app.account_recovery.completed", "app.passkey.enrolled"],
        codesReturned: [...recoveryCodeValues],
        credentialId: "passkey-credential-a",
        newSession: {
          id: "recovered-session-a",
          metadata: JSON.stringify({
            __effectAuthSession: {
              claims: {
                verifiedIdentityKinds: ["email", "recovery-passkey"],
              },
              metadata: { purpose: "account-recovery-completed" },
              version: 1,
            },
          }),
          revoked_at: null,
        },
        loginIdentities: [
          { isPrimaryLogin: 1, kind: "email", revoked: true },
          { isPrimaryLogin: 1, kind: "recovery-passkey", revoked: false },
        ],
        oldCredentialsRevoked: true,
        oldCodesRevoked: true,
        oldSessionsRevoked: true,
        plaintextPersisted: false,
        returnedSessionId: "recovered-session-a",
      });
    } finally {
      database.close();
    }
  });

  it("rejects remediation after its recovery identity version changes", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      const session = recoveryRemediationSession();
      insertSession(database, session);
      insertVerifiedRecovery(database);
      database
        .prepare(
          `update app_external_recovery_identity
              set status = 'revoked', revoked_at = ?, version = version + 1,
                  updated_at = ?
            where id = 'recovery-a'`
        )
        .run(now, now);
      const state = makeState();

      const failure = await Effect.runPromise(
        start(database, makeTestD1Database(database), state, session).pipe(
          Effect.flip
        )
      );

      expect(failure).toMatchObject({
        operation: "start",
        reason: "recovery-identity-required",
      });
      expect(state.optionCalls).toBe(0);
    } finally {
      database.close();
    }
  });

  it("rejects missing verified recovery before challenge issuance", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      const session = validatedSession();
      insertSession(database, session);
      const state = makeState();

      const error = await Effect.runPromise(
        start(database, makeTestD1Database(database), state, session).pipe(
          Effect.flip
        )
      );

      expect(error).toBeInstanceOf(PasskeyEnrollmentError);
      expect(error).toMatchObject({
        operation: "start",
        reason: "recovery-identity-required",
      });
      expect(state.optionCalls).toBe(0);
      expect(countRows(database, "auth_verification")).toBe(0);
    } finally {
      database.close();
    }
  });

  it("rolls back challenge consumption and credential insertion when audit fails", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      const session = validatedSession();
      insertSession(database, session);
      insertVerifiedRecovery(database);
      const d1 = makeTestD1Database(database);
      const state = makeState();
      const started = await Effect.runPromise(
        start(database, d1, state, session)
      );
      database.exec(`create trigger fail_passkey_audit
        before insert on auth_audit_log
        when new.type = 'app.passkey.enrolled'
        begin
          select raise(abort, 'passkey audit insert failed');
        end`);

      const error = await Effect.runPromise(
        finish(database, d1, state, session, started.challengeId).pipe(
          Effect.flip
        )
      );

      expect(error).toBeInstanceOf(PasskeyEnrollmentError);
      expect(error).toMatchObject({
        commitState: "unknown",
        operation: "finish",
        reason: "indeterminate",
      });
      const challengeRow = database
        .prepare("select consumed_at from auth_verification where id = ?")
        .get(started.challengeId) as { consumed_at: number | null };
      expect({
        auditEvents: countRows(database, "auth_audit_log"),
        consumedAt: challengeRow.consumed_at,
        credentials: countRows(database, "auth_passkey_credential"),
        guards: countRows(database, "app_authorization_guard"),
      }).toStrictEqual({
        auditEvents: 0,
        consumedAt: null,
        credentials: 0,
        guards: 0,
      });
    } finally {
      database.close();
    }
  });

  it("fails closed when recovery status and version change before the D1 batch", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      const session = validatedSession();
      insertSession(database, session);
      insertVerifiedRecovery(database);
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
      const state = makeState();
      const started = await Effect.runPromise(
        start(database, changedD1, state, session)
      );

      const error = await Effect.runPromise(
        finish(database, changedD1, state, session, started.challengeId).pipe(
          Effect.flip
        )
      );

      expect(error).toMatchObject({
        operation: "finish",
        reason: "recovery-identity-required",
      });
      expect(
        database
          .prepare("select consumed_at from auth_verification where id = ?")
          .get(started.challengeId)
      ).toMatchObject({ consumed_at: null });
      expect(countRows(database, "auth_passkey_credential")).toBe(0);
      expect(countRows(database, "auth_audit_log")).toBe(0);
    } finally {
      database.close();
    }
  });

  it("does not add a second credential when the credential is replayed", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      const session = validatedSession();
      insertSession(database, session);
      insertVerifiedRecovery(database);
      const d1 = makeTestD1Database(database);
      const state = makeState();
      const first = await Effect.runPromise(
        start(database, d1, state, session)
      );
      await Effect.runPromise(
        finish(database, d1, state, session, first.challengeId)
      );
      const replay = await Effect.runPromise(
        start(database, d1, state, session)
      );

      const error = await Effect.runPromise(
        finish(database, d1, state, session, replay.challengeId).pipe(
          Effect.flip
        )
      );

      expect(error).toMatchObject({
        operation: "finish",
        reason: "credential-conflict",
      });
      expect(countRows(database, "auth_passkey_credential")).toBe(1);
      expect(countRows(database, "auth_audit_log")).toBe(1);
      expect(
        database
          .prepare("select consumed_at from auth_verification where id = ?")
          .get(replay.challengeId)
      ).toMatchObject({ consumed_at: null });
    } finally {
      database.close();
    }
  });
});
