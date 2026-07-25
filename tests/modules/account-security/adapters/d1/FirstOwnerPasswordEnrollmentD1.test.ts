/* oxlint-disable vitest/max-expects -- The transaction tests assert the credential, seal, receipt, audit, and replay invariants together. */
import { DatabaseSync } from "node:sqlite";

import type { D1Database } from "@cloudflare/workers-types";
import { AuthSecretsLive } from "@effect-auth/core/AuthConfig";
import { AuthRateLimit } from "@effect-auth/core/AuthRateLimit";
import { WebCryptoLive } from "@effect-auth/core/Crypto";
import type { D1EffectQbDatabaseLike } from "@effect-auth/core/EffectQbSqliteStorage";
import {
  SessionId,
  SessionToken,
  UnixMillis,
  UserId,
} from "@effect-auth/core/Identifiers";
import {
  PasswordHasher,
  Pbkdf2PasswordHasherLive,
} from "@effect-auth/core/Password";
import { PasswordRiskPolicy } from "@effect-auth/core/PasswordRisk";
import * as AuthPermission from "@effect-auth/core/Permission";
import type { ValidatedSession } from "@effect-auth/core/Sessions";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  FirstOwnerPasswordEnrollmentD1Layer,
  FirstOwnerPasswordEnrollmentRuntime,
} from "#/modules/account-security/adapters/d1/FirstOwnerPasswordEnrollmentD1";
import {
  FirstOwnerPasswordAlreadyEnrolled,
  FirstOwnerPasswordEnrolled,
  FirstOwnerPasswordEnrollment,
  FirstOwnerPasswordEnrollmentError,
  EnrollFirstOwnerPasswordCommand,
} from "#/modules/account-security/application/FirstOwnerPasswordEnrollment";
import {
  MailboxBootstrapConfig,
  MailboxBootstrapConfigValue,
} from "#/modules/organization/contracts/MailboxBootstrapConfig";
import { ControlPlaneD1Layer } from "#/platform/control-plane-d1/ControlPlaneBatch";
import { ControlPlaneD1Binding } from "#/platform/control-plane-d1/ControlPlaneDatabase";
import { AdministrativeOperationId } from "#/shared/Operation";
import { CurrentRequestAuth } from "#/shared/RequestAuth";

import {
  applyControlPlaneMigration,
  applyControlPlaneMigrations,
  applyControlPlaneMigrationsThrough,
  makeTestD1Database,
} from "../../../../support/d1";

const now = Date.now();
const operationId = Schema.decodeUnknownSync(AdministrativeOperationId)(
  "00000000-0000-4000-8000-000000000110"
);
const nextOperationId = Schema.decodeUnknownSync(AdministrativeOperationId)(
  "00000000-0000-4000-8000-000000000111"
);
const password = "correct horse battery staple";
const config = Schema.decodeUnknownSync(MailboxBootstrapConfigValue)({
  initialAddress: "inbox@example.test",
  initialDomain: "example.test",
  ownerEmailAllowlist: ["owner@external.test"],
});

const session = (
  options: {
    readonly proofIdentityId?: string;
    readonly proofTime?: number;
    readonly proofType?: "email_otp" | "magic_link";
    readonly restricted?: boolean;
    readonly sessionId?: string;
    readonly userId?: string;
  } = {}
): ValidatedSession => {
  const userId = UserId(options.userId ?? "user-a");
  const sessionId = SessionId(options.sessionId ?? "session-a");
  const authenticationEvents = [
    {
      identityId: options.proofIdentityId ?? "identity-a",
      type: options.proofType ?? ("magic_link" as const),
      verifiedAt: UnixMillis(options.proofTime ?? now - 100),
      version: 1 as const,
    },
  ];
  const currentSession = {
    aal: "aal1" as const,
    amr: ["magic_link"],
    authenticationEvents,
    authTime: UnixMillis(now - 100),
    ...(options.restricted
      ? { claims: { requirements: ["email_verification"] } }
      : {}),
    expiresAt: UnixMillis(now + 60 * 60 * 1000),
    sessionId,
    userId,
  };
  return {
    actor: { sessionId, userId },
    currentSession,
    issued: {
      ...currentSession,
      token: SessionToken(`${sessionId}.secret`),
    },
  };
};

const insertAccount = (
  database: DatabaseSync,
  validated: ValidatedSession,
  address = "owner@external.test",
  identityId = "identity-a"
) => {
  const metadata =
    validated.issued.claims === undefined
      ? null
      : JSON.stringify({
          __effectAuthSession: {
            claims: validated.issued.claims,
            version: 1,
          },
        });
  database
    .prepare(
      "insert into auth_user (id, created_at, updated_at) values (?, ?, ?)"
    )
    .run(validated.actor.userId, now - 1000, now - 1000);
  database
    .prepare(
      `insert into auth_user_identity
        (id, user_id, scope_type, scope_id, kind, value, normalized_value,
         verified_at, is_primary_login, created_at, updated_at)
       values (?, ?, 'global', 'global', 'email', ?, ?, ?, 1, ?, ?)`
    )
    .run(
      identityId,
      validated.actor.userId,
      address,
      address,
      now - 500,
      now - 1000,
      now - 500
    );
  database
    .prepare(
      `insert into auth_session
        (id, user_id, secret_hash, created_at, expires_at, auth_time,
         authentication_events, aal, amr, metadata)
       values (?, ?, 'session-secret-hash', ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      validated.actor.sessionId,
      validated.actor.userId,
      now - 1000,
      validated.issued.expiresAt,
      validated.issued.authTime,
      JSON.stringify(validated.issued.authenticationEvents),
      validated.issued.aal,
      JSON.stringify(validated.issued.amr),
      metadata
    );
};

const loseResponseAfterCommit = (
  database: D1EffectQbDatabaseLike
): D1EffectQbDatabaseLike => ({
  batch: async (statements) => {
    await database.batch(statements);
    throw new Error("D1 response lost after commit");
  },
  prepare: database.prepare,
});

const loseResponseWithoutCommit = (
  database: D1EffectQbDatabaseLike
): D1EffectQbDatabaseLike => ({
  batch: () => Promise.reject(new Error("D1 outcome unknown")),
  prepare: database.prepare,
});

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

const loseResponseAndReadback = (
  database: DatabaseSync,
  d1: D1EffectQbDatabaseLike
): D1EffectQbDatabaseLike => ({
  batch: () => {
    database.close();
    return Promise.reject(new Error("D1 outcome and readback unavailable"));
  },
  prepare: d1.prepare,
});

interface LiveOptions {
  readonly config?: MailboxBootstrapConfigValue;
  readonly onRateLimit?: () => void;
}

const liveLayer = (d1: D1EffectQbDatabaseLike, options: LiveOptions = {}) => {
  const bindingLayer = Layer.succeed(
    ControlPlaneD1Binding,
    ControlPlaneD1Binding.of({
      database: d1 as unknown as D1Database,
    })
  );
  const cryptoLayer = WebCryptoLive();
  return FirstOwnerPasswordEnrollmentD1Layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        ControlPlaneD1Layer.pipe(Layer.provide(bindingLayer)),
        AuthSecretsLive({
          challenge: Redacted.make("challenge-key"),
          privacy: Redacted.make("privacy-key"),
          session: Redacted.make("session-key"),
        }),
        Layer.succeed(
          AuthRateLimit,
          AuthRateLimit.of({
            require: () =>
              Effect.sync(() => {
                options.onRateLimit?.();
              }),
          })
        ),
        cryptoLayer,
        Pbkdf2PasswordHasherLive({ iterations: 1 }).pipe(
          Layer.provide(cryptoLayer)
        ),
        Layer.succeed(
          PasswordRiskPolicy,
          PasswordRiskPolicy.of({
            decide: () => Effect.succeed({ type: "Allow" }),
          })
        ),
        Layer.succeed(MailboxBootstrapConfig, options.config ?? config),
        Layer.succeed(
          FirstOwnerPasswordEnrollmentRuntime,
          FirstOwnerPasswordEnrollmentRuntime.of({ now: () => now })
        )
      )
    )
  );
};

const runEnrollment = (
  d1: D1EffectQbDatabaseLike,
  validated: ValidatedSession,
  command?: { readonly operationId: string; readonly password: string },
  options?: LiveOptions
) => {
  const resolvedCommand = command ?? { operationId, password };
  return Effect.runPromise(
    // oxlint-disable-next-line react-hooks/rules-of-hooks -- Context.Service.use is not a React hook.
    FirstOwnerPasswordEnrollment.use((service) =>
      service.enroll(
        Schema.decodeUnknownSync(EnrollFirstOwnerPasswordCommand)(
          resolvedCommand
        )
      )
    ).pipe(
      Effect.provide(liveLayer(d1, options)),
      Effect.provideService(
        CurrentRequestAuth,
        CurrentRequestAuth.of({
          sessionSecretHash: "session-secret-hash",
          validated,
        })
      ),
      Effect.provideService(
        AuthPermission.CurrentPrincipal,
        AuthPermission.CurrentPrincipal.of(
          AuthPermission.PermissionSubject.user(validated.actor.userId)
        )
      )
    )
  );
};

const runUntrustedEnrollment = (
  d1: D1EffectQbDatabaseLike,
  validated: ValidatedSession,
  input: unknown
) =>
  Effect.runPromise(
    // oxlint-disable-next-line react-hooks/rules-of-hooks -- Context.Service.use is not a React hook.
    FirstOwnerPasswordEnrollment.use((service) =>
      service.enroll(input as never)
    ).pipe(
      Effect.flip,
      Effect.provide(liveLayer(d1)),
      Effect.provideService(
        CurrentRequestAuth,
        CurrentRequestAuth.of({
          sessionSecretHash: "session-secret-hash",
          validated,
        })
      ),
      Effect.provideService(
        AuthPermission.CurrentPrincipal,
        AuthPermission.CurrentPrincipal.of(
          AuthPermission.PermissionSubject.user(validated.actor.userId)
        )
      )
    )
  );

const configWith = (
  ownerEmailAllowlist: readonly string[],
  initialDomain = "example.test"
) =>
  Schema.decodeUnknownSync(MailboxBootstrapConfigValue)({
    initialAddress: `inbox@${initialDomain}`,
    initialDomain,
    ownerEmailAllowlist,
  });

const rejectedEnrollment = async (promise: Promise<unknown>) => {
  try {
    await promise;
    throw new Error("Expected enrollment to fail");
  } catch (error) {
    return error as FirstOwnerPasswordEnrollmentError;
  }
};

const setup = async (validated = session()) => {
  const database = new DatabaseSync(":memory:");
  await applyControlPlaneMigrations(database);
  insertAccount(database, validated);
  return { database, d1: makeTestD1Database(database), validated };
};

const directSealWrite = (database: DatabaseSync, proofVerifiedAt: number) => {
  const credentialId = "manual-password-credential";
  const auditEvent = JSON.stringify({
    actor: { sessionId: "session-a", type: "user", userId: "user-a" },
    occurredAt: now,
    payload: {
      credentialId,
      operationId,
      proofType: "magic_link",
      proofVerifiedAt,
    },
    subject: { type: "user", userId: "user-a" },
    type: "app.first_owner.password_enrolled",
    version: 1,
  });
  database
    .prepare(
      `insert into auth_credential
        (id, user_id, type, password_hash, created_at, updated_at)
       values (?, 'user-a', 'password', 'manual-hash', ?, ?)`
    )
    .run(credentialId, now, now);
  database
    .prepare(
      `insert into auth_audit_log
        (id, type, user_id, actor_user_id, occurred_at, event, created_at)
       values (?, 'app.first_owner.password_enrolled', 'user-a', 'user-a',
               ?, ?, ?)`
    )
    .run(
      `first-owner-password-enrollment:${operationId}`,
      now,
      auditEvent,
      now
    );
  database
    .prepare(
      `insert into app_first_owner_password_enrollment
        (singleton_key, operation_id, actor_user_id, session_id,
         login_identity_id, credential_id, proof_type, proof_verified_at,
         password_intent_digest, committed_at, schema_version)
       values (1, ?, 'user-a', 'session-a', 'identity-a', ?, 'magic_link',
               ?, ?, ?, 1)`
    )
    .run(operationId, credentialId, proofVerifiedAt, "a".repeat(43), now);
};

describe("FirstOwnerPasswordEnrollmentD1", () => {
  it("atomically installs one password credential, audit, and singleton seal", async () => {
    const { database, d1, validated } = await setup();

    const result = await runEnrollment(d1, validated);

    expect(result).toBeInstanceOf(FirstOwnerPasswordEnrolled);
    expect(result.receipt).toMatchObject({ operationId, schemaVersion: 1 });
    expect(
      database.prepare("select count(*) count from auth_credential").get()
    ).toMatchObject({ count: 1 });
    expect(
      database
        .prepare(
          `select singleton_key, operation_id, actor_user_id, proof_type,
                  schema_version
             from app_first_owner_password_enrollment`
        )
        .get()
    ).toMatchObject({
      actor_user_id: "user-a",
      operation_id: operationId,
      proof_type: "magic_link",
      schema_version: 1,
      singleton_key: 1,
    });
    expect(
      database
        .prepare(
          `select type, user_id, actor_user_id,
                  json_extract(event, '$.payload.operationId') operation_id
             from auth_audit_log
            where id = ?`
        )
        .get(`first-owner-password-enrollment:${operationId}`)
    ).toMatchObject({
      actor_user_id: "user-a",
      operation_id: operationId,
      type: "app.first_owner.password_enrolled",
      user_id: "user-a",
    });

    const stored = database
      .prepare(
        `select credential.password_hash password_hash,
                audit.event event,
                enrollment.password_intent_digest intent_digest
           from app_first_owner_password_enrollment enrollment
           join auth_credential credential on credential.id = enrollment.credential_id
           join auth_audit_log audit
             on audit.id = 'first-owner-password-enrollment:' || enrollment.operation_id`
      )
      .get() as {
      readonly event: string;
      readonly intent_digest: string;
      readonly password_hash: string;
    };
    const cryptoLayer = WebCryptoLive();
    const compatible = await Effect.runPromise(
      // oxlint-disable-next-line react-hooks/rules-of-hooks -- Context.Service.use is not a React hook.
      PasswordHasher.use((passwordHasher) =>
        passwordHasher.verify({
          hash: stored.password_hash,
          password: Redacted.make(password),
        })
      ).pipe(
        Effect.provide(
          Pbkdf2PasswordHasherLive({ iterations: 1 }).pipe(
            Layer.provide(cryptoLayer)
          )
        )
      )
    );
    expect(compatible).toBeTruthy();
    expect(JSON.parse(stored.event)).toMatchObject({
      actor: { sessionId: "session-a", type: "user", userId: "user-a" },
      payload: {
        operationId,
        proofType: "magic_link",
        proofVerifiedAt: now - 100,
      },
      subject: { type: "user", userId: "user-a" },
      type: "app.first_owner.password_enrolled",
      version: 1,
    });
    const sensitiveStorage = JSON.stringify({
      audit: stored.event,
      intentDigest: stored.intent_digest,
    });
    expect(sensitiveStorage).not.toContain(password);
    expect(stored.event).not.toContain("owner@external.test");
    expect(stored.event).not.toContain(stored.password_hash);
    expect(stored.event).not.toContain(stored.intent_digest);
  });

  it("accepts a matching email_otp proof", async () => {
    const validated = session({ proofType: "email_otp" });
    const { database, d1 } = await setup(validated);

    const result = await runEnrollment(d1, validated);

    expect(result).toBeInstanceOf(FirstOwnerPasswordEnrolled);
    expect(
      database
        .prepare(
          "select proof_type, proof_verified_at from app_first_owner_password_enrollment"
        )
        .get()
    ).toMatchObject({
      proof_type: "email_otp",
      proof_verified_at: now - 100,
    });
  });

  it("accepts the exact five-minute proof boundary and rejects future evidence", async () => {
    const boundarySession = session({ proofTime: now - 5 * 60 * 1000 });
    const boundary = await setup(boundarySession);
    boundary.database.function("unixepoch", (_modifier: unknown) => now / 1000);

    const accepted = await runEnrollment(boundary.d1, boundarySession);
    expect(accepted).toBeInstanceOf(FirstOwnerPasswordEnrolled);

    const futureSession = session({ proofTime: now + 1 });
    const future = await setup(futureSession);
    future.database.function("unixepoch", (_modifier: unknown) => now / 1000);
    await expect(runEnrollment(future.d1, futureSession)).rejects.toMatchObject(
      { reason: "proof-required" }
    );
    expect(
      future.database
        .prepare("select count(*) count from auth_credential")
        .get()
    ).toMatchObject({ count: 0 });
  });

  it("sanitizes invalid command and password errors without retaining untrusted input", async () => {
    const { d1, validated } = await setup();
    const cases = [
      {
        input: {
          email: "forged@example.test",
          operationId,
          password: "sensitive invalid command password",
        },
        secrets: ["sensitive invalid command password", "forged@example.test"],
      },
      {
        input: { operationId, password: "tiny-secret" },
        secrets: ["tiny-secret"],
      },
    ];
    for (const testCase of cases) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- Both decoder branches share one read-only setup.
      const error = await runUntrustedEnrollment(d1, validated, testCase.input);
      const completeSerialization = JSON.stringify({
        cause: error.cause,
        error,
        message: error.message,
        stack: error.stack,
      });

      expect(error).toMatchObject({
        _tag: "FirstOwnerPasswordEnrollmentError",
        cause: undefined,
        reason: "invalid-input",
      });
      expect(Object.hasOwn(error, "cause")).toBeTruthy();
      for (const secret of testCase.secrets) {
        expect(completeSerialization).not.toContain(secret);
      }
    }
  });

  it("returns the immutable receipt for exact replay and conflicts on changed intent", async () => {
    const { database, d1, validated } = await setup();
    await runEnrollment(d1, validated);

    const replay = await runEnrollment(d1, validated);
    const changed = await Effect.runPromise(
      FirstOwnerPasswordEnrollment.use((service) =>
        service.enroll({
          operationId,
          password: "different correct horse battery staple",
        })
      ).pipe(
        Effect.flip,
        Effect.provide(liveLayer(d1)),
        Effect.provideService(
          CurrentRequestAuth,
          CurrentRequestAuth.of({
            sessionSecretHash: "session-secret-hash",
            validated,
          })
        ),
        Effect.provideService(
          AuthPermission.CurrentPrincipal,
          AuthPermission.CurrentPrincipal.of(
            AuthPermission.PermissionSubject.user(validated.actor.userId)
          )
        )
      )
    );

    expect(replay).toBeInstanceOf(FirstOwnerPasswordAlreadyEnrolled);
    expect(replay.receipt.operationId).toBe(operationId);
    expect(changed).toMatchObject({ reason: "operation-conflict" });
    expect(
      database.prepare("select count(*) count from auth_credential").get()
    ).toMatchObject({ count: 1 });
  });

  it("rejects sequential singleton claims and another actor replaying the committed operation", async () => {
    const { database, d1, validated } = await setup();
    await runEnrollment(d1, validated);

    await expect(
      runEnrollment(d1, validated, { operationId: nextOperationId, password })
    ).rejects.toMatchObject({ reason: "operation-conflict" });

    const otherSession = session({
      proofIdentityId: "identity-b",
      sessionId: "session-b",
      userId: "user-b",
    });
    insertAccount(database, otherSession, "other@external.test", "identity-b");
    await expect(runEnrollment(d1, otherSession)).rejects.toMatchObject({
      reason: "operation-conflict",
    });

    expect({
      audits: database
        .prepare(
          "select count(*) count from auth_audit_log where type = 'app.first_owner.password_enrolled'"
        )
        .get(),
      credentials: database
        .prepare("select count(*) count from auth_credential")
        .get(),
      receipts: database
        .prepare(
          "select count(*) count from app_first_owner_password_enrollment"
        )
        .get(),
    }).toMatchObject({
      audits: { count: 1 },
      credentials: { count: 1 },
      receipts: { count: 1 },
    });
  });

  it("rate-limits replay before intent comparison and requires the persisted session", async () => {
    const mutations = [
      "update auth_session set secret_hash = 'rotated' where id = 'session-a'",
      "delete from auth_session where id = 'session-a'",
      `update auth_session set expires_at = ${now - 1} where id = 'session-a'`,
      `update auth_session set metadata = '{"__effectAuthSession":{"version":1,"claims":{"requirements":["email_verification"]}}}' where id = 'session-a'`,
    ];
    for (const mutation of mutations) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- Each mutation owns an isolated SQLite database.
      const { database, d1, validated } = await setup();
      let rateLimitCalls = 0;
      // oxlint-disable-next-line eslint/no-await-in-loop -- Each mutation owns an isolated SQLite database.
      await runEnrollment(d1, validated, undefined, {
        onRateLimit: () => {
          rateLimitCalls += 1;
        },
      });
      database.exec(mutation);

      // oxlint-disable-next-line eslint/no-await-in-loop -- Each mutation owns an isolated SQLite database.
      const error = await rejectedEnrollment(
        runEnrollment(d1, validated, undefined, {
          onRateLimit: () => {
            rateLimitCalls += 1;
          },
        })
      );

      expect(error).toMatchObject({ reason: "restricted-session" });
      expect(rateLimitCalls).toBe(2);
      database.close();
    }
  });

  it("rejects invalid owner configuration and a nonallowlisted identity", async () => {
    const emptyOwnerConfig = {
      ...config,
      ownerEmailAllowlist: [],
    } as unknown as MailboxBootstrapConfigValue;
    const cases = [
      { configured: emptyOwnerConfig, reason: "owner-config-invalid" },
      {
        configured: configWith(["owner@external.test", "other@external.test"]),
        reason: "owner-config-invalid",
      },
      {
        configured: configWith(["owner@external.test"], "external.test"),
        reason: "owner-config-invalid",
      },
      {
        configured: configWith(["other@external.test"]),
        reason: "owner-not-eligible",
      },
    ];
    for (const testCase of cases) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- Each config owns an isolated SQLite database.
      const { database, d1, validated } = await setup();
      // oxlint-disable-next-line eslint/no-await-in-loop -- Each config owns an isolated SQLite database.
      const error = await rejectedEnrollment(
        runEnrollment(d1, validated, undefined, {
          config: testCase.configured,
        })
      );

      expect(error.reason).toBe(testCase.reason);
      expect(
        database.prepare("select count(*) count from auth_credential").get()
      ).toMatchObject({ count: 0 });
      database.close();
    }
  });

  it("allows concurrent attempts to create only one credential and singleton seal", async () => {
    const { database, d1, validated } = await setup();

    const attempts = await Promise.allSettled([
      runEnrollment(d1, validated),
      runEnrollment(d1, validated, { operationId: nextOperationId, password }),
    ]);

    expect(
      attempts.filter((attempt) => attempt.status === "fulfilled")
    ).toHaveLength(1);
    expect(
      attempts.filter((attempt) => attempt.status === "rejected")
    ).toHaveLength(1);
    expect(
      database.prepare("select count(*) count from auth_credential").get()
    ).toMatchObject({ count: 1 });
    expect(
      database
        .prepare(
          "select count(*) count from app_first_owner_password_enrollment"
        )
        .get()
    ).toMatchObject({ count: 1 });
    expect(
      database
        .prepare(
          "select count(*) count from auth_audit_log where type = 'app.first_owner.password_enrolled'"
        )
        .get()
    ).toMatchObject({ count: 1 });
  });

  it("converges concurrent same-operation attempts on one exact receipt", async () => {
    const { database, d1, validated } = await setup();

    const attempts = await Promise.all([
      runEnrollment(d1, validated),
      runEnrollment(d1, validated),
    ]);

    expect(attempts).toHaveLength(2);
    expect(
      attempts.filter(
        (attempt) => attempt instanceof FirstOwnerPasswordEnrolled
      )
    ).toHaveLength(1);
    expect(
      attempts.filter(
        (attempt) => attempt instanceof FirstOwnerPasswordAlreadyEnrolled
      )
    ).toHaveLength(1);
    expect(attempts[0]?.receipt).toStrictEqual(attempts[1]?.receipt);
    expect(
      database.prepare("select count(*) count from auth_credential").get()
    ).toMatchObject({ count: 1 });
  });

  it("rechecks identity and matching proof inside the batch", async () => {
    const mutations = [
      "update auth_user_identity set revoked_at = updated_at where id = 'identity-a'",
      "update auth_user_identity set verified_at = null where id = 'identity-a'",
      "update auth_user_identity set is_primary_login = 0 where id = 'identity-a'",
      "update auth_user_identity set normalized_value = 'other@external.test' where id = 'identity-a'",
      "update auth_session set authentication_events = '[]' where id = 'session-a'",
      "update auth_session set secret_hash = 'rotated' where id = 'session-a'",
      "delete from auth_session where id = 'session-a'",
    ];
    for (const mutation of mutations) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- Each race owns an isolated SQLite database.
      const { database, d1, validated } = await setup();
      const raced = beforeBatch(d1, () => database.exec(mutation));
      // oxlint-disable-next-line eslint/no-await-in-loop -- Each race owns an isolated SQLite database.
      const error = await rejectedEnrollment(runEnrollment(raced, validated));

      expect([
        "owner-not-eligible",
        "proof-required",
        "restricted-session",
      ]).toContain(error.reason);
      expect(
        database.prepare("select count(*) count from auth_credential").get()
      ).toMatchObject({ count: 0 });
      expect(
        database
          .prepare(
            "select count(*) count from app_first_owner_password_enrollment"
          )
          .get()
      ).toMatchObject({ count: 0 });
      expect(
        database
          .prepare("select count(*) count from app_authorization_guard")
          .get()
      ).toMatchObject({ count: 0 });
      database.close();
    }
  });

  it("rejects retained receipt-only account-security history", async () => {
    const { database, d1, validated } = await setup();
    database.exec("drop trigger app_recovery_code_rotation_receipt_binding");
    database
      .prepare(
        `insert into app_recovery_code_rotation_receipt
          (operation_id, user_id, expected_previous_set_id, resulting_set_id,
           generated_at, committed_at, code_count, schema_version)
         values ('00000000-0000-4000-8000-000000000119', 'user-a', null,
                 '00000000-0000-4000-8000-000000000120', ?, ?, 10, 1)`
      )
      .run(now - 1000, now - 1000);

    await expect(runEnrollment(d1, validated)).rejects.toMatchObject({
      reason: "state-conflict",
    });
    expect(
      database.prepare("select count(*) count from auth_credential").get()
    ).toMatchObject({ count: 0 });
    expect(
      database
        .prepare(
          "select count(*) count from app_first_owner_password_enrollment"
        )
        .get()
    ).toMatchObject({ count: 0 });
  });

  it("rejects an actual deterministic audit-ID collision atomically", async () => {
    const { database, d1, validated } = await setup();
    database
      .prepare(
        `insert into auth_audit_log
          (id, type, user_id, actor_user_id, occurred_at, event, created_at)
         values (?, 'app.unrelated', 'user-a', 'user-a', ?, '{}', ?)`
      )
      .run(`first-owner-password-enrollment:${operationId}`, now - 1, now - 1);

    await expect(runEnrollment(d1, validated)).rejects.toMatchObject({
      reason: "state-conflict",
    });
    expect(
      database.prepare("select count(*) count from auth_credential").get()
    ).toMatchObject({ count: 0 });
    expect(
      database
        .prepare(
          "select count(*) count from app_first_owner_password_enrollment"
        )
        .get()
    ).toMatchObject({ count: 0 });
    expect(
      database
        .prepare("select count(*) count from app_authorization_guard")
        .get()
    ).toMatchObject({ count: 0 });
  });

  it("rolls back credential, audit, receipt, and authorization guard on terminal statement failures", async () => {
    const failures = [
      `create trigger reject_first_owner_audit before insert on auth_audit_log
       begin select raise(abort, 'reject audit'); end`,
      `create trigger reject_first_owner_receipt before insert on app_first_owner_password_enrollment
       begin select raise(abort, 'reject receipt'); end`,
      `create trigger reject_first_owner_cleanup before delete on app_authorization_guard
       begin select raise(abort, 'reject cleanup'); end`,
    ];
    for (const trigger of failures) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- Each failure owns an isolated SQLite database.
      const { database, d1, validated } = await setup();
      const failing = beforeBatch(d1, () => database.exec(trigger));
      // oxlint-disable-next-line eslint/no-await-in-loop -- Each failure owns an isolated SQLite database.
      await expect(runEnrollment(failing, validated)).rejects.toMatchObject({
        commitState: "unknown",
        reason: "indeterminate",
      });

      for (const table of [
        "auth_credential",
        "auth_audit_log",
        "app_first_owner_password_enrollment",
        "app_authorization_guard",
      ]) {
        expect(
          database.prepare(`select count(*) count from ${table}`).get()
        ).toMatchObject({ count: 0 });
      }
      database.close();
    }
  });

  it("rejects stale or wrong-identity email evidence without writes", async () => {
    for (const validated of [
      session({ proofTime: now - 5 * 60 * 1000 - 1 }),
      session({ proofIdentityId: "identity-b" }),
    ]) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- Each case owns an isolated SQLite database.
      const { database, d1 } = await setup(validated);
      // oxlint-disable-next-line eslint/no-await-in-loop -- Each case owns an isolated SQLite database.
      const exit = await Effect.runPromiseExit(
        FirstOwnerPasswordEnrollment.use((service) =>
          service.enroll({ operationId, password })
        ).pipe(
          Effect.provide(liveLayer(d1)),
          Effect.provideService(
            CurrentRequestAuth,
            CurrentRequestAuth.of({
              sessionSecretHash: "session-secret-hash",
              validated,
            })
          ),
          Effect.provideService(
            AuthPermission.CurrentPrincipal,
            AuthPermission.CurrentPrincipal.of(
              AuthPermission.PermissionSubject.user(validated.actor.userId)
            )
          )
        )
      );

      expect(exit._tag).toBe("Failure");
      expect(
        database.prepare("select count(*) count from auth_credential").get()
      ).toMatchObject({ count: 0 });
      database.close();
    }
  });

  it("fails closed when prior credential state exists", async () => {
    const { database, d1, validated } = await setup();
    database
      .prepare(
        `insert into auth_credential
          (id, user_id, type, password_hash, created_at, updated_at)
         values ('prior', 'user-a', 'password', 'prior-hash', ?, ?)`
      )
      .run(now - 1000, now - 1000);

    const error = await Effect.runPromise(
      FirstOwnerPasswordEnrollment.use((service) =>
        service.enroll({ operationId: nextOperationId, password })
      ).pipe(
        Effect.flip,
        Effect.provide(liveLayer(d1)),
        Effect.provideService(
          CurrentRequestAuth,
          CurrentRequestAuth.of({
            sessionSecretHash: "session-secret-hash",
            validated,
          })
        ),
        Effect.provideService(
          AuthPermission.CurrentPrincipal,
          AuthPermission.CurrentPrincipal.of(
            AuthPermission.PermissionSubject.user(validated.actor.userId)
          )
        )
      )
    );

    expect(error).toMatchObject({ reason: "state-conflict" });
    expect(
      database
        .prepare(
          "select count(*) count from app_first_owner_password_enrollment"
        )
        .get()
    ).toMatchObject({ count: 0 });
  });

  it("rejects retained API-key history, including a revoked key", async () => {
    const { database, d1, validated } = await setup();
    database
      .prepare(
        `insert into auth_api_key
          (id, user_id, prefix, secret_hash, scopes, created_at, revoked_at)
         values ('api-key-history', 'user-a', 'history-prefix', 'history-hash',
                 '[]', ?, ?)`
      )
      .run(now - 2000, now - 1000);

    await expect(runEnrollment(d1, validated)).rejects.toMatchObject({
      reason: "state-conflict",
    });
    expect(
      database.prepare("select count(*) count from auth_credential").get()
    ).toMatchObject({ count: 0 });
    expect(
      database
        .prepare(
          "select count(*) count from app_first_owner_password_enrollment"
        )
        .get()
    ).toMatchObject({ count: 0 });
  });

  it("recovers an unknown committed outcome and preserves an unknown uncommitted outcome", async () => {
    const committed = await setup();
    const recovered = await runEnrollment(
      loseResponseAfterCommit(committed.d1),
      committed.validated
    );
    expect(recovered).toBeInstanceOf(FirstOwnerPasswordAlreadyEnrolled);

    const uncommitted = await setup();
    await expect(
      runEnrollment(
        loseResponseWithoutCommit(uncommitted.d1),
        uncommitted.validated
      )
    ).rejects.toMatchObject({
      _tag: FirstOwnerPasswordEnrollmentError.name,
      commitState: "unknown",
      reason: "indeterminate",
    });
    expect(
      uncommitted.database
        .prepare("select count(*) count from auth_credential")
        .get()
    ).toMatchObject({ count: 0 });

    const unreadable = await setup();
    await expect(
      runEnrollment(
        loseResponseAndReadback(unreadable.database, unreadable.d1),
        unreadable.validated
      )
    ).rejects.toMatchObject({
      _tag: "FirstOwnerPasswordEnrollmentError",
      commitState: "unknown",
      reason: "indeterminate",
    });
  });

  it("fails receipt replay when FK-off corruption orphans a bound artifact", async () => {
    const corruptions = [
      "delete from auth_credential",
      "delete from auth_user_identity",
      "delete from auth_audit_log",
    ];
    for (const corruption of corruptions) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- Each corruption owns an isolated SQLite database.
      const { database, d1, validated } = await setup();
      // oxlint-disable-next-line eslint/no-await-in-loop -- Each corruption owns an isolated SQLite database.
      await runEnrollment(d1, validated);
      database.exec("pragma foreign_keys = off");
      database.exec(corruption);

      // oxlint-disable-next-line eslint/no-await-in-loop -- Each corruption owns an isolated SQLite database.
      await expect(runEnrollment(d1, validated)).rejects.toMatchObject({
        reason: "storage",
      });
      database.close();
    }
  });

  it("rejects a direct seal write without the exact stored session proof", async () => {
    const { database } = await setup();
    const mismatchedProofTime = now - 101;

    expect(() => directSealWrite(database, mismatchedProofTime)).toThrow(
      /invalid first-owner password enrollment binding/u
    );
    expect(
      database
        .prepare(
          "select count(*) count from app_first_owner_password_enrollment"
        )
        .get()
    ).toMatchObject({ count: 0 });
  });

  it("rejects direct seal writes with stale proof or invalid session state", async () => {
    const cases = [
      {
        mutate: (database: DatabaseSync) => {
          const stale = now - 5 * 60 * 1000 - 1;
          database
            .prepare("update auth_session set authentication_events = ?")
            .run(
              JSON.stringify([
                {
                  identityId: "identity-a",
                  type: "magic_link",
                  verifiedAt: stale,
                  version: 1,
                },
              ])
            );
          return stale;
        },
      },
      {
        mutate: (database: DatabaseSync) => {
          database.exec("update auth_session set revoked_at = auth_time");
          return now - 100;
        },
      },
      {
        mutate: (database: DatabaseSync) => {
          database.exec("update auth_session set expires_at = auth_time");
          return now - 100;
        },
      },
      {
        mutate: (database: DatabaseSync) => {
          database.exec(`update auth_session set metadata =
            '{"__effectAuthSession":{"version":1,"claims":{"requirements":["email_verification"]}}}'`);
          return now - 100;
        },
      },
    ];
    for (const testCase of cases) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- Each direct-write case owns an isolated SQLite database.
      const { database } = await setup();
      const proofVerifiedAt = testCase.mutate(database);

      expect(() => directSealWrite(database, proofVerifiedAt)).toThrow(
        /invalid first-owner password enrollment binding/u
      );
      expect(
        database
          .prepare(
            "select count(*) count from app_first_owner_password_enrollment"
          )
          .get()
      ).toMatchObject({ count: 0 });
      database.close();
    }
  });

  it("seals storage against mutation and rejects migration reapplication", async () => {
    const { database, d1, validated } = await setup();
    await runEnrollment(d1, validated);

    expect(() =>
      database.exec("delete from app_first_owner_password_enrollment")
    ).toThrow(/retained/u);
    expect(() =>
      database.exec(
        "update app_first_owner_password_enrollment set schema_version = 2"
      )
    ).toThrow(/immutable/u);

    const migrationDatabase = new DatabaseSync(":memory:");
    await applyControlPlaneMigrationsThrough(
      migrationDatabase,
      "1029_app_organization_lifecycle.sql"
    );
    await applyControlPlaneMigration(
      migrationDatabase,
      "1030_app_first_owner_password_enrollment.sql"
    );
    const snapshot = () =>
      JSON.stringify({
        artifacts: migrationDatabase
          .prepare(
            `select type, name, tbl_name, sql from sqlite_master
              where name glob 'app_first_owner_password_enrollment*'
              order by type, name`
          )
          .all(),
        generation: migrationDatabase
          .prepare(
            "select * from app_first_owner_password_enrollment_generation"
          )
          .get(),
      });
    const beforeReapply = snapshot();
    await expect(
      applyControlPlaneMigration(
        migrationDatabase,
        "1030_app_first_owner_password_enrollment.sql"
      )
    ).rejects.toThrow(/constraint|preflight|valid/u);
    expect(snapshot()).toBe(beforeReapply);
  });
});
