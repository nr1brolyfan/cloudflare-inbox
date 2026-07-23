/* oxlint-disable vitest/max-expects -- Receipt tests verify one atomic security state transition across bound tables. */
import { DatabaseSync } from "node:sqlite";

import type { D1Database } from "@cloudflare/workers-types";
import { emptyCustomEvidencePolicyRegistry } from "@effect-auth/core/Assurance";
import { AuthSecrets } from "@effect-auth/core/AuthConfig";
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
import {
  RecoveryCodeHash,
  RecoveryCodeManagement,
  RecoveryCodes,
} from "@effect-auth/core/RecoveryCode";
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
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import { AccountRecoveryD1Layer } from "#/modules/account-security/adapters/d1/AccountRecoveryD1";
import { AccountRecovery } from "#/modules/account-security/application/AccountRecovery";
import {
  CompleteAccountRecoveryCommand,
  externalRecoveryLinkEvidence,
  ReadAccountRecoveryCompletionCommand,
} from "#/modules/account-security/domain/AccountRecovery";
import { AccountRecoveryDelivery } from "#/modules/account-security/ports/AccountRecoveryDelivery";
import { RecoverySafeIdentityPolicy } from "#/modules/account-security/ports/RecoverySafeIdentityPolicy";
import { ControlPlaneD1Layer } from "#/platform/control-plane-d1/ControlPlaneBatch";
import { ControlPlaneD1Binding } from "#/platform/control-plane-d1/ControlPlaneDatabase";

import {
  applyControlPlaneMigrations,
  makeTestD1Database,
} from "../../../../support/d1";

const now = Date.now();
const userId = UserId("user-a");
const flowId = AuthFlowId("account-recovery-flow-a");
const codeId = CredentialId("recovery-code-a");
const operationId = "00000000-0000-4000-8000-000000000061";
const readbackSecret = "r".repeat(43);
const flowSecret = "s".repeat(32);
const recoveryCode = "AAAA-BBBB-CCCC-DDDD";
const flowSecretHash = "a".repeat(43);
const readbackSecretHash = "b".repeat(43);
const recoveryCodeHash = RecoveryCodeHash(`sha256:${"c".repeat(43)}`);
const differentRecoveryCodeHash = RecoveryCodeHash(`sha256:${"d".repeat(43)}`);
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
  secretHash: flowSecretHash,
  createdAt: UnixMillis(now - 1000),
  expiresAt: UnixMillis(now + 60_000),
  metadata: { encoded: "flow-state" },
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
       values (?, ?, ?, ?, '{"setId":"set-a"}')`
    )
    .run(codeId, userId, recoveryCodeHash, now - 1000);
};

const command = (overrides: Record<string, unknown> = {}) =>
  Schema.decodeUnknownSync(CompleteAccountRecoveryCommand)({
    code: recoveryCode,
    flowId,
    operationId,
    readbackSecret,
    secret: flowSecret,
    ...overrides,
  });

interface FixtureOptions {
  readonly batchFailure?:
    | "after-commit"
    | "before-commit"
    | "second-before-commit";
  readonly invalidSessionBinding?: boolean;
}

const makeFixture = async (options: FixtureOptions = {}) => {
  const database = new DatabaseSync(":memory:");
  await applyControlPlaneMigrations(database);
  insertEligibleAccount(database);
  const baseD1 = makeTestD1Database(database);
  let batchQueue = Promise.resolve();
  let batchCalls = 0;
  const d1 = {
    ...baseD1,
    batch: (statements: Parameters<typeof baseD1.batch>[0]) => {
      const execute = async () => {
        batchCalls += 1;
        if (options.batchFailure === "before-commit") {
          throw new Error("simulated unknown outcome before commit");
        }
        if (
          options.batchFailure === "second-before-commit" &&
          batchCalls === 2
        ) {
          throw new Error("simulated conflicting unknown outcome");
        }
        const results = await baseD1.batch(statements);
        if (options.batchFailure === "after-commit") {
          throw new Error("simulated lost response after commit");
        }
        return results;
      };
      const pending = batchQueue.then(execute, execute);
      batchQueue = pending.then(
        () => {},
        () => {}
      );
      return pending;
    },
  };
  let preparedTtl: SessionTtlPolicy | undefined;
  let sessionSequence = 0;
  const controlPlaneLive = ControlPlaneD1Layer.pipe(
    Layer.provide(
      Layer.succeed(
        ControlPlaneD1Binding,
        ControlPlaneD1Binding.of({ database: d1 as unknown as D1Database })
      )
    )
  );
  const layer = AccountRecoveryD1Layer.pipe(
    Layer.provide([
      controlPlaneLive,
      Layer.succeed(
        AuthSecrets,
        AuthSecrets.make({
          challenge: Redacted.make("challenge-key"),
          privacy: Redacted.make("privacy-key"),
          session: Redacted.make("session-key"),
        })
      ),
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
      Layer.mock(Crypto, {
        hmacSha256: ({ data }) =>
          Effect.succeed(
            typeof data === "string" &&
              data === `account-recovery-readback:${readbackSecret}`
              ? readbackSecretHash
              : data === flowSecret
                ? flowSecretHash
                : "e".repeat(43)
          ),
        randomToken: () => Effect.succeed("unused"),
      }),
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
      Layer.mock(RecoveryCodes, {
        hash: ({ code }) =>
          Effect.succeed(
            Redacted.value(code) === recoveryCode
              ? recoveryCodeHash
              : differentRecoveryCodeHash
          ),
      }),
      Layer.succeed(
        Sessions,
        Sessions.of({
          customEvidencePolicies: emptyCustomEvidencePolicyRegistry,
          prepareCreate: (input: SessionCreateInput) => {
            preparedTtl = input.ttl;
            sessionSequence += 1;
            const sessionId = SessionId(`recovery-session-${sessionSequence}`);
            const createdAt = input.now ?? UnixMillis(Date.now());
            const issuedSession = {
              aal: "aal1" as const,
              amr: ["external_recovery_link", "recovery_code"],
              authenticationEvents: input.authenticationEvents,
              authTime: createdAt,
              claims: input.claims,
              expiresAt: UnixMillis(Number(createdAt) + 15 * 60 * 1000),
              sessionId,
              token: SessionToken(`${sessionId}.secret`),
              userId,
            } satisfies IssuedSession;
            return Effect.succeed({
              row: {
                aal: issuedSession.aal,
                amr: issuedSession.amr,
                authenticationEvents: issuedSession.authenticationEvents,
                authTime: issuedSession.authTime,
                claims: issuedSession.claims,
                createdAt,
                expiresAt: issuedSession.expiresAt,
                id: sessionId,
                metadata: options.invalidSessionBinding
                  ? { ...metadata, purpose: "wrong-purpose" }
                  : metadata,
                secretHash: "new-session-secret-hash",
                userId,
              },
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
  const complete = (input = command()) =>
    Effect.gen(function* () {
      const recovery = yield* AccountRecovery;
      return yield* recovery.complete(input);
    }).pipe(Effect.provide(layer));
  const readCompletion = (input: {
    readonly operationId: string;
    readonly readbackSecret: string;
  }) =>
    Effect.gen(function* () {
      const recovery = yield* AccountRecovery;
      return yield* recovery.readCompletion(
        Schema.decodeUnknownSync(ReadAccountRecoveryCompletionCommand)(input)
      );
    }).pipe(Effect.provide(layer));

  return {
    batchCalls: () => batchCalls,
    complete,
    database,
    preparedTtl: () => preparedTtl,
    readCompletion,
  };
};

describe("account recovery completion receipts", () => {
  it("atomically consumes proof and code into one restricted session and receipt", async () => {
    const fixture = await makeFixture();
    try {
      const result = await Effect.runPromise(fixture.complete());
      const receipt = fixture.database
        .prepare("select * from app_account_recovery_completion_receipt")
        .get() as Record<string, unknown>;
      const storedVerification = fixture.database
        .prepare("select consumed_at from auth_verification where id = ?")
        .get(flowId) as { consumed_at: number | null };
      const storedCode = fixture.database
        .prepare("select used_at from auth_recovery_code where id = ?")
        .get(codeId) as { used_at: number | null };
      const storedSession = fixture.database
        .prepare("select metadata from auth_session")
        .get() as { metadata: string };

      expect(result).toMatchObject({
        _tag: "AccountRecoveryCompleted",
        receipt: {
          operationId,
          schemaVersion: 1,
          status: "recovery-remediation-required",
        },
      });
      expect(storedVerification.consumed_at).not.toBeNull();
      expect(storedCode.used_at).toBe(storedVerification.consumed_at);
      expect(receipt).toMatchObject({
        flow_secret_hash: flowSecretHash,
        readback_secret_hash: readbackSecretHash,
        recovery_code_hash: recoveryCodeHash,
        result_status: "recovery-remediation-required",
      });
      expect(JSON.parse(storedSession.metadata)).toMatchObject({
        __effectAuthSession: {
          claims: { requirements: ["recovery_remediation"] },
        },
      });
      const preparedTtl = fixture.preparedTtl();
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
    } finally {
      fixture.database.close();
    }
  });

  it("returns an exact receipt-only replay without another consumption or session", async () => {
    const fixture = await makeFixture();
    try {
      await Effect.runPromise(fixture.complete());
      const replay = await Effect.runPromise(fixture.complete());

      expect(replay).toMatchObject({
        _tag: "AccountRecoveryAlreadyCompleted",
        receipt: { operationId },
      });
      expect(
        fixture.database
          .prepare("select count(*) as count from auth_session")
          .get()
      ).toMatchObject({ count: 1 });
      expect(
        fixture.database
          .prepare(
            "select count(*) as count from auth_recovery_code where used_at is not null"
          )
          .get()
      ).toMatchObject({ count: 1 });
    } finally {
      fixture.database.close();
    }
  });

  it.each([
    ["code", { code: "EEEE-FFFF-GGGG-HHHH" }],
    ["flow", { flowId: "different-account-recovery-flow" }],
    ["flow secret", { secret: "x".repeat(32) }],
    ["readback proof", { readbackSecret: "z".repeat(43) }],
  ])(
    "denies a reused operation with changed %s generically",
    async (_name, changed) => {
      const fixture = await makeFixture();
      try {
        await Effect.runPromise(fixture.complete());
        await expect(
          Effect.runPromise(fixture.complete(command(changed)))
        ).rejects.toMatchObject({ reason: "invalid-proof" });
      } finally {
        fixture.database.close();
      }
    }
  );

  it("recovers a committed unknown outcome as receipt-only", async () => {
    const fixture = await makeFixture({ batchFailure: "after-commit" });
    try {
      await expect(
        Effect.runPromise(fixture.complete())
      ).resolves.toMatchObject({
        _tag: "AccountRecoveryAlreadyCompleted",
        receipt: { operationId },
      });
      expect(
        fixture.database
          .prepare(
            "select count(*) as count from app_account_recovery_completion_receipt"
          )
          .get()
      ).toMatchObject({ count: 1 });
    } finally {
      fixture.database.close();
    }
  });

  it("keeps an unknown outcome without a matching receipt indeterminate", async () => {
    const fixture = await makeFixture({ batchFailure: "before-commit" });
    try {
      await expect(Effect.runPromise(fixture.complete())).rejects.toMatchObject(
        {
          reason: "indeterminate",
        }
      );
      expect(
        fixture.database
          .prepare("select count(*) as count from auth_session")
          .get()
      ).toMatchObject({ count: 0 });
    } finally {
      fixture.database.close();
    }
  });

  it("maps a mismatched receipt found after an unknown outcome to generic invalid proof", async () => {
    const fixture = await makeFixture({ batchFailure: "second-before-commit" });
    try {
      const [first, conflicting] = await Promise.allSettled([
        Effect.runPromise(fixture.complete()),
        Effect.runPromise(
          fixture.complete(command({ readbackSecret: "z".repeat(43) }))
        ),
      ]);

      expect(first).toMatchObject({ status: "fulfilled" });
      expect(conflicting).toMatchObject({
        reason: { reason: "invalid-proof" },
        status: "rejected",
      });
      expect(fixture.batchCalls()).toBe(2);
    } finally {
      fixture.database.close();
    }
  });

  it("resolves concurrent same-operation completion to one first result and one replay", async () => {
    const fixture = await makeFixture();
    try {
      const results = await Effect.runPromise(
        Effect.all([fixture.complete(), fixture.complete()], {
          concurrency: "unbounded",
        })
      );

      expect(new Set(results.map((result) => result._tag))).toStrictEqual(
        new Set(["AccountRecoveryAlreadyCompleted", "AccountRecoveryCompleted"])
      );
      expect(
        fixture.database
          .prepare("select count(*) as count from auth_session")
          .get()
      ).toMatchObject({ count: 1 });
    } finally {
      fixture.database.close();
    }
  });

  it("rolls every state change back when receipt binding fails", async () => {
    const fixture = await makeFixture({ invalidSessionBinding: true });
    try {
      await expect(Effect.runPromise(fixture.complete())).rejects.toMatchObject(
        {
          reason: "indeterminate",
        }
      );
      expect(
        fixture.database
          .prepare(
            `select
               (select count(*) from auth_session) as sessions,
               (select count(*) from auth_audit_log where type = 'app.account_recovery.entered') as audits,
               (select count(*) from app_account_recovery_completion_receipt) as receipts,
               (select count(*) from auth_recovery_code where used_at is not null) as used_codes,
               (select count(*) from auth_verification where id = ? and consumed_at is not null) as consumed_flows`
          )
          .get(flowId)
      ).toMatchObject({
        audits: 0,
        consumed_flows: 0,
        receipts: 0,
        sessions: 0,
        used_codes: 0,
      });
    } finally {
      fixture.database.close();
    }
  });

  it("requires the readback proof and exposes only the public receipt", async () => {
    const fixture = await makeFixture();
    try {
      await Effect.runPromise(fixture.complete());
      const receipt = await Effect.runPromise(
        fixture.readCompletion({ operationId, readbackSecret })
      );

      expect(receipt).toMatchObject({
        completedAt: receipt.completedAt,
        operationId,
        schemaVersion: 1,
        status: "recovery-remediation-required",
      });
      await expect(
        Effect.runPromise(
          fixture.readCompletion({
            operationId,
            readbackSecret: "z".repeat(43),
          })
        )
      ).rejects.toMatchObject({ reason: "invalid-proof" });
      await expect(
        Effect.runPromise(
          fixture.readCompletion({
            operationId: "00000000-0000-4000-8000-000000000099",
            readbackSecret,
          })
        )
      ).rejects.toMatchObject({ reason: "invalid-proof" });
    } finally {
      fixture.database.close();
    }
  });

  it("enforces receipt binding, retention, immutability, and a non-sensitive schema", async () => {
    const fixture = await makeFixture();
    try {
      const result = await Effect.runPromise(fixture.complete());
      expect(result._tag).toBe("AccountRecoveryCompleted");
      const columns = fixture.database
        .prepare("pragma table_info(app_account_recovery_completion_receipt)")
        .all() as { name: string }[];
      const stored = fixture.database
        .prepare("select * from app_account_recovery_completion_receipt")
        .get() as Record<string, unknown>;

      expect(columns.map(({ name }) => name)).not.toStrictEqual(
        expect.arrayContaining([
          "code",
          "email",
          "flow_secret",
          "readback_secret",
          "session_token",
          "webauthn_data",
          "result_json",
        ])
      );
      expect(JSON.stringify(stored)).not.toContain(recoveryCode);
      expect(JSON.stringify(stored)).not.toContain(flowSecret);
      expect(JSON.stringify(stored)).not.toContain(readbackSecret);
      expect(() =>
        fixture.database
          .prepare(
            "update app_account_recovery_completion_receipt set completed_at = completed_at + 1"
          )
          .run()
      ).toThrow(/immutable/u);
      expect(() =>
        fixture.database
          .prepare("delete from app_account_recovery_completion_receipt")
          .run()
      ).toThrow(/retained/u);
      expect(() =>
        fixture.database
          .prepare(
            `insert into app_account_recovery_completion_receipt
             select * from app_account_recovery_completion_receipt`
          )
          .run()
      ).toThrow(/immutable/u);
      expect(() =>
        fixture.database
          .prepare(
            `insert into app_account_recovery_completion_receipt
              (operation_id, readback_secret_hash, flow_id, flow_secret_hash,
               recovery_code_id, recovery_code_hash, user_id,
               external_recovery_identity_id,
               expected_external_recovery_identity_version, session_id,
               result_status, completed_at, schema_version)
             values ('00000000-0000-4000-8000-000000000062', ?, 'missing-flow', ?,
                     'missing-code', ?, 'user-a', 'recovery-a', 2, 'missing-session',
                     'recovery-remediation-required', ?, 1)`
          )
          .run(readbackSecretHash, flowSecretHash, recoveryCodeHash, Date.now())
      ).toThrow(/invalid account-recovery completion receipt binding/u);
    } finally {
      fixture.database.close();
    }
  });
});
