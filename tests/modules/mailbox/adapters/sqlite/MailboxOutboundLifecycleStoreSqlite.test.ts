import { and, eq } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import { MailboxOutboundLifecycleStoreSqliteLayer } from "#/modules/mailbox/adapters/sqlite/MailboxOutboundLifecycleStoreSqlite";
import { MailboxDatabase } from "#/modules/mailbox/adapters/sqlite/MailboxSqliteDatabase";
import {
  folder,
  message,
  outboundDelivery,
} from "#/modules/mailbox/adapters/sqlite/MailboxSqliteSchema";
import { OutboundProviderMessageId } from "#/modules/mailbox/domain/MailboxOutbound";
import { MailboxOutboundAlarmClock } from "#/modules/mailbox/ports/MailboxOutboundAlarmClock";
import {
  MailboxOutboundLifecycleStore,
  OutboundDeliveryClaim,
  outboundRetryDelayMillis,
  outboundRetryMaxDelayMillis,
  outboundSendingStaleTimeoutMillis,
} from "#/modules/mailbox/ports/MailboxOutboundLifecycleStore";

import { MailboxDatabaseTestLayer } from "../../../../support/mailbox-sqlite";

const runtime = (now: () => number) =>
  Layer.succeed(
    MailboxOutboundAlarmClock,
    MailboxOutboundAlarmClock.of({ now })
  );

const providerMessageId = (value: string) =>
  Schema.decodeUnknownSync(OutboundProviderMessageId)(value);

const lifecycleLive = (now: () => number) =>
  MailboxOutboundLifecycleStoreSqliteLayer.pipe(
    Layer.provide(runtime(now)),
    Layer.provideMerge(MailboxDatabaseTestLayer)
  );

const setup = Effect.gen(function* () {
  const db = yield* MailboxDatabase;
  yield* db.insert(folder).values([
    {
      createdAt: 0,
      id: "scheduled",
      kind: "scheduled",
      name: "Scheduled",
      updatedAt: 0,
    },
    {
      createdAt: 0,
      id: "sent",
      kind: "sent",
      name: "Sent",
      updatedAt: 0,
    },
  ]);
});

const seedDelivery = (id: string, sendAt: number, version = 1) =>
  Effect.gen(function* () {
    const db = yield* MailboxDatabase;
    const messageId = `message-${id}`;
    yield* db.insert(message).values({
      folderId: "scheduled",
      id: messageId,
      outboundDeliveryId: id,
      scheduledAt: sendAt,
    });
    yield* db.insert(outboundDelivery).values({
      createdAt: 0,
      id,
      messageId,
      sendAt,
      status: "scheduled",
      updatedAt: 0,
      version,
    });
  });

describe("outbound lifecycle SQLite store", () => {
  it("claims the earliest due live delivery deterministically", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* setup;
        yield* seedDelivery("b", 1000);
        yield* seedDelivery("a", 1000);
        yield* seedDelivery("earlier", 999);
        yield* seedDelivery("future", 1001);
        const db = yield* MailboxDatabase;
        yield* db
          .update(outboundDelivery)
          .set({ deletedAt: 1000 })
          .where(eq(outboundDelivery.id, "earlier"));

        const store = yield* MailboxOutboundLifecycleStore;
        const claim = yield* store.claimDue;
        expect(claim).toMatchObject({
          attemptCount: 1,
          claimedAt: 1000,
          outboundDeliveryId: "a",
          version: 2,
        });

        const [row] = yield* db
          .select()
          .from(outboundDelivery)
          .where(eq(outboundDelivery.id, "a"));
        expect(row).toMatchObject({
          attemptCount: 1,
          status: "sending",
          updatedAt: 1000,
          version: 2,
        });
      }).pipe(Effect.provide(lifecycleLive(() => 1000)))
    );
  });

  it("settles only the exact claimed version and attempt", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* setup;
        yield* seedDelivery("delivery-1", 1000);
        const store = yield* MailboxOutboundLifecycleStore;
        const claim = yield* store.claimDue;
        if (claim === null) {
          return yield* Effect.die(new Error("Expected a delivery claim"));
        }
        const stale = Schema.decodeUnknownSync(OutboundDeliveryClaim)({
          ...claim,
          attemptCount: claim.attemptCount + 1,
        });

        expect(
          yield* store.settle(stale, {
            _tag: "Accepted",
            providerMessageId: providerMessageId("provider-stale"),
          })
        ).toBeFalsy();
        expect(
          yield* store.settle(claim, {
            _tag: "Accepted",
            providerMessageId: providerMessageId("provider-1"),
          })
        ).toBeTruthy();
        expect(
          yield* store.settle(claim, {
            _tag: "Failed",
            code: "provider_rejected",
          })
        ).toBeFalsy();

        const db = yield* MailboxDatabase;
        const [row] = yield* db
          .select()
          .from(outboundDelivery)
          .where(eq(outboundDelivery.id, "delivery-1"));
        expect(row).toMatchObject({
          acceptedAt: 1000,
          attemptCount: 1,
          providerMessageId: "provider-1",
          status: "accepted",
          version: 3,
        });
        const [settledMessage] = yield* db
          .select()
          .from(message)
          .where(eq(message.id, "message-delivery-1"));
        expect(settledMessage).toMatchObject({
          acceptedAt: 1000,
          folderId: "sent",
          scheduledAt: 1000,
          updatedAt: 1000,
          version: 2,
        });
      }).pipe(Effect.provide(lifecycleLive(() => 1000)))
    );
  });

  it("gives cancellation and a due claim exactly one winner", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* setup;
        yield* seedDelivery("delivery-1", 1000);
        const db = yield* MailboxDatabase;
        const store = yield* MailboxOutboundLifecycleStore;
        const [claim, cancelled] = yield* Effect.all(
          [
            store.claimDue,
            db
              .update(outboundDelivery)
              .set({
                cancelledAt: 1000,
                status: "cancelled",
                updatedAt: 1000,
                version: 2,
              })
              .where(
                and(
                  eq(outboundDelivery.id, "delivery-1"),
                  eq(outboundDelivery.status, "scheduled"),
                  eq(outboundDelivery.version, 1)
                )
              )
              .returning({ id: outboundDelivery.id }),
          ],
          { concurrency: "unbounded" }
        );

        expect(Number(claim !== null) + Number(cancelled.length === 1)).toBe(1);
        const [row] = yield* db
          .select({ status: outboundDelivery.status })
          .from(outboundDelivery)
          .where(eq(outboundDelivery.id, "delivery-1"));
        expect(["sending", "cancelled"]).toContain(row?.status);
      }).pipe(Effect.provide(lifecycleLive(() => 1000)))
    );
  });

  it("caps deterministic exponential retry delay", () => {
    expect([
      outboundRetryDelayMillis(1),
      outboundRetryDelayMillis(2),
      outboundRetryDelayMillis(3),
      outboundRetryDelayMillis(100),
    ]).toStrictEqual([30_000, 60_000, 120_000, outboundRetryMaxDelayMillis]);
  });

  it("recovers only stale exact sending claims and is idempotent", async () => {
    let now = 1000 + outboundSendingStaleTimeoutMillis - 1;
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* setup;
        yield* seedDelivery("delivery-1", 1000);
        const db = yield* MailboxDatabase;
        yield* db
          .update(outboundDelivery)
          .set({
            attemptCount: 1,
            status: "sending",
            updatedAt: 1000,
            version: 2,
          })
          .where(eq(outboundDelivery.id, "delivery-1"));
        const store = yield* MailboxOutboundLifecycleStore;

        expect(yield* store.recoverStaleSending).toBe(0);
        now += 1;
        expect(yield* store.recoverStaleSending).toBe(1);
        expect(yield* store.recoverStaleSending).toBe(0);
        const [row] = yield* db
          .select()
          .from(outboundDelivery)
          .where(eq(outboundDelivery.id, "delivery-1"));
        expect(row).toMatchObject({
          attemptCount: 1,
          failureAt: null,
          failureCode: null,
          providerMessageId: null,
          status: "indeterminate",
          updatedAt: now,
          version: 3,
        });
      }).pipe(Effect.provide(lifecycleLive(() => now)))
    );
  });

  it("does not let a stale retry guard corrupt a concurrent cancellation", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* setup;
        yield* seedDelivery("delivery-1", 1000);
        const db = yield* MailboxDatabase;
        const store = yield* MailboxOutboundLifecycleStore;
        const claim = yield* store.claimDue;
        if (claim === null) {
          return yield* Effect.die(new Error("Expected a delivery claim"));
        }

        const [retried, cancelled] = yield* Effect.all(
          [
            store.retry(claim),
            db
              .update(outboundDelivery)
              .set({
                cancelledAt: 1000,
                status: "cancelled",
                updatedAt: 1000,
                version: claim.version + 1,
              })
              .where(
                and(
                  eq(outboundDelivery.id, "delivery-1"),
                  eq(outboundDelivery.status, "scheduled"),
                  eq(outboundDelivery.version, claim.version)
                )
              )
              .returning({ id: outboundDelivery.id }),
          ],
          { concurrency: "unbounded" }
        );

        expect(retried).toBeTruthy();
        expect(cancelled).toHaveLength(0);
        const [row] = yield* db
          .select()
          .from(outboundDelivery)
          .where(eq(outboundDelivery.id, "delivery-1"));
        expect(row).toMatchObject({
          cancelledAt: null,
          sendAt: 1000 + outboundRetryDelayMillis(1),
          status: "scheduled",
          version: claim.version + 1,
        });
      }).pipe(Effect.provide(lifecycleLive(() => 1000)))
    );
  });
});
