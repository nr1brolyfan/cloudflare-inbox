/* oxlint-disable vitest/max-expects -- Security lifecycle tests intentionally verify storage, receipt, audit, and plaintext boundaries together. */
import { DatabaseSync } from "node:sqlite";

import type { D1Database } from "@cloudflare/workers-types";
import { decodeAuditEvent } from "@effect-auth/core/AuditLog";
import { AuthRateLimit } from "@effect-auth/core/AuthRateLimit";
import { WebCryptoLive } from "@effect-auth/core/Crypto";
import type { D1EffectQbDatabaseLike } from "@effect-auth/core/EffectQbSqliteStorage";
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
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import { RecoveryCodeAdministrationD1Layer } from "#/modules/account-security/adapters/d1/RecoveryCodeAdministrationD1";
import { RecoveryCodeAdministration } from "#/modules/account-security/application/RecoveryCodeAdministration";
import { SensitiveOperationStepUpClock } from "#/modules/account-security/ports/SensitiveOperationStepUpClock";
import { ControlPlaneD1Layer } from "#/platform/control-plane-d1/ControlPlaneBatch";
import { ControlPlaneD1Binding } from "#/platform/control-plane-d1/ControlPlaneDatabase";
import { AdministrativeOperationId } from "#/shared/Operation";
import { CurrentRequestAuth } from "#/shared/RequestAuth";

import {
  applyControlPlaneMigrations,
  makeTestD1Database,
} from "../../../../support/d1";

const now = Date.now();
const operationId = Schema.decodeUnknownSync(AdministrativeOperationId)(
  "00000000-0000-4000-8000-000000000041"
);
const nextOperationId = Schema.decodeUnknownSync(AdministrativeOperationId)(
  "00000000-0000-4000-8000-000000000042"
);

const validatedSession = (
  user = "user-a",
  session = "session-a",
  options: { readonly restricted?: boolean; readonly stepUp?: boolean } = {}
) => {
  const userId = UserId(user);
  const sessionId = SessionId(session);
  const authenticationEvents =
    options.stepUp === false
      ? []
      : [
          {
            credentialId: CredentialId(`password-${user}`),
            type: "password" as const,
            verifiedAt: UnixMillis(now - 100),
            version: 1 as const,
          },
        ];
  const currentSession = {
    aal: "aal1" as const,
    amr: ["pwd"],
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
      token: SessionToken(`${session}.secret`),
    },
  } satisfies ValidatedSession;
};

const insertAccount = (database: DatabaseSync, session: ValidatedSession) => {
  const suffix = session.actor.userId === "user-a" ? "a" : "b";
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
       values (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      session.actor.sessionId,
      session.actor.userId,
      `session-secret-hash-${suffix}`,
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
       values (?, 'external-recovery-identity-verification', ?, 'hash', ?, ?, ?)`
    )
    .run(
      `recovery-challenge-${suffix}`,
      `recovery-${suffix}`,
      now - 1000,
      expiresAt,
      JSON.stringify({ userId: session.actor.userId })
    );
  database
    .prepare(
      `insert into app_external_recovery_identity
        (id, user_id, address, normalized_address, comparison_key, status,
         challenge_id, challenge_expires_at, enrollment_operation_id,
         created_at, updated_at, version)
       values (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, 1)`
    )
    .run(
      `recovery-${suffix}`,
      session.actor.userId,
      `recovery-${suffix}@external.test`,
      `recovery-${suffix}@external.test`,
      `recovery-${suffix}@external.test`,
      `recovery-challenge-${suffix}`,
      expiresAt,
      `00000000-0000-4000-8000-00000000002${suffix === "a" ? "0" : "1"}`,
      now - 1000,
      now - 1000
    );
  database
    .prepare("update auth_verification set consumed_at = ? where id = ?")
    .run(now - 500, `recovery-challenge-${suffix}`);
  database
    .prepare(
      `update app_external_recovery_identity
          set status = 'verified', verified_at = ?, updated_at = ?, version = 2
        where id = ?`
    )
    .run(now - 500, now - 500, `recovery-${suffix}`);
};

const seedActiveSet = (
  database: DatabaseSync,
  userId: string,
  setId: string,
  count = 10
) => {
  const insert = database.prepare(
    `insert into auth_recovery_code
      (id, user_id, code_hash, created_at, used_at, revoked_at, metadata)
     values (?, ?, ?, ?, null, null, ?)`
  );
  for (let index = 0; index < count; index += 1) {
    insert.run(
      `${setId}:${index}`,
      userId,
      `sha256:old-${index}`,
      now - 1000,
      JSON.stringify({ setId })
    );
  }
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

const loseResponseWithoutCommit = (
  database: D1EffectQbDatabaseLike
): D1EffectQbDatabaseLike => ({
  batch: () => Promise.reject(new Error("D1 request outcome unknown")),
  prepare: database.prepare,
});

const liveLayer = (d1: D1EffectQbDatabaseLike, onRateLimit?: () => void) => {
  const controlPlaneLive = ControlPlaneD1Layer.pipe(
    Layer.provide(
      Layer.succeed(
        ControlPlaneD1Binding,
        ControlPlaneD1Binding.of({ database: d1 as unknown as D1Database })
      )
    )
  );
  return RecoveryCodeAdministrationD1Layer.pipe(
    Layer.provide([
      controlPlaneLive,
      RecoveryCodesLive.pipe(Layer.provide(WebCryptoLive())),
      Layer.succeed(
        AuthRateLimit,
        AuthRateLimit.of({
          require: () => Effect.sync(() => onRateLimit?.()),
        })
      ),
      Layer.succeed(
        SensitiveOperationStepUpClock,
        SensitiveOperationStepUpClock.of({ now: () => now })
      ),
    ])
  );
};

const provideRequest = <A, E, R>(
  effect: Effect.Effect<
    A,
    E,
    AuthPermission.CurrentPrincipal | CurrentRequestAuth | R
  >,
  session: ValidatedSession
) =>
  effect.pipe(
    Effect.provideService(
      CurrentRequestAuth,
      CurrentRequestAuth.of({
        sessionSecretHash:
          session.actor.userId === "user-a"
            ? "session-secret-hash-a"
            : "session-secret-hash-b",
        validated: session,
      })
    ),
    Effect.provideService(
      AuthPermission.CurrentPrincipal,
      AuthPermission.CurrentPrincipal.of(
        AuthPermission.PermissionSubject.user(session.actor.userId)
      )
    )
  );

const generate = (
  layer: ReturnType<typeof liveLayer>,
  session: ValidatedSession,
  activeOperationId = operationId
) =>
  Effect.gen(function* () {
    const administration = yield* RecoveryCodeAdministration;
    return yield* administration.generate({ operationId: activeOperationId });
  }).pipe(Effect.provide(layer), (effect) => provideRequest(effect, session));

const readOperation = (
  layer: ReturnType<typeof liveLayer>,
  session: ValidatedSession,
  activeOperationId = operationId
) =>
  Effect.gen(function* () {
    const administration = yield* RecoveryCodeAdministration;
    return yield* administration.readOperation({
      operationId: activeOperationId,
    });
  }).pipe(Effect.provide(layer), (effect) => provideRequest(effect, session));

describe("recovery-code administration", () => {
  it("returns plaintext once and atomically stores only hashes, receipt metadata, and audit metadata", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      const session = validatedSession();
      insertAccount(database, session);
      const previousSetId = "00000000-0000-4000-8000-000000000051";
      seedActiveSet(database, session.actor.userId, previousSetId);
      const result = await Effect.runPromise(
        generate(liveLayer(makeTestD1Database(database)), session)
      );
      if (result._tag !== "RecoveryCodesGenerated") {
        throw new Error("expected one-time recovery codes");
      }
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
      const receipt = database
        .prepare("select * from app_recovery_code_rotation_receipt")
        .get() as Record<string, unknown>;
      const auditRow = database
        .prepare("select event from auth_audit_log")
        .get() as { event: string };

      expect(result.codes).toHaveLength(10);
      expect(new Set(result.codes).size).toBe(10);
      expect(result.receipt).toMatchObject({
        codeCount: 10,
        expectedPreviousSetId: previousSetId,
        operationId,
        schemaVersion: 1,
        userId: "user-a",
      });
      expect(receipt).toMatchObject({
        code_count: 10,
        expected_previous_set_id: previousSetId,
        operation_id: operationId,
        resulting_set_id: result.receipt.setId,
        schema_version: 1,
        user_id: "user-a",
      });
      expect(rows).toHaveLength(20);
      expect(rows.filter((row) => row.revoked_at !== null)).toHaveLength(10);
      expect(rows.filter((row) => row.revoked_at === null)).toHaveLength(10);
      expect(
        rows.every((row) => row.code_hash.startsWith("sha256:"))
      ).toBeTruthy();
      expect(decodeAuditEvent(JSON.parse(auditRow.event))).toMatchObject({
        payload: {
          codeCount: 10,
          operationId,
          setId: result.receipt.setId,
        },
        type: "app.recovery_codes.generated",
      });
      for (const code of result.codes) {
        expect(JSON.stringify({ auditRow, receipt, rows })).not.toContain(code);
      }
    } finally {
      database.close();
    }
  });

  it("replays the exact operation without plaintext, step-up, rate limit, or a second rotation", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      const session = validatedSession();
      insertAccount(database, session);
      let rateLimitCalls = 0;
      const layer = liveLayer(makeTestD1Database(database), () => {
        rateLimitCalls += 1;
      });
      const first = await Effect.runPromise(generate(layer, session));
      const replaySession = validatedSession("user-a", "session-a", {
        stepUp: false,
      });
      const replay = await Effect.runPromise(generate(layer, replaySession));

      expect(first._tag).toBe("RecoveryCodesGenerated");
      expect(replay).toMatchObject({
        _tag: "RecoveryCodesAlreadyGenerated",
        receipt: first.receipt,
      });
      expect(replay).not.toHaveProperty("codes");
      expect(rateLimitCalls).toBe(1);
      expect(
        database
          .prepare("select count(*) as count from auth_recovery_code")
          .get()
      ).toMatchObject({ count: 10 });
      expect(
        database.prepare("select count(*) as count from auth_audit_log").get()
      ).toMatchObject({ count: 1 });
    } finally {
      database.close();
    }
  });

  it("rejects the same operation ID under another actor before consuming rate limit", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      const firstSession = validatedSession();
      const otherSession = validatedSession("user-b", "session-b");
      insertAccount(database, firstSession);
      insertAccount(database, otherSession);
      let rateLimitCalls = 0;
      const layer = liveLayer(makeTestD1Database(database), () => {
        rateLimitCalls += 1;
      });
      await Effect.runPromise(generate(layer, firstSession));
      const error = await Effect.runPromise(
        generate(layer, otherSession).pipe(Effect.flip)
      );

      expect(error).toMatchObject({ reason: "operation-conflict" });
      expect(rateLimitCalls).toBe(1);
      expect(
        database
          .prepare("select count(*) as count from auth_recovery_code")
          .get()
      ).toMatchObject({ count: 10 });
    } finally {
      database.close();
    }
  });

  it("conflicts when the active set changes after snapshot instead of replacing it", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      const session = validatedSession();
      insertAccount(database, session);
      const concurrentSetId = "00000000-0000-4000-8000-000000000052";
      const d1 = beforeBatch(makeTestD1Database(database), () => {
        seedActiveSet(database, session.actor.userId, concurrentSetId);
      });
      const error = await Effect.runPromise(
        generate(liveLayer(d1), session).pipe(Effect.flip)
      );

      expect(error).toMatchObject({ reason: "state-conflict" });
      expect(
        database
          .prepare(
            `select count(*) as count from auth_recovery_code
              where revoked_at is null and metadata = ?`
          )
          .get(JSON.stringify({ setId: concurrentSetId }))
      ).toMatchObject({ count: 10 });
      expect(
        database
          .prepare(
            "select count(*) as count from app_recovery_code_rotation_receipt"
          )
          .get()
      ).toMatchObject({ count: 0 });
    } finally {
      database.close();
    }
  });

  it("preserves the active set when the session is revoked before the batch", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      const session = validatedSession();
      insertAccount(database, session);
      const previousSetId = "00000000-0000-4000-8000-000000000055";
      seedActiveSet(database, session.actor.userId, previousSetId);
      const d1 = beforeBatch(makeTestD1Database(database), () => {
        database
          .prepare("update auth_session set revoked_at = ? where id = ?")
          .run(now, session.actor.sessionId);
      });

      const error = await Effect.runPromise(
        generate(liveLayer(d1), session).pipe(Effect.flip)
      );

      expect(error).toMatchObject({ reason: "unauthenticated" });
      expect(
        database
          .prepare(
            `select
               (select count(*) from auth_recovery_code
                 where revoked_at is null and metadata = ?) as active_codes,
               (select count(*) from app_recovery_code_rotation_receipt)
                 as receipts,
               (select count(*) from auth_audit_log) as audits`
          )
          .get(JSON.stringify({ setId: previousSetId }))
      ).toMatchObject({ active_codes: 10, audits: 0, receipts: 0 });
    } finally {
      database.close();
    }
  });

  it("rejects malformed or mixed active-set metadata before generating material", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      const session = validatedSession();
      insertAccount(database, session);
      seedActiveSet(
        database,
        session.actor.userId,
        "00000000-0000-4000-8000-000000000053",
        1
      );
      seedActiveSet(
        database,
        session.actor.userId,
        "00000000-0000-4000-8000-000000000054",
        1
      );
      const error = await Effect.runPromise(
        generate(liveLayer(makeTestD1Database(database)), session).pipe(
          Effect.flip
        )
      );

      expect(error).toMatchObject({ reason: "storage" });
      expect(
        database
          .prepare(
            "select count(*) as count from app_recovery_code_rotation_receipt"
          )
          .get()
      ).toMatchObject({ count: 0 });
    } finally {
      database.close();
    }
  });

  it("recovers a committed unknown outcome as receipt-only", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      const session = validatedSession();
      insertAccount(database, session);
      const d1 = loseResponseAfterCommit(makeTestD1Database(database));
      const result = await Effect.runPromise(generate(liveLayer(d1), session));

      expect(result).toMatchObject({
        _tag: "RecoveryCodesAlreadyGenerated",
        receipt: { operationId },
      });
      expect(result).not.toHaveProperty("codes");
      expect(
        database
          .prepare(
            `select
               (select count(*) from auth_recovery_code) as codes,
               (select count(*) from app_recovery_code_rotation_receipt) as receipts,
               (select count(*) from auth_audit_log) as audits`
          )
          .get()
      ).toMatchObject({ audits: 1, codes: 10, receipts: 1 });
    } finally {
      database.close();
    }
  });

  it("preserves unknown commit state when one receipt readback is absent", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      const session = validatedSession();
      insertAccount(database, session);
      const d1 = loseResponseWithoutCommit(makeTestD1Database(database));
      const error = await Effect.runPromise(
        generate(liveLayer(d1), session).pipe(Effect.flip)
      );

      expect(error).toMatchObject({
        commitState: "unknown",
        reason: "indeterminate",
      });
      expect(
        database
          .prepare(
            `select
               (select count(*) from auth_recovery_code) as codes,
               (select count(*) from app_recovery_code_rotation_receipt) as receipts,
               (select count(*) from auth_audit_log) as audits`
          )
          .get()
      ).toMatchObject({ audits: 0, codes: 0, receipts: 0 });
    } finally {
      database.close();
    }
  });

  it.each([
    ["receipt", "app_recovery_code_rotation_receipt"],
    ["audit", "auth_audit_log"],
  ] as const)(
    "rolls back rotation when the %s insert fails",
    async (_, table) => {
      const database = new DatabaseSync(":memory:");
      try {
        await applyControlPlaneMigrations(database);
        const session = validatedSession();
        insertAccount(database, session);
        database.exec(`create trigger fail_rotation_insert
        before insert on ${table}
        begin
          select raise(abort, 'forced insert failure');
        end`);
        const error = await Effect.runPromise(
          generate(liveLayer(makeTestD1Database(database)), session).pipe(
            Effect.flip
          )
        );

        expect(error).toMatchObject({
          commitState: "unknown",
          reason: "indeterminate",
        });
        expect(
          database
            .prepare(
              `select
               (select count(*) from auth_recovery_code) as codes,
               (select count(*) from app_recovery_code_rotation_receipt) as receipts,
               (select count(*) from auth_audit_log) as audits,
               (select count(*) from app_authorization_guard) as guards`
            )
            .get()
        ).toMatchObject({ audits: 0, codes: 0, guards: 0, receipts: 0 });
      } finally {
        database.close();
      }
    }
  );

  it("enforces typed receipt privacy, result binding, and immutability", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      const session = validatedSession();
      insertAccount(database, session);
      await Effect.runPromise(
        generate(liveLayer(makeTestD1Database(database)), session)
      );
      const columns = database
        .prepare("pragma table_info(app_recovery_code_rotation_receipt)")
        .all() as { name: string }[];

      expect(columns.map(({ name }) => name)).toStrictEqual([
        "operation_id",
        "user_id",
        "expected_previous_set_id",
        "resulting_set_id",
        "generated_at",
        "committed_at",
        "code_count",
        "schema_version",
      ]);
      expect(() =>
        database.exec(
          "update app_recovery_code_rotation_receipt set committed_at = committed_at + 1"
        )
      ).toThrow(/immutable/u);
      expect(() =>
        database.exec("delete from app_recovery_code_rotation_receipt")
      ).toThrow(/retained/u);
      expect(() =>
        database.exec(
          `insert or replace into app_recovery_code_rotation_receipt
           select * from app_recovery_code_rotation_receipt`
        )
      ).toThrow(/immutable/u);
      expect(() =>
        database
          .prepare(
            `insert into app_recovery_code_rotation_receipt
              (operation_id, user_id, expected_previous_set_id,
               resulting_set_id, generated_at, committed_at, code_count,
               schema_version)
             values (?, 'user-a', null, ?, ?, ?, 10, 1)`
          )
          .run(
            nextOperationId,
            "00000000-0000-4000-8000-000000000055",
            now,
            now
          )
      ).toThrow(/binding/u);
      expect(
        columns.some(({ name }) =>
          [
            "code_hash",
            "plaintext",
            "email",
            "json",
            "session",
            "secret",
            "token",
          ].some((forbidden) => name.includes(forbidden))
        )
      ).toBeFalsy();
    } finally {
      database.close();
    }
  });

  it("keeps readback actor-scoped and denies all restricted receipt access", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      const session = validatedSession();
      const otherSession = validatedSession("user-b", "session-b");
      insertAccount(database, session);
      insertAccount(database, otherSession);
      const layer = liveLayer(makeTestD1Database(database));
      const generated = await Effect.runPromise(generate(layer, session));
      const receipt = await Effect.runPromise(readOperation(layer, session));
      const otherActorError = await Effect.runPromise(
        readOperation(layer, otherSession).pipe(Effect.flip)
      );
      const restricted = validatedSession("user-a", "session-a", {
        restricted: true,
      });
      const restrictedReadError = await Effect.runPromise(
        readOperation(layer, restricted).pipe(Effect.flip)
      );
      const restrictedReplayError = await Effect.runPromise(
        generate(layer, restricted).pipe(Effect.flip)
      );

      expect(receipt).toStrictEqual(generated.receipt);
      expect(otherActorError).toMatchObject({ reason: "not-found" });
      expect(restrictedReadError).toMatchObject({
        reason: "restricted-session",
      });
      expect(restrictedReplayError).toMatchObject({
        reason: "restricted-session",
      });
    } finally {
      database.close();
    }
  });
});
