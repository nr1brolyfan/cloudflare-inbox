import { DatabaseSync } from "node:sqlite";

import {
  SessionId,
  SessionToken,
  UnixMillis,
  UserId,
} from "@effect-auth/core/Identifiers";
import type {
  SessionClaims,
  ValidatedSession,
} from "@effect-auth/core/Sessions";
import { sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  recoveryRemediationSessionPredicate,
  transactionalSessionPredicate,
} from "#/modules/account-security/integration/AccountSecurityD1RequestGuard";
import {
  ControlPlaneD1Binding,
  ControlPlaneDatabase,
  ControlPlaneDatabaseLayer,
} from "#/platform/control-plane-d1/ControlPlaneDatabase";
import type { CurrentRequestAuthShape } from "#/shared/RequestAuth";

import {
  applyControlPlaneMigrations,
  makeTestD1Database,
} from "../../../support/d1";

const now = Date.now();
const userId = UserId("user-a");
const sessionId = SessionId("session-a");
const currentSession = {
  aal: "aal1" as const,
  amr: [],
  authenticationEvents: [],
  authTime: UnixMillis(now - 1000),
  expiresAt: UnixMillis(now + 60 * 60 * 1000),
  sessionId,
  userId,
};
const validated = {
  actor: { sessionId, userId },
  currentSession,
  issued: {
    ...currentSession,
    token: SessionToken(`${sessionId}.secret`),
  },
} satisfies ValidatedSession;
const requestAuth = {
  sessionSecretHash: "session-secret-hash",
  validated,
} satisfies CurrentRequestAuthShape;
const PredicateRow = Schema.Struct({ allowed: Schema.Number });

const databaseLayer = (database: DatabaseSync) =>
  ControlPlaneDatabaseLayer.pipe(
    Layer.provide(
      Layer.succeed(
        ControlPlaneD1Binding,
        ControlPlaneD1Binding.of({
          database: makeTestD1Database(database) as unknown as D1Database,
        })
      )
    )
  );

const insertSession = (database: DatabaseSync) => {
  database
    .prepare(
      "insert into auth_user (id, created_at, updated_at) values (?, ?, ?)"
    )
    .run(userId, now - 1000, now - 1000);
  database
    .prepare(
      `insert into auth_session
        (id, user_id, secret_hash, created_at, expires_at, auth_time,
         authentication_events, aal, amr)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      sessionId,
      userId,
      requestAuth.sessionSecretHash,
      now - 1000,
      currentSession.expiresAt,
      currentSession.authTime,
      "[]",
      currentSession.aal,
      "[]"
    );
};

const predicateResult = (database: DatabaseSync, claims: SessionClaims) => {
  database.prepare("update auth_session set metadata = ? where id = ?").run(
    JSON.stringify({
      __effectAuthSession: { claims, version: 1 },
    }),
    sessionId
  );

  return Effect.runPromise(
    Effect.gen(function* () {
      const controlPlane = yield* ControlPlaneDatabase;
      const rows = yield* controlPlane.all(sql`select cast(
        ${recoveryRemediationSessionPredicate(controlPlane, requestAuth, now)}
        as integer
      ) as allowed`);
      return yield* Schema.decodeUnknownEffect(Schema.Array(PredicateRow))(
        rows
      );
    }).pipe(Effect.provide(databaseLayer(database)))
  );
};

const unrestrictedPredicateResult = (
  database: DatabaseSync,
  metadata: string | null
) => {
  database
    .prepare("update auth_session set metadata = ? where id = ?")
    .run(metadata, sessionId);

  return Effect.runPromise(
    Effect.gen(function* () {
      const controlPlane = yield* ControlPlaneDatabase;
      const rows = yield* controlPlane.all(sql`select cast(
        ${transactionalSessionPredicate(controlPlane, requestAuth, now)}
        as integer
      ) as allowed`);
      return yield* Schema.decodeUnknownEffect(Schema.Array(PredicateRow))(
        rows
      );
    }).pipe(Effect.provide(databaseLayer(database)))
  );
};

describe("unrestricted D1 session predicate", () => {
  it.each([
    ["absent metadata", null],
    ["ordinary object metadata", JSON.stringify({ purpose: "ordinary" })],
    ["absent claims", JSON.stringify({ __effectAuthSession: { version: 1 } })],
    [
      "absent requirements",
      JSON.stringify({
        __effectAuthSession: { claims: {}, version: 1 },
      }),
    ],
    [
      "exact empty requirements",
      JSON.stringify({
        __effectAuthSession: { claims: { requirements: [] }, version: 1 },
      }),
    ],
  ] as const)("accepts %s", async (_, metadata) => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      insertSession(database);
      const [row] = await unrestrictedPredicateResult(database, metadata);
      expect(row?.allowed).toBe(1);
    } finally {
      database.close();
    }
  });

  it.each([
    ["JSON null metadata", "null"],
    ["scalar metadata root", JSON.stringify("ordinary")],
    ["array metadata root", JSON.stringify([])],
    ["JSON null auth envelope", JSON.stringify({ __effectAuthSession: null })],
    [
      "scalar auth envelope",
      JSON.stringify({ __effectAuthSession: "unrestricted" }),
    ],
    [
      "missing auth envelope version",
      JSON.stringify({ __effectAuthSession: {} }),
    ],
    [
      "unsupported auth envelope version",
      JSON.stringify({ __effectAuthSession: { version: 2 } }),
    ],
    [
      "JSON null claims",
      JSON.stringify({
        __effectAuthSession: { claims: null, version: 1 },
      }),
    ],
    [
      "scalar claims",
      JSON.stringify({
        __effectAuthSession: { claims: "unrestricted", version: 1 },
      }),
    ],
    [
      "non-array requirements",
      JSON.stringify({
        __effectAuthSession: {
          claims: { requirements: "email_verification" },
          version: 1,
        },
      }),
    ],
    [
      "JSON null requirements",
      JSON.stringify({
        __effectAuthSession: { claims: { requirements: null }, version: 1 },
      }),
    ],
    [
      "dangling recovery enrollment",
      JSON.stringify({
        __effectAuthSession: {
          claims: {
            recoveryEnrollment: { allowed: ["recovery-codes"] },
            requirements: [],
          },
          version: 1,
        },
      }),
    ],
    [
      "dangling recovery remediation",
      JSON.stringify({
        __effectAuthSession: {
          claims: {
            recoveryRemediation: { allowed: ["second-passkey"] },
            requirements: [],
          },
          version: 1,
        },
      }),
    ],
    [
      "malformed recovery container",
      JSON.stringify({
        __effectAuthSession: {
          claims: { recoveryRemediation: "second-passkey", requirements: [] },
          version: 1,
        },
      }),
    ],
    ["malformed metadata JSON", "{not-json"],
  ] as const)("denies %s", async (_, metadata) => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      insertSession(database);
      const [row] = await unrestrictedPredicateResult(database, metadata);
      expect(row?.allowed).toBe(0);
    } finally {
      database.close();
    }
  });
});

describe("recovery remediation D1 session predicate", () => {
  it.each([
    ["exact singleton", ["second-passkey"], 1],
    ["overbroad", ["second-passkey", "verified-email"], 0],
    ["duplicate", ["second-passkey", "second-passkey"], 0],
  ] as const)("evaluates %s capabilities", async (_, allowed, expected) => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      insertSession(database);
      const [row] = await predicateResult(database, {
        recoveryRemediation: { allowed },
        requirements: ["recovery_remediation"],
      });
      expect(row?.allowed).toBe(expected);
    } finally {
      database.close();
    }
  });

  it("denies a second recovery capability container", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await applyControlPlaneMigrations(database);
      insertSession(database);
      const [row] = await predicateResult(database, {
        recoveryEnrollment: { allowed: ["recovery-codes"] },
        recoveryRemediation: { allowed: ["second-passkey"] },
        requirements: ["recovery_remediation"],
      });
      expect(row?.allowed).toBe(0);
    } finally {
      database.close();
    }
  });
});
