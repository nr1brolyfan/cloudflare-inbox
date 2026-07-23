import { DatabaseSync } from "node:sqlite";

import { DevEmailStore, DevEmailStoreError } from "@effect-auth/core/DevEmail";
import type { D1EffectQbDatabaseLike } from "@effect-auth/core/EffectQbSqliteStorage";
import { Email, UnixMillis } from "@effect-auth/core/Identifiers";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { describe, expect, it } from "vitest";

import { DevEmailStoreD1Layer } from "#/modules/account-security/adapters/d1/AccountSecurityStorageD1";
import { ControlPlaneD1Layer } from "#/platform/control-plane-d1/ControlPlaneBatch";
import { ControlPlaneD1Binding } from "#/platform/control-plane-d1/ControlPlaneDatabase";

import {
  applyControlPlaneMigrations,
  makeTestD1Database,
} from "../../../../support/d1";

const makeStoreLive = (
  database: DatabaseSync,
  d1: D1EffectQbDatabaseLike = makeTestD1Database(database)
) => {
  const controlPlaneLive = ControlPlaneD1Layer.pipe(
    Layer.provide(
      Layer.succeed(
        ControlPlaneD1Binding,
        ControlPlaneD1Binding.of({
          database: d1 as unknown as D1Database,
        })
      )
    )
  );

  return DevEmailStoreD1Layer.pipe(Layer.provide(controlPlaneLive));
};

const message = {
  createdAt: UnixMillis(1000),
  expiresAt: UnixMillis(2000),
  id: "message-a",
  kind: "MagicLink",
  recipient: Email("person@example.test"),
  subject: "Sign in",
  text: "Open the link",
} as const;

describe("D1 development email store", () => {
  it("atomically upserts, filters, trims, and clears messages", async () => {
    const database = new DatabaseSync(":memory:");
    await applyControlPlaneMigrations(database);
    const storeLive = makeStoreLive(database);

    try {
      const filtered = await Effect.runPromise(
        Effect.gen(function* () {
          const store = yield* DevEmailStore;
          yield* store.save(message);
          yield* store.save({ ...message, subject: "Updated sign in" });
          const upserted = yield* store.list({
            limit: 100,
            recipient: message.recipient,
          });
          // oxlint-disable-next-line unicorn/no-array-for-each -- Effect.forEach is not Array#forEach.
          yield* Effect.forEach(
            Array.from({ length: 100 }, (_, index) => index),
            (index) =>
              store.save({
                ...message,
                createdAt: UnixMillis(1001 + index),
                id: `other-${index}`,
                recipient: Email("other@example.test"),
              }),
            { concurrency: 1 }
          );
          return upserted;
        }).pipe(Effect.provide(storeLive))
      );

      expect(filtered).toMatchObject([{ subject: "Updated sign in" }]);
      expect(
        database
          .prepare("select count(*) as count from app_dev_email_message")
          .get()
      ).toMatchObject({ count: 100 });
      expect(
        database
          .prepare(
            "select count(*) as count from app_dev_email_message where id = ?"
          )
          .get(message.id)
      ).toMatchObject({ count: 0 });

      const cleared = await Effect.runPromise(
        DevEmailStore.pipe(
          Effect.flatMap((store) => store.clear()),
          Effect.andThen(DevEmailStore),
          Effect.flatMap((store) => store.list()),
          Effect.provide(storeLive)
        )
      );
      expect(cleared).toStrictEqual([]);
    } finally {
      database.close();
    }
  });

  it("rejects corrupt persisted message JSON with a typed list error", async () => {
    const database = new DatabaseSync(":memory:");
    await applyControlPlaneMigrations(database);
    database
      .prepare(
        `insert into app_dev_email_message
          (id, kind, recipient, message_json, created_at, expires_at)
         values (?, ?, ?, ?, ?, ?)`
      )
      .run("corrupt", "MagicLink", "person@example.test", "{", 1000, 2000);

    try {
      const error = await Effect.runPromise(
        DevEmailStore.pipe(
          Effect.flatMap((store) => store.list()),
          Effect.flip,
          Effect.provide(makeStoreLive(database))
        )
      );

      expect(error).toBeInstanceOf(DevEmailStoreError);
      expect(error).toMatchObject({ operation: "list" });
    } finally {
      database.close();
    }
  });

  it("maps database failures to the requested store operation", async () => {
    const database = new DatabaseSync(":memory:");
    await applyControlPlaneMigrations(database);
    database.exec("drop table app_dev_email_message");

    try {
      const error = await Effect.runPromise(
        DevEmailStore.pipe(
          Effect.flatMap((store) => store.list()),
          Effect.flip,
          Effect.provide(makeStoreLive(database))
        )
      );

      expect(error).toBeInstanceOf(DevEmailStoreError);
      expect(error).toMatchObject({ operation: "list" });
    } finally {
      database.close();
    }
  });

  it("maps a D1 success false result without an error to a typed save failure", async () => {
    const database = new DatabaseSync(":memory:");
    await applyControlPlaneMigrations(database);
    const baseD1 = makeTestD1Database(database);
    const failedD1: D1EffectQbDatabaseLike = {
      batch: () => Promise.resolve([{ success: false }]),
      prepare: baseD1.prepare,
    };

    try {
      const error = await Effect.runPromise(
        DevEmailStore.pipe(
          Effect.flatMap((store) => store.save(message)),
          Effect.flip,
          Effect.provide(makeStoreLive(database, failedD1))
        )
      );

      expect(error).toBeInstanceOf(DevEmailStoreError);
      expect(error).toMatchObject({
        cause: {
          _tag: "ControlPlaneBatchError",
          commitState: "not-committed",
          statement: 0,
        },
        operation: "save",
      });
    } finally {
      database.close();
    }
  });
});
