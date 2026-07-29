import { DatabaseSync } from "node:sqlite";

import type { D1EffectQbDatabaseLike } from "@effect-auth/core/EffectQbSqliteStorage";
import {
  CredentialId,
  UnixMillis,
  UserId,
} from "@effect-auth/core/Identifiers";
import {
  PasskeyCredentialId,
  PasskeyCredentialStore,
  PasskeyCredentialStoreError,
} from "@effect-auth/core/Passkey";
import type { PasskeyCredentialRecord } from "@effect-auth/core/Passkey";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { describe, expect, it } from "vitest";

import { PasskeyCredentialStoreD1Layer } from "#/modules/account-security/adapters/d1/PasskeyCredentialStoreD1";
import { ControlPlaneD1Layer } from "#/platform/control-plane-d1/ControlPlaneBatch";
import { ControlPlaneD1Binding } from "#/platform/control-plane-d1/ControlPlaneDatabase";

import {
  applyControlPlaneMigrations,
  makeTestD1Database,
} from "../../../../support/d1";

const userId = UserId("user-a");

const credential = (
  suffix: string,
  createdAt: number,
  overrides: Partial<PasskeyCredentialRecord> = {}
): PasskeyCredentialRecord => ({
  backedUp: false,
  createdAt: UnixMillis(createdAt),
  credentialId: PasskeyCredentialId(`credential-${suffix}`),
  id: CredentialId(`record-${suffix}`),
  metadata: { device: suffix },
  name: `Key ${suffix}`,
  publicKey: `public-key-${suffix}`,
  signCount: 0,
  transports: ["internal", "usb"],
  userId,
  ...overrides,
});

const makeStoreLive = (d1: D1EffectQbDatabaseLike) => {
  const controlPlane = ControlPlaneD1Layer.pipe(
    Layer.provide(
      Layer.succeed(
        ControlPlaneD1Binding,
        ControlPlaneD1Binding.of({ database: d1 as unknown as D1Database })
      )
    )
  );
  return PasskeyCredentialStoreD1Layer.pipe(Layer.provide(controlPlane));
};

const withStore = <A, E>(
  d1: D1EffectQbDatabaseLike,
  use: (store: PasskeyCredentialStore["Service"]) => Effect.Effect<A, E>
) =>
  Effect.runPromise(
    PasskeyCredentialStore.pipe(
      Effect.flatMap(use),
      Effect.provide(makeStoreLive(d1))
    )
  );

describe("native D1 passkey credential store", () => {
  it("round-trips codecs and lists deterministically with revoked filtering", async () => {
    const database = new DatabaseSync(":memory:");
    await applyControlPlaneMigrations(database);
    const d1 = makeTestD1Database(database);

    try {
      const rows = await withStore(d1, (store) =>
        Effect.gen(function* () {
          yield* store.insert(credential("b", 200));
          yield* store.insert(credential("c", 100));
          yield* store.insert(
            credential("a", 100, { revokedAt: UnixMillis(300) })
          );
          const active = yield* store.listByUser({ userId });
          const all = yield* store.listByUser({ includeRevoked: true, userId });
          const found = yield* store.findByCredentialId(
            PasskeyCredentialId("credential-b")
          );
          return { active, all, found };
        })
      );

      expect(rows.active.map(({ id }) => id)).toStrictEqual([
        "record-c",
        "record-b",
      ]);
      expect(rows.all.map(({ id }) => id)).toStrictEqual([
        "record-a",
        "record-c",
        "record-b",
      ]);
      expect(Option.getOrThrow(rows.found)).toMatchObject({
        backedUp: false,
        metadata: { device: "b" },
        transports: ["internal", "usb"],
      });
    } finally {
      database.close();
    }
  });

  it("performs limit enforcement as one conditional insert statement", async () => {
    const database = new DatabaseSync(":memory:");
    await applyControlPlaneMigrations(database);
    const base = makeTestD1Database(database);
    const prepared: string[] = [];
    const d1: D1EffectQbDatabaseLike = {
      batch: base.batch,
      prepare: (statement) => {
        prepared.push(statement);
        return base.prepare(statement);
      },
    };

    try {
      const result = await withStore(d1, (store) =>
        Effect.gen(function* () {
          const first = yield* store.insertWithinLimit({
            credential: credential("a", 100),
            maximumActiveCredentials: 1,
          });
          const second = yield* store.insertWithinLimit({
            credential: credential("b", 200),
            maximumActiveCredentials: 1,
          });
          return { first, second };
        })
      );

      expect(result).toStrictEqual({ first: true, second: false });
      const conditionalInserts = prepared.filter((statement) =>
        /^insert into ["`]auth_passkey_credential["`]/u.test(
          statement.toLowerCase()
        )
      );
      // The Effect D1 client prepares and caches the one parameterized statement.
      expect(conditionalInserts).toHaveLength(1);
      expect(
        conditionalInserts.every((statement) =>
          statement.toLowerCase().includes(" select ")
        )
      ).toBeTruthy();
      expect(
        prepared.every((statement) => !statement.startsWith("select count"))
      ).toBeTruthy();
    } finally {
      database.close();
    }
  });

  it("CAS-updates only the expected active sign count", async () => {
    const database = new DatabaseSync(":memory:");
    await applyControlPlaneMigrations(database);
    const d1 = makeTestD1Database(database);

    try {
      const result = await withStore(d1, (store) =>
        Effect.gen(function* () {
          yield* store.insert(credential("a", 100));
          const updated = yield* store.updateSignCount({
            backedUp: true,
            credentialId: PasskeyCredentialId("credential-a"),
            expectedSignCount: 0,
            lastUsedAt: UnixMillis(200),
            metadata: { ceremony: "authentication" },
            signCount: 1,
          });
          const stale = yield* store.updateSignCount({
            credentialId: PasskeyCredentialId("credential-a"),
            expectedSignCount: 0,
            lastUsedAt: UnixMillis(300),
            signCount: 2,
          });
          yield* store.revoke({
            credentialId: PasskeyCredentialId("credential-a"),
            reason: "lost",
            revokedAt: UnixMillis(300),
          });
          const revoked = yield* store.updateSignCount({
            credentialId: PasskeyCredentialId("credential-a"),
            expectedSignCount: 1,
            lastUsedAt: UnixMillis(400),
            signCount: 2,
          });
          return { revoked, stale, updated };
        })
      );

      expect(Option.getOrThrow(result.updated)).toMatchObject({
        backedUp: true,
        lastUsedAt: 200,
        metadata: { ceremony: "authentication" },
        signCount: 1,
      });
      expect(Option.isNone(result.stale)).toBeTruthy();
      expect(Option.isNone(result.revoked)).toBeTruthy();
      expect(
        database
          .prepare(
            "select metadata from auth_passkey_credential where credential_id = ?"
          )
          .get("credential-a")
      ).toMatchObject({
        metadata: JSON.stringify({
          ceremony: "authentication",
          revokeReason: "lost",
        }),
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
      await withStore(d1, (store) => store.insert(credential("a", 100)));
      database.exec("pragma ignore_check_constraints = on");
      database
        .prepare(
          "update auth_passkey_credential set metadata = '{' where credential_id = ?"
        )
        .run("credential-a");

      const error = await Effect.runPromise(
        PasskeyCredentialStore.pipe(
          Effect.flatMap((store) =>
            store.findByCredentialId(PasskeyCredentialId("credential-a"))
          ),
          Effect.flip,
          Effect.provide(makeStoreLive(d1))
        )
      );
      expect(error).toBeInstanceOf(PasskeyCredentialStoreError);
      expect(error).toMatchObject({ operation: "find" });
    } finally {
      database.close();
    }
  });
});
