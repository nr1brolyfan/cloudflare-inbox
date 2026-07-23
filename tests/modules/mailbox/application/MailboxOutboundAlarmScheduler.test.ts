import { eq } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { describe, expect, it } from "vitest";

import { MailboxOutboundLifecycleStoreSqliteLayer } from "#/modules/mailbox/adapters/sqlite/MailboxOutboundLifecycleStoreSqlite";
import { MailboxDatabase } from "#/modules/mailbox/adapters/sqlite/MailboxSqliteDatabase";
import {
  folder,
  message,
  outboundDelivery,
} from "#/modules/mailbox/adapters/sqlite/MailboxSqliteSchema";
import {
  MailboxOutboundAlarmScheduler,
  outboundAlarmRetryMillis,
} from "#/modules/mailbox/application/MailboxOutboundAlarmScheduler";
import { MailboxAlarmStorage } from "#/modules/mailbox/ports/MailboxAlarmStorage";
import type { MailboxAlarmStorageService } from "#/modules/mailbox/ports/MailboxAlarmStorage";
import { MailboxOutboundAlarmClock } from "#/modules/mailbox/ports/MailboxOutboundAlarmClock";
import { outboundSendingStaleTimeoutMillis } from "#/modules/mailbox/ports/MailboxOutboundLifecycleStore";

import { MailboxDatabaseTestLive } from "../../../support/mailbox-sqlite";

const makeAlarmStorage = (initial: number | null = null) => {
  const operations: (`delete` | `set:${number}`)[] = [];
  let scheduledAt = initial;
  return {
    get scheduledAt() {
      return scheduledAt;
    },
    operations,
    service: MailboxAlarmStorage.of({
      delete: Effect.sync(() => {
        scheduledAt = null;
        operations.push("delete");
      }),
      get: Effect.sync(() => scheduledAt),
      set: (value) =>
        Effect.sync(() => {
          scheduledAt = value;
          operations.push(`set:${value}`);
        }),
    }),
  };
};

const makeSchedulerLive = (
  alarmStorage: MailboxAlarmStorageService,
  now: () => number
) =>
  MailboxOutboundAlarmScheduler.layerNoDeps.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(MailboxAlarmStorage, alarmStorage),
        Layer.succeed(
          MailboxOutboundAlarmClock,
          MailboxOutboundAlarmClock.of({ now })
        ),
        MailboxOutboundLifecycleStoreSqliteLayer.pipe(
          Layer.provide(
            Layer.succeed(
              MailboxOutboundAlarmClock,
              MailboxOutboundAlarmClock.of({ now })
            )
          )
        )
      )
    ),
    Layer.provideMerge(MailboxDatabaseTestLive)
  );

const seedDelivery = (
  id: string,
  sendAt: number,
  options: {
    readonly deletedAt?: number;
    readonly status?: "accepted" | "cancelled" | "scheduled" | "sending";
    readonly updatedAt?: number;
  } = {}
) =>
  Effect.gen(function* () {
    const db = yield* MailboxDatabase;
    const messageId = `message-${id}`;
    yield* db.insert(message).values({
      folderId: "sent",
      id: messageId,
    });
    yield* db.insert(outboundDelivery).values({
      createdAt: 0,
      deletedAt: options.deletedAt,
      id,
      messageId,
      sendAt,
      status: options.status ?? "scheduled",
      updatedAt: options.updatedAt ?? 0,
    });
  });

const setup = Effect.gen(function* () {
  const db = yield* MailboxDatabase;
  yield* db.insert(folder).values({
    createdAt: 0,
    id: "sent",
    kind: "sent",
    name: "Sent",
    updatedAt: 0,
  });
});

describe("Mailbox outbound alarm scheduler", () => {
  it("arms the earliest live scheduled delivery and follows cancellation", async () => {
    const alarm = makeAlarmStorage(9000);
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* setup;
        yield* seedDelivery("later", 5000);
        yield* seedDelivery("earlier", 4000);
        yield* seedDelivery("accepted", 1000, { status: "accepted" });
        yield* seedDelivery("deleted", 2000, { deletedAt: 2500 });
        const scheduler = yield* MailboxOutboundAlarmScheduler;

        expect(yield* scheduler.nextScheduledAt).toBe(4000);
        yield* scheduler.reconcile;
        yield* scheduler.reconcile;
        expect(alarm.scheduledAt).toBe(4000);
        expect(alarm.operations).toStrictEqual(["set:4000"]);

        const db = yield* MailboxDatabase;
        yield* db
          .update(outboundDelivery)
          .set({ cancelledAt: 1000, status: "cancelled", updatedAt: 1000 })
          .where(eq(outboundDelivery.id, "earlier"));
        yield* scheduler.reconcile;
        expect(alarm.scheduledAt).toBe(5000);

        yield* db
          .update(outboundDelivery)
          .set({ cancelledAt: 1000, status: "cancelled", updatedAt: 1000 })
          .where(eq(outboundDelivery.id, "later"));
        yield* scheduler.reconcile;
        expect({
          operations: alarm.operations,
          scheduledAt: alarm.scheduledAt,
        }).toStrictEqual({
          operations: ["set:4000", "set:5000", "delete"],
          scheduledAt: null,
        });
      }).pipe(Effect.provide(makeSchedulerLive(alarm.service, () => 1000)))
    );
  });

  it("retries overdue work without mutating or indefinitely postponing it", async () => {
    const alarm = makeAlarmStorage();
    let now = 6000;
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* setup;
        yield* seedDelivery("due", 5000);
        const scheduler = yield* MailboxOutboundAlarmScheduler;
        yield* scheduler.reconcile;
        expect(alarm.scheduledAt).toBe(now + outboundAlarmRetryMillis);

        now = 7000;
        yield* scheduler.reconcile;
        expect(alarm.scheduledAt).toBe(36_000);
        expect(alarm.operations).toStrictEqual(["set:36000"]);

        const db = yield* MailboxDatabase;
        const [delivery] = yield* db
          .select({
            attemptCount: outboundDelivery.attemptCount,
            status: outboundDelivery.status,
          })
          .from(outboundDelivery)
          .where(eq(outboundDelivery.id, "due"));
        expect(delivery).toStrictEqual({
          attemptCount: 0,
          status: "scheduled",
        });
      }).pipe(Effect.provide(makeSchedulerLive(alarm.service, () => now)))
    );
  });

  it("repairs a missing or stale alarm during activation reconciliation", async () => {
    const missing = makeAlarmStorage();
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* setup;
        yield* seedDelivery("future", 8000);
        const scheduler = yield* MailboxOutboundAlarmScheduler;
        yield* scheduler.reconcile;
        expect(missing.scheduledAt).toBe(8000);
      }).pipe(Effect.provide(makeSchedulerLive(missing.service, () => 1000)))
    );

    const stale = makeAlarmStorage(8000);
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* setup;
        const scheduler = yield* MailboxOutboundAlarmScheduler;
        yield* scheduler.reconcile;
        expect(stale.scheduledAt).toBeNull();
      }).pipe(Effect.provide(makeSchedulerLive(stale.service, () => 1000)))
    );
  }, 15_000);

  it("arms recovery for a fresh sending claim without stealing it", async () => {
    const alarm = makeAlarmStorage();
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* setup;
        yield* seedDelivery("sending", 1000, {
          status: "sending",
          updatedAt: 1200,
        });
        const scheduler = yield* MailboxOutboundAlarmScheduler;
        expect(yield* scheduler.nextScheduledAt).toBe(
          1200 + outboundSendingStaleTimeoutMillis
        );
        yield* scheduler.reconcile;
        expect(alarm.scheduledAt).toBe(
          1200 + outboundSendingStaleTimeoutMillis
        );
      }).pipe(Effect.provide(makeSchedulerLive(alarm.service, () => 2000)))
    );
  });
});
