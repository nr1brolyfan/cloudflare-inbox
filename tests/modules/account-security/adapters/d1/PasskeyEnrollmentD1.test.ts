import { createHash } from "node:crypto";
/* oxlint-disable vitest/max-expects -- Transaction tests assert receipt, mutation, audit, and one-time output invariants together. */
import { DatabaseSync } from "node:sqlite";

import { emptyCustomEvidencePolicyRegistry } from "@effect-auth/core/Assurance";
import { decodeAuditEvent } from "@effect-auth/core/AuditLog";
import { AuthSecretsLive } from "@effect-auth/core/AuthConfig";
import { AuthRateLimit } from "@effect-auth/core/AuthRateLimit";
import type { ChallengeService } from "@effect-auth/core/Challenge";
import { Challenge, ChallengeVerifyError } from "@effect-auth/core/Challenge";
import type { CryptoService } from "@effect-auth/core/Crypto";
import { Crypto } from "@effect-auth/core/Crypto";
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
import type {
  PasskeyRegistrationCredentialPayload,
  PasskeyTransport,
} from "@effect-auth/core/PasskeyCredentialPayload";
import * as AuthPermission from "@effect-auth/core/Permission";
import { RecoveryCode, RecoveryCodes } from "@effect-auth/core/RecoveryCode";
import type { RecoveryCodesService } from "@effect-auth/core/RecoveryCode";
import { RecoveryCodeHash } from "@effect-auth/core/RecoveryCodeStorage";
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

import {
  PasskeyEnrollmentD1Layer,
  PasskeyEnrollmentRuntime,
} from "#/modules/account-security/adapters/d1/PasskeyEnrollmentD1";
import {
  PasskeyEnrollment,
  PasskeyEnrollmentError,
  PasskeyEnrollmentReadbackSecret,
  PasskeyEnrollmentReceiptSchema,
} from "#/modules/account-security/application/PasskeyEnrollment";
import { externalRecoveryLinkEvidence } from "#/modules/account-security/domain/AccountRecovery";
import {
  PasskeyRuntimeConfig,
  PasskeyRuntimeConfigSchema,
} from "#/modules/account-security/ports/PasskeyRuntimeConfig";
import { SensitiveOperationStepUpClock } from "#/modules/account-security/ports/SensitiveOperationStepUpClock";
import { ControlPlaneD1Layer } from "#/platform/control-plane-d1/ControlPlaneBatch";
import { ControlPlaneD1Binding } from "#/platform/control-plane-d1/ControlPlaneDatabase";
import { AdministrativeOperationId } from "#/shared/Operation";
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
const challengeSecret = "passkey-challenge-secret";
const base64Url = (value: string) => Buffer.from(value).toString("base64url");
const credentialPublicKey = base64Url("sensitive-passkey-public-key");
type TestD1Database = ReturnType<typeof makeTestD1Database>;
const operationId = Schema.decodeUnknownSync(AdministrativeOperationId)(
  "00000000-0000-4000-8000-000000000030"
);
const otherOperationId = Schema.decodeUnknownSync(AdministrativeOperationId)(
  "00000000-0000-4000-8000-000000000031"
);
const readbackSecret = Schema.decodeUnknownSync(
  PasskeyEnrollmentReadbackSecret
)("r".repeat(43));
const requestContext = Schema.decodeUnknownSync(RequestCorrelation)({
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
  expectedOrigins: ["https://inbox.example.test"],
  pubKeyCredParams: [{ alg: -7, type: "public-key" }],
  relyingParty: {
    id: "inbox.example.test",
    name: "Cloudflare Inbox",
  },
  requireUserVerification: true,
  userVerification: "required",
});
const clientCredential: PasskeyRegistrationCredentialPayload = {
  clientExtensionResults: {
    nested: { first: true, second: [1, { value: "extension" }] },
  },
  id: "YnJvd3Nlci1jcmVkZW50aWFs",
  rawId: "YnJvd3Nlci1jcmVkZW50aWFs",
  response: {
    attestationObject: "Y2xpZW50LWF0dGVzdGF0aW9u",
    clientDataJSON:
      "eyJ0eXBlIjoid2ViYXV0aG4uY3JlYXRlIiwiY2hhbGxlbmdlIjoiY0dGemMydGxlUzFqYUdGc2JHVnVaMlV0YzJWamNtVjAiLCJvcmlnaW4iOiJodHRwczovL2luYm94LmV4YW1wbGUudGVzdCJ9",
  },
  type: "public-key" as const,
};

interface TestState {
  backedUp: boolean;
  credentialId: string;
  metadata: Readonly<Record<string, unknown>>;
  optionCalls: number;
  publicKey: string;
  randomTokenCalls: number;
  rateLimitOperations: string[];
  signCount: number;
  transports: readonly PasskeyTransport[];
  verifierCalls: number;
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

const passkeyVerifierLive = (state: TestState) =>
  Layer.succeed(
    PasskeyVerifier,
    PasskeyVerifier.of({
      readRegistrationChallenge: () => Effect.die("read is not used"),
      readAuthenticationCredentialId: () => Effect.die("read is not used"),
      verifyAuthentication: () => Effect.die("authentication is not used"),
      verifyRegistration: () =>
        Effect.sync(() => {
          state.verifierCalls += 1;
          return {
            backedUp: state.backedUp,
            challenge: challengeSecret,
            credentialAlgorithm: -7,
            credentialId: PasskeyCredentialId(state.credentialId),
            metadata: state.metadata,
            publicKey: state.publicKey,
            signCount: state.signCount,
            transports: state.transports,
          };
        }),
    })
  );

const cryptoService = (state: TestState): CryptoService => ({
  digestSha256: () => Effect.die("digest is not used"),
  hmacSha256: ({ data }) =>
    Effect.succeed(
      createHash("sha256").update(String(data)).digest("base64url")
    ),
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
      Schema.decodeUnknownSync(RecoveryCodeHash)(
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
  d1: TestD1Database,
  state: TestState
) => {
  const bindingLive = Layer.succeed(
    ControlPlaneD1Binding,
    ControlPlaneD1Binding.of({
      database: d1 as unknown as D1Database,
    })
  );

  return PasskeyEnrollmentD1Layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        ControlPlaneD1Layer.pipe(Layer.provide(bindingLive)),
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
        AuthSecretsLive({
          challenge: Redacted.make("challenge-key-material-for-testing"),
          privacy: Redacted.make("privacy-key-material-for-testing-1"),
          session: Redacted.make("session-key-material-for-testing-12"),
        }),
        Layer.succeed(RecoveryCodes, recoveryCodesService),
        Layer.succeed(Sessions, sessionsService),
        passkeyOptionsLive(database, state),
        passkeyVerifierLive(state),
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

const start = (
  database: DatabaseSync,
  d1: TestD1Database,
  state: TestState,
  session: ValidatedSession
) =>
  provideRequestAuth(
    Effect.gen(function* () {
      const enrollment = yield* PasskeyEnrollment;
      return yield* enrollment.start({
        operationId,
        ...(session.currentSession.claims?.requirements?.[0] ===
        "recovery_remediation"
          ? { readbackSecret }
          : {}),
      });
    }).pipe(Effect.provide(enrollmentLive(database, d1, state))),
    session
  );

const finish = (
  database: DatabaseSync,
  d1: TestD1Database,
  state: TestState,
  session: ValidatedSession,
  challengeId: string,
  finishOperationId = operationId,
  credential = clientCredential
) =>
  provideRequestAuth(
    Effect.gen(function* () {
      const enrollment = yield* PasskeyEnrollment;
      return yield* enrollment.finish({
        challengeId: ChallengeId(challengeId),
        credential,
        operationId: finishOperationId,
        ...(session.currentSession.claims?.requirements?.[0] ===
        "recovery_remediation"
          ? { readbackSecret }
          : {}),
      });
    }).pipe(Effect.provide(enrollmentLive(database, d1, state))),
    session
  );

const readOperation = (
  database: DatabaseSync,
  d1: TestD1Database,
  state: TestState,
  session: ValidatedSession,
  challengeId: string,
  credential = clientCredential
) =>
  provideRequestAuth(
    Effect.gen(function* () {
      const enrollment = yield* PasskeyEnrollment;
      return yield* enrollment.readOperation({
        challengeId: ChallengeId(challengeId),
        credential,
        operationId,
      });
    }).pipe(Effect.provide(enrollmentLive(database, d1, state))),
    session
  );

const readRecoveryOperation = (
  database: DatabaseSync,
  d1: TestD1Database,
  state: TestState,
  challengeId: string,
  secret = readbackSecret,
  credential = clientCredential
) =>
  Effect.gen(function* () {
    const enrollment = yield* PasskeyEnrollment;
    return yield* enrollment.readRecoveryOperation({
      challengeId: ChallengeId(challengeId),
      credential,
      operationId,
      readbackSecret: secret,
    });
  }).pipe(Effect.provide(enrollmentLive(database, d1, state)));

const countRows = (database: DatabaseSync, table: string) =>
  (
    database.prepare(`select count(*) as count from ${table}`).get() as {
      count: number;
    }
  ).count;

const makeState = (): TestState => ({
  backedUp: true,
  credentialId: base64Url("passkey-credential-a"),
  metadata: {
    aaguid: "test-aaguid",
    nested: { first: 1, second: [{ left: true, right: false }] },
  },
  optionCalls: 0,
  publicKey: credentialPublicKey,
  randomTokenCalls: 0,
  rateLimitOperations: [],
  signCount: 0,
  transports: ["internal"],
  verifierCalls: 0,
});

describe("guarded passkey enrollment", () => {
  it("checks receipt mode and recovery-result agreement", () => {
    const base = {
      committedAt: now,
      credentialRecordId: "passkey-record-a",
      operationId,
      schemaVersion: 1,
    };

    expect(() =>
      Schema.decodeUnknownSync(PasskeyEnrollmentReceiptSchema)({
        ...base,
        mode: "normal",
        recoveryCodeCount: 10,
        recoveryCodeSetId: "code-set-a",
      })
    ).toThrow("normal receipt cannot contain recovery-code result");
    expect(() =>
      Schema.decodeUnknownSync(PasskeyEnrollmentReceiptSchema)({
        ...base,
        mode: "recovery-remediation",
      })
    ).toThrow("recovery-remediation receipt requires the ten-code result");
    expect(() =>
      Schema.decodeUnknownSync(PasskeyEnrollmentReceiptSchema)({
        ...base,
        mode: "recovery-remediation",
        recoveryCodeCount: 10,
        recoveryCodeSetId: "code-set-a",
      })
    ).not.toThrow();
  });
  it("starts and atomically finishes enrollment using the D1 RETURNING row", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      const session = validatedSession();
      insertSession(database, session);
      insertVerifiedRecovery(database);
      const baseD1 = makeTestD1Database(database);
      let returningRows: readonly unknown[] | undefined;
      const observedD1: TestD1Database = {
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

      expect(enrolled).toMatchObject({
        receipt: {
          credentialRecordId: "passkey-record-a",
          mode: "normal",
          operationId,
        },
        replayed: false,
      });
      expect(
        returningRows?.map((row) => (row as { id: string }).id)
      ).toStrictEqual(["passkey-record-a"]);
      const challengeRow = database
        .prepare("select consumed_at from auth_verification where id = ?")
        .get(started.challengeId) as { consumed_at: number | null };
      expect({
        auditEvents: countRows(database, "auth_audit_log"),
        consumedAt: challengeRow.consumed_at,
        credentials: countRows(database, "auth_passkey_credential"),
        guards: countRows(database, "app_authorization_guard"),
        receipts: countRows(database, "app_passkey_enrollment_receipt"),
      }).toStrictEqual({
        auditEvents: 1,
        consumedAt: now,
        credentials: 1,
        guards: 0,
        receipts: 1,
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
           values ('old-passkey-a', 'user-a', ?, ?, 0, ?)`
        )
        .run(
          base64Url("old-passkey-credential-a"),
          base64Url("old-public-key"),
          now - 1000
        );
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
        credentialId: result.receipt.credentialRecordId,
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
        credentialId: "passkey-record-a",
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
        receipts: countRows(database, "app_passkey_enrollment_receipt"),
      }).toStrictEqual({
        auditEvents: 0,
        consumedAt: null,
        credentials: 0,
        guards: 0,
        receipts: 0,
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
      const changedD1: TestD1Database = {
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

  it("fails closed when the normal enrollment session is revoked before commit", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      const session = validatedSession();
      insertSession(database, session);
      insertVerifiedRecovery(database);
      const baseD1 = makeTestD1Database(database);
      const state = makeState();
      const started = await Effect.runPromise(
        start(database, baseD1, state, session)
      );
      let changed = false;
      const changedD1: TestD1Database = {
        batch: (statements) => {
          if (!changed) {
            changed = true;
            database
              .prepare("update auth_session set revoked_at = ? where id = ?")
              .run(now, session.actor.sessionId);
          }
          return baseD1.batch(statements);
        },
        prepare: baseD1.prepare,
      };

      const failure = await Effect.runPromise(
        finish(database, changedD1, state, session, started.challengeId).pipe(
          Effect.flip
        )
      );

      expect(failure).toMatchObject({
        operation: "finish",
        reason: "restricted-session",
      });
      expect(
        database
          .prepare("select consumed_at from auth_verification where id = ?")
          .get(started.challengeId)
      ).toMatchObject({ consumed_at: null });
      expect(countRows(database, "auth_passkey_credential")).toBe(0);
      expect(countRows(database, "app_passkey_enrollment_receipt")).toBe(0);
      expect(countRows(database, "auth_audit_log")).toBe(0);
    } finally {
      database.close();
    }
  });

  it("fails closed when the restricted recovery session is revoked before commit", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      const session = recoveryRemediationSession();
      insertSession(database, session);
      insertVerifiedRecovery(database);
      const baseD1 = makeTestD1Database(database);
      let changed = false;
      const changedD1: TestD1Database = {
        batch: (statements) => {
          if (!changed) {
            changed = true;
            database
              .prepare("update auth_session set revoked_at = ? where id = ?")
              .run(now, session.actor.sessionId);
          }
          return baseD1.batch(statements);
        },
        prepare: baseD1.prepare,
      };
      const state = makeState();
      const started = await Effect.runPromise(
        start(database, changedD1, state, session)
      );

      const failure = await Effect.runPromise(
        finish(database, changedD1, state, session, started.challengeId).pipe(
          Effect.flip
        )
      );

      expect(failure).toMatchObject({
        operation: "finish",
        reason: "restricted-session",
      });
      expect(countRows(database, "auth_passkey_credential")).toBe(0);
      expect(countRows(database, "auth_recovery_code")).toBe(0);
      expect(countRows(database, "app_passkey_enrollment_receipt")).toBe(0);
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
        reason: "operation-conflict",
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

  it("rejects a fresh finish whose operation differs from challenge metadata", async () => {
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

      const conflict = await Effect.runPromise(
        finish(
          database,
          d1,
          state,
          session,
          started.challengeId,
          otherOperationId
        ).pipe(Effect.flip)
      );

      expect(conflict).toMatchObject({
        operation: "finish",
        reason: "operation-conflict",
      });
      expect(countRows(database, "auth_passkey_credential")).toBe(0);
      expect(countRows(database, "app_passkey_enrollment_receipt")).toBe(0);
    } finally {
      database.close();
    }
  });

  it("returns the normal receipt for an exact replay before rate limiting", async () => {
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
      const first = await Effect.runPromise(
        finish(database, d1, state, session, started.challengeId)
      );
      state.metadata = {
        nested: { second: [{ right: false, left: true }], first: 1 },
        aaguid: "test-aaguid",
      };
      const replay = await Effect.runPromise(
        finish(database, d1, state, session, started.challengeId, operationId, {
          clientExtensionResults: {
            nested: { second: [1, { value: "extension" }], first: true },
          },
          id: clientCredential.id,
          rawId: clientCredential.rawId,
          response: {
            clientDataJSON: clientCredential.response.clientDataJSON,
            attestationObject: clientCredential.response.attestationObject,
          },
          type: "public-key",
        })
      );
      const readback = await Effect.runPromise(
        readOperation(database, d1, state, session, started.challengeId)
      );
      const restrictedRead = await Effect.runPromise(
        readOperation(
          database,
          d1,
          state,
          recoveryRemediationSession(),
          started.challengeId
        ).pipe(Effect.flip)
      );
      const changedRead = await Effect.runPromise(
        readOperation(database, d1, state, session, started.challengeId, {
          ...clientCredential,
          response: {
            ...clientCredential.response,
            clientDataJSON:
              "eyJ0eXBlIjoid2ViYXV0aG4uY3JlYXRlIiwiY2hhbGxlbmdlIjoiWTJoaGJtZGxaQzFqYUdGc2JHVnVaMlUiLCJvcmlnaW4iOiJodHRwczovL2luYm94LmV4YW1wbGUudGVzdCJ9",
          },
        }).pipe(Effect.flip)
      );
      const changedChallengeRead = await Effect.runPromise(
        readOperation(database, d1, state, session, "different-challenge").pipe(
          Effect.flip
        )
      );

      expect(replay).toStrictEqual({ receipt: first.receipt, replayed: true });
      expect(readback).toStrictEqual(first.receipt);
      expect(restrictedRead).toMatchObject({ reason: "restricted-session" });
      expect(changedRead).toMatchObject({ reason: "operation-conflict" });
      expect(changedChallengeRead).toMatchObject({
        reason: "operation-conflict",
      });
      expect(state.rateLimitOperations).toStrictEqual([
        "auth.passkey.registration_start",
        "auth.passkey.registration_finish",
      ]);
      expect(countRows(database, "app_passkey_enrollment_receipt")).toBe(1);
      expect(countRows(database, "auth_passkey_credential")).toBe(1);
      expect(state.verifierCalls).toBe(2);
    } finally {
      database.close();
    }
  });

  it("rejects recovery remediation with a second capability container before starting a ceremony", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      const base = recoveryRemediationSession();
      const claims = {
        ...base.currentSession.claims,
        recoveryEnrollment: { allowed: ["recovery-codes"] },
      } as const;
      const session: ValidatedSession = {
        ...base,
        currentSession: { ...base.currentSession, claims },
        issued: { ...base.issued, claims },
      };
      insertSession(database, session);
      insertVerifiedRecovery(database);
      const d1 = makeTestD1Database(database);
      const state = makeState();

      const failure = await Effect.runPromise(
        start(database, d1, state, session).pipe(Effect.flip)
      );

      expect(failure).toMatchObject({ reason: "restricted-session" });
      expect(state.optionCalls).toBe(0);
      expect(state.rateLimitOperations).toStrictEqual([]);
    } finally {
      database.close();
    }
  });

  it("rejects changed raw client intent with the same credential ID before verification", async () => {
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
      await Effect.runPromise(
        finish(database, d1, state, session, started.challengeId)
      );
      const changedCredential = {
        ...clientCredential,
        clientExtensionResults: {
          nested: { second: [1, { value: "changed" }], first: true },
        },
      };

      const conflict = await Effect.runPromise(
        finish(
          database,
          d1,
          state,
          session,
          started.challengeId,
          operationId,
          changedCredential
        ).pipe(Effect.flip)
      );

      expect(conflict).toMatchObject({ reason: "operation-conflict" });
      expect(state.verifierCalls).toBe(1);
      expect(state.rateLimitOperations).toStrictEqual([
        "auth.passkey.registration_start",
        "auth.passkey.registration_finish",
      ]);
    } finally {
      database.close();
    }
  });

  it("checks the fresh finish rate limit before rejecting invalid verification", async () => {
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
      state.signCount = -1;

      const failure = await Effect.runPromise(
        finish(database, d1, state, session, started.challengeId).pipe(
          Effect.flip
        )
      );

      expect(failure).toMatchObject({ reason: "verification-failed" });
      expect(state.rateLimitOperations).toStrictEqual([
        "auth.passkey.registration_start",
        "auth.passkey.registration_finish",
      ]);
      expect(countRows(database, "auth_passkey_credential")).toBe(0);
    } finally {
      database.close();
    }
  });

  it("rejects receipt reuse by a changed actor or ceremony mode", async () => {
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
      await Effect.runPromise(
        finish(database, d1, state, session, started.challengeId)
      );
      const otherUserId = UserId("user-b");
      const otherSessionId = SessionId("session-b");
      const otherActor: ValidatedSession = {
        actor: { sessionId: otherSessionId, userId: otherUserId },
        currentSession: {
          ...session.currentSession,
          sessionId: otherSessionId,
          userId: otherUserId,
        },
        issued: {
          ...session.issued,
          sessionId: otherSessionId,
          token: SessionToken("session-b.secret"),
          userId: otherUserId,
        },
      };
      const actorConflict = await Effect.runPromise(
        finish(database, d1, state, otherActor, started.challengeId).pipe(
          Effect.flip
        )
      );
      const modeConflict = await Effect.runPromise(
        finish(
          database,
          d1,
          state,
          recoveryRemediationSession(),
          started.challengeId
        ).pipe(Effect.flip)
      );

      expect(actorConflict).toMatchObject({ reason: "operation-conflict" });
      expect(modeConflict).toMatchObject({ reason: "operation-conflict" });
      expect(countRows(database, "app_passkey_enrollment_receipt")).toBe(1);
    } finally {
      database.close();
    }
  });

  it("returns receipt only when recovery remediation is replayed", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      const session = recoveryRemediationSession();
      insertSession(database, session);
      insertVerifiedRecovery(database);
      const d1 = makeTestD1Database(database);
      const state = makeState();
      const started = await Effect.runPromise(
        start(database, d1, state, session)
      );
      const first = await Effect.runPromise(
        finish(database, d1, state, session, started.challengeId)
      );
      const replay = await Effect.runPromise(
        finish(database, d1, state, session, started.challengeId)
      );
      const readback = await Effect.runPromise(
        readRecoveryOperation(database, d1, state, started.challengeId)
      );
      const invalidProof = await Effect.runPromise(
        readRecoveryOperation(
          database,
          d1,
          state,
          started.challengeId,
          Schema.decodeUnknownSync(PasskeyEnrollmentReadbackSecret)(
            "i".repeat(43)
          )
        ).pipe(Effect.flip)
      );
      const changedIntent = await Effect.runPromise(
        readRecoveryOperation(
          database,
          d1,
          state,
          started.challengeId,
          readbackSecret,
          {
            ...clientCredential,
            response: {
              ...clientCredential.response,
              attestationObject: "ZGlmZmVyZW50LWF0dGVzdGF0aW9u",
            },
          }
        ).pipe(Effect.flip)
      );
      const changedChallenge = await Effect.runPromise(
        readRecoveryOperation(
          database,
          d1,
          state,
          "different-challenge",
          readbackSecret
        ).pipe(Effect.flip)
      );

      expect(first.remediation?.body.codes).toHaveLength(10);
      expect(replay).toStrictEqual({ receipt: first.receipt, replayed: true });
      expect(readback).toStrictEqual(first.receipt);
      expect(invalidProof).toMatchObject({ reason: "invalid-proof" });
      expect(changedIntent).toMatchObject({ reason: "invalid-proof" });
      expect(changedChallenge).toMatchObject({ reason: "invalid-proof" });
      expect(replay).not.toHaveProperty("remediation");
      expect(countRows(database, "auth_recovery_code")).toBe(10);
      expect(countRows(database, "app_passkey_enrollment_receipt")).toBe(1);
      expect(state.rateLimitOperations).toStrictEqual([
        "auth.passkey.registration_start",
        "auth.passkey.registration_finish",
      ]);
      expect(state.verifierCalls).toBe(2);
    } finally {
      database.close();
    }
  });

  it("rejects changed persisted verified registration intent for the same operation", async () => {
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
      await Effect.runPromise(
        finish(database, d1, state, session, started.challengeId)
      );
      state.publicKey = base64Url("different-sensitive-passkey-public-key");

      const conflict = await Effect.runPromise(
        finish(database, d1, state, session, started.challengeId).pipe(
          Effect.flip
        )
      );

      expect(conflict).toMatchObject({
        operation: "finish",
        reason: "operation-conflict",
      });
      expect(countRows(database, "auth_passkey_credential")).toBe(1);
    } finally {
      database.close();
    }
  });

  it("recovers a committed unknown outcome from the immutable receipt", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      const session = validatedSession();
      insertSession(database, session);
      insertVerifiedRecovery(database);
      const baseD1 = makeTestD1Database(database);
      let failAfterCommit = true;
      const unknownAfterCommit: TestD1Database = {
        batch: async (statements) => {
          const results = await baseD1.batch(statements);
          if (failAfterCommit) {
            failAfterCommit = false;
            throw new Error("response lost after commit");
          }
          return results;
        },
        prepare: baseD1.prepare,
      };
      const state = makeState();
      const started = await Effect.runPromise(
        start(database, unknownAfterCommit, state, session)
      );
      const result = await Effect.runPromise(
        finish(
          database,
          unknownAfterCommit,
          state,
          session,
          started.challengeId
        )
      );

      expect(result).toMatchObject({
        receipt: { operationId },
        replayed: true,
      });
      expect(countRows(database, "app_passkey_enrollment_receipt")).toBe(1);
    } finally {
      database.close();
    }
  });

  it("classifies a mismatched receipt found after an unknown outcome as operation conflict", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      const session = validatedSession();
      insertSession(database, session);
      insertVerifiedRecovery(database);
      const baseD1 = makeTestD1Database(database);
      const state = makeState();
      let challengeId = "";
      let raced = false;
      const originalPublicKey = state.publicKey;
      const changedPublicKey = base64Url("outer-different-public-key");
      const racingD1: TestD1Database = {
        batch: async (statements) => {
          if (!raced) {
            raced = true;
            state.publicKey = originalPublicKey;
            await Effect.runPromise(
              finish(database, baseD1, state, session, challengeId)
            );
            state.publicKey = changedPublicKey;
            throw new Error("unknown outer outcome after conflicting commit");
          }
          return baseD1.batch(statements);
        },
        prepare: baseD1.prepare,
      };
      const started = await Effect.runPromise(
        start(database, racingD1, state, session)
      );
      ({ challengeId } = started);
      state.publicKey = changedPublicKey;

      const failure = await Effect.runPromise(
        finish(database, racingD1, state, session, challengeId).pipe(
          Effect.flip
        )
      );

      expect(failure).toMatchObject({ reason: "operation-conflict" });
      expect(countRows(database, "app_passkey_enrollment_receipt")).toBe(1);
      expect(countRows(database, "auth_passkey_credential")).toBe(1);
    } finally {
      database.close();
    }
  });

  it("recovers an unknown committed remediation as receipt only", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      const session = recoveryRemediationSession();
      insertSession(database, session);
      insertVerifiedRecovery(database);
      const baseD1 = makeTestD1Database(database);
      let failAfterCommit = true;
      const unknownAfterCommit: TestD1Database = {
        batch: async (statements) => {
          const results = await baseD1.batch(statements);
          if (failAfterCommit) {
            failAfterCommit = false;
            throw new Error("recovery response lost after commit");
          }
          return results;
        },
        prepare: baseD1.prepare,
      };
      const state = makeState();
      const started = await Effect.runPromise(
        start(database, unknownAfterCommit, state, session)
      );
      const result = await Effect.runPromise(
        finish(
          database,
          unknownAfterCommit,
          state,
          session,
          started.challengeId
        )
      );

      expect(result).toMatchObject({
        receipt: { mode: "recovery-remediation", operationId },
        replayed: true,
      });
      expect(result).not.toHaveProperty("remediation");
      expect(countRows(database, "auth_recovery_code")).toBe(10);
      expect(countRows(database, "app_passkey_enrollment_receipt")).toBe(1);
    } finally {
      database.close();
    }
  });

  it("retains privacy-safe immutable receipts bound to the committed rows", async () => {
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
      await Effect.runPromise(
        finish(database, d1, state, session, started.challengeId)
      );
      const stored = database
        .prepare("select * from app_passkey_enrollment_receipt")
        .get() as Record<string, unknown>;
      const serialized = JSON.stringify(stored);

      expect(serialized).not.toContain(base64Url("passkey-credential-a"));
      expect(serialized).not.toContain(clientCredential.id);
      expect(serialized).not.toContain("client-attestation");
      expect(serialized).not.toContain("client-data-json");
      expect(serialized).not.toContain(credentialPublicKey);
      expect(serialized).not.toContain(challengeSecret);
      expect(stored.client_intent_digest).toMatch(/^[\w-]{43}$/u);
      expect(stored.verified_intent_digest).toMatch(/^[\w-]{43}$/u);
      expect(() =>
        database
          .prepare(
            "update app_passkey_enrollment_receipt set committed_at = committed_at + 1"
          )
          .run()
      ).toThrow("passkey enrollment receipts are immutable");
      expect(() =>
        database.prepare("delete from app_passkey_enrollment_receipt").run()
      ).toThrow("passkey enrollment receipts are retained");
      expect(() =>
        database
          .prepare(
            `insert or replace into app_passkey_enrollment_receipt
             select * from app_passkey_enrollment_receipt`
          )
          .run()
      ).toThrow("passkey enrollment receipts are immutable");
    } finally {
      database.close();
    }
  });

  it("rejects a recovery receipt whose readback HMAC differs from challenge metadata", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      const session = recoveryRemediationSession();
      insertSession(database, session);
      insertVerifiedRecovery(database);
      const d1 = makeTestD1Database(database);
      const state = makeState();
      const started = await Effect.runPromise(
        start(database, d1, state, session)
      );
      await Effect.runPromise(
        finish(database, d1, state, session, started.challengeId)
      );
      database.exec(
        `create temp table saved_passkey_enrollment_receipt as
           select * from app_passkey_enrollment_receipt;
         drop trigger app_passkey_enrollment_receipt_no_delete;
         delete from app_passkey_enrollment_receipt;`
      );

      expect(() =>
        database
          .prepare(
            `insert into app_passkey_enrollment_receipt
             select operation_id, mode, actor_user_id, challenge_id,
                     recovery_identity_id, recovery_identity_version,
                     client_intent_digest, verified_intent_digest,
                     credential_record_id, ?,
                    replacement_identity_id, resulting_session_id,
                    resulting_code_set_id, resulting_code_count,
                    committed_at, schema_version
               from saved_passkey_enrollment_receipt`
          )
          .run("t".repeat(43))
      ).toThrow("invalid passkey enrollment receipt binding");
    } finally {
      database.close();
    }
  });
});
