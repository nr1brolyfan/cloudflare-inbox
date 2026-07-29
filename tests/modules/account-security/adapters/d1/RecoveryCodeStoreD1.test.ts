import { DatabaseSync } from "node:sqlite";

import {
  CredentialId,
  UnixMillis,
  UserId,
} from "@effect-auth/core/Identifiers";
import {
  RecoveryCodeHash,
  RecoveryCodeStore,
  RecoveryCodeStoreError,
} from "@effect-auth/core/RecoveryCode";
import type { RecoveryCodeRecord } from "@effect-auth/core/RecoveryCode";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { describe, expect, it } from "vitest";

import { RecoveryCodeStoreD1Layer } from "#/modules/account-security/adapters/d1/RecoveryCodeStoreD1";
import { ControlPlaneD1Layer } from "#/platform/control-plane-d1/ControlPlaneBatch";
import { ControlPlaneD1Binding } from "#/platform/control-plane-d1/ControlPlaneDatabase";

import {
  applyControlPlaneMigrations,
  makeTestD1Database,
} from "../../../../support/d1";
import type { TestD1DatabaseLike } from "../../../../support/d1";

const userId = UserId("user-a");

const code = (
  suffix: string,
  createdAt: number,
  overrides: Partial<RecoveryCodeRecord> = {}
): RecoveryCodeRecord => ({
  codeHash: RecoveryCodeHash(`sha256:${suffix.repeat(43).slice(0, 43)}`),
  createdAt: UnixMillis(createdAt),
  id: CredentialId(`code-${suffix}`),
  metadata: { set: suffix },
  userId,
  ...overrides,
});

const makeStoreLive = (d1: TestD1DatabaseLike) => {
  const controlPlane = ControlPlaneD1Layer.pipe(
    Layer.provide(
      Layer.succeed(
        ControlPlaneD1Binding,
        ControlPlaneD1Binding.of({ database: d1 as unknown as D1Database })
      )
    )
  );
  return RecoveryCodeStoreD1Layer.pipe(Layer.provide(controlPlane));
};

const withStore = <A, E>(
  d1: TestD1DatabaseLike,
  use: (store: RecoveryCodeStore["Service"]) => Effect.Effect<A, E>
) =>
  Effect.runPromise(
    RecoveryCodeStore.pipe(
      Effect.flatMap(use),
      Effect.provide(makeStoreLive(d1))
    )
  );

describe("native D1 recovery-code store", () => {
  it("round-trips codecs and applies deterministic used/revoked filtering", async () => {
    const database = new DatabaseSync(":memory:");
    await applyControlPlaneMigrations(database);
    const d1 = makeTestD1Database(database);

    try {
      const result = await withStore(d1, (store) =>
        Effect.gen(function* () {
          yield* store.insertMany([
            code("b", 200),
            code("c", 100, { usedAt: UnixMillis(250) }),
            code("a", 100, { revokedAt: UnixMillis(300) }),
          ]);
          const active = yield* store.listByUser({ userId });
          const all = yield* store.listByUser({
            includeRevoked: true,
            includeUsed: true,
            userId,
          });
          const found = yield* store.findById(CredentialId("code-b"));
          return { active, all, found };
        })
      );

      expect(result.active.map(({ id }) => id)).toStrictEqual(["code-b"]);
      expect(result.all.map(({ id }) => id)).toStrictEqual([
        "code-a",
        "code-c",
        "code-b",
      ]);
      expect(Option.getOrThrow(result.found).metadata).toStrictEqual({
        set: "b",
      });
    } finally {
      database.close();
    }
  });

  it("CAS-marks a code used only while unused and active", async () => {
    const database = new DatabaseSync(":memory:");
    await applyControlPlaneMigrations(database);
    const d1 = makeTestD1Database(database);

    try {
      const result = await withStore(d1, (store) =>
        Effect.gen(function* () {
          yield* store.insertMany([code("a", 100), code("b", 100)]);
          const used = yield* store.markUsed({
            id: CredentialId("code-a"),
            metadata: { ceremony: "recovery" },
            usedAt: UnixMillis(200),
          });
          const replay = yield* store.markUsed({
            id: CredentialId("code-a"),
            usedAt: UnixMillis(300),
          });
          yield* store.revoke({
            id: CredentialId("code-b"),
            reason: "manual",
            revokedAt: UnixMillis(200),
          });
          const revoked = yield* store.markUsed({
            id: CredentialId("code-b"),
            usedAt: UnixMillis(300),
          });
          return { replay, revoked, used };
        })
      );

      expect(Option.getOrThrow(result.used)).toMatchObject({
        metadata: { ceremony: "recovery" },
        usedAt: 200,
      });
      expect(Option.isNone(result.replay)).toBeTruthy();
      expect(Option.isNone(result.revoked)).toBeTruthy();
      expect(
        database
          .prepare("select metadata from auth_recovery_code where id = ?")
          .get("code-b")
      ).toMatchObject({
        metadata: JSON.stringify({ set: "b", revokeReason: "manual" }),
      });
    } finally {
      database.close();
    }
  });

  it("replaces active codes in exactly one atomic ControlPlaneBatch", async () => {
    const database = new DatabaseSync(":memory:");
    await applyControlPlaneMigrations(database);
    const base = makeTestD1Database(database);
    const batchSizes: number[] = [];
    const d1: TestD1DatabaseLike = {
      prepare: base.prepare,
      batch: (statements) => {
        batchSizes.push(statements.length);
        return base.batch(statements);
      },
    };

    try {
      await withStore(d1, (store) => store.insertMany([code("a", 100)]));
      batchSizes.length = 0;

      await withStore(d1, (store) =>
        store.replaceActiveForUser({
          revokeReason: "regenerated",
          revokedAt: UnixMillis(200),
          rows: [code("b", 200), code("c", 200)],
          userId,
        })
      );

      expect(batchSizes).toStrictEqual([3]);
      expect(
        database
          .prepare(
            "select id, revoked_at as revokedAt, metadata from auth_recovery_code order by id"
          )
          .all()
      ).toMatchObject([
        {
          id: "code-a",
          metadata: JSON.stringify({ set: "a", revokeReason: "regenerated" }),
          revokedAt: 200,
        },
        {
          id: "code-b",
          metadata: JSON.stringify({ set: "b" }),
          revokedAt: null,
        },
        {
          id: "code-c",
          metadata: JSON.stringify({ set: "c" }),
          revokedAt: null,
        },
      ]);
    } finally {
      database.close();
    }
  });

  it("rolls back active revocation when a replacement insert fails", async () => {
    const database = new DatabaseSync(":memory:");
    await applyControlPlaneMigrations(database);
    const d1 = makeTestD1Database(database);

    try {
      await withStore(d1, (store) =>
        store.insertMany([code("a", 100), code("b", 100)])
      );
      const error = await Effect.runPromise(
        RecoveryCodeStore.pipe(
          Effect.flatMap((store) =>
            store.replaceActiveForUser({
              revokedAt: UnixMillis(200),
              rows: [code("b", 200)],
              userId,
            })
          ),
          Effect.flip,
          Effect.provide(makeStoreLive(d1))
        )
      );

      expect(error).toBeInstanceOf(RecoveryCodeStoreError);
      expect(error).toMatchObject({ operation: "replace-active" });
      expect(
        database
          .prepare(
            "select count(*) as count from auth_recovery_code where revoked_at is null"
          )
          .get()
      ).toMatchObject({ count: 2 });
    } finally {
      database.close();
    }
  });

  it("records a revoke reason when persisted metadata is non-object JSON", async () => {
    const database = new DatabaseSync(":memory:");
    await applyControlPlaneMigrations(database);
    const d1 = makeTestD1Database(database);

    try {
      await withStore(d1, (store) => store.insertMany([code("a", 100)]));
      database
        .prepare("update auth_recovery_code set metadata = 'null' where id = ?")
        .run("code-a");
      await withStore(d1, (store) =>
        store.revoke({
          id: CredentialId("code-a"),
          reason: "rotated",
          revokedAt: UnixMillis(200),
        })
      );

      expect(
        database
          .prepare("select metadata from auth_recovery_code where id = ?")
          .get("code-a")
      ).toMatchObject({
        metadata: JSON.stringify({ revokeReason: "rotated" }),
      });
    } finally {
      database.close();
    }
  });

  it("maps persisted codec failures to the requested typed operation", async () => {
    const database = new DatabaseSync(":memory:");
    await applyControlPlaneMigrations(database);
    const d1 = makeTestD1Database(database);

    try {
      await withStore(d1, (store) => store.insertMany([code("a", 100)]));
      database
        .prepare("update auth_recovery_code set metadata = 'null' where id = ?")
        .run("code-a");

      const error = await Effect.runPromise(
        RecoveryCodeStore.pipe(
          Effect.flatMap((store) => store.findById(CredentialId("code-a"))),
          Effect.flip,
          Effect.provide(makeStoreLive(d1))
        )
      );
      expect(error).toBeInstanceOf(RecoveryCodeStoreError);
      expect(error).toMatchObject({ operation: "find" });
    } finally {
      database.close();
    }
  });
});
