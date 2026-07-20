import * as Cloudflare from "alchemy/Cloudflare";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { outboundSendingStaleTimeoutMillis } from "./outbound-lifecycle-store-sqlite-live";
import { outboundDelivery } from "./sqlite-schema";
import { MailboxDatabase, MailboxRuntime } from "./sqlite-services";

export const outboundAlarmRetryMillis = 30_000;

export interface MailboxAlarmStorage {
  readonly delete: Effect.Effect<void>;
  readonly get: Effect.Effect<number | null>;
  readonly set: (scheduledAt: number) => Effect.Effect<void>;
}

export const MailboxAlarmStorage = Context.Service<MailboxAlarmStorage>(
  "cloudflare-inbox/MailboxAlarmStorage"
);

export const MailboxAlarmStorageLive = Layer.effect(
  MailboxAlarmStorage,
  Effect.gen(function* () {
    const state = yield* Cloudflare.DurableObjectState;
    const { storage } = state.raw;
    return MailboxAlarmStorage.of({
      delete: Effect.promise(() => storage.deleteAlarm()),
      get: Effect.promise(() => storage.getAlarm()),
      set: (scheduledAt) => Effect.promise(() => storage.setAlarm(scheduledAt)),
    });
  })
);

export interface MailboxOutboundAlarmScheduler {
  readonly nextScheduledAt: Effect.Effect<number | null>;
  readonly reconcile: Effect.Effect<void>;
}

export const MailboxOutboundAlarmScheduler =
  Context.Service<MailboxOutboundAlarmScheduler>(
    "cloudflare-inbox/MailboxOutboundAlarmScheduler"
  );

export const MailboxOutboundAlarmSchedulerLive = Layer.effect(
  MailboxOutboundAlarmScheduler,
  Effect.gen(function* () {
    const db = yield* MailboxDatabase;
    const runtime = yield* MailboxRuntime;
    const alarmStorage = yield* MailboxAlarmStorage;
    const nextScheduledAt = Effect.all([
      db
        .select({ scheduledAt: outboundDelivery.sendAt })
        .from(outboundDelivery)
        .where(
          and(
            eq(outboundDelivery.status, "scheduled"),
            isNull(outboundDelivery.deletedAt)
          )
        )
        .orderBy(asc(outboundDelivery.sendAt), asc(outboundDelivery.id))
        .limit(1),
      db
        .select({
          scheduledAt: sql<number>`${outboundDelivery.updatedAt} + ${outboundSendingStaleTimeoutMillis}`,
        })
        .from(outboundDelivery)
        .where(
          and(
            eq(outboundDelivery.status, "sending"),
            isNull(outboundDelivery.deletedAt)
          )
        )
        .orderBy(asc(outboundDelivery.updatedAt), asc(outboundDelivery.id))
        .limit(1),
    ]).pipe(
      Effect.map(([scheduled, sending]) => {
        const candidates = [
          scheduled[0]?.scheduledAt,
          sending[0]?.scheduledAt,
        ].filter((value): value is number => value !== undefined);
        return candidates.length === 0 ? null : Math.min(...candidates);
      }),
      Effect.orDie
    );

    return MailboxOutboundAlarmScheduler.of({
      nextScheduledAt,
      reconcile: Effect.gen(function* () {
        const next = yield* nextScheduledAt;
        const current = yield* alarmStorage.get;
        if (next === null) {
          if (current !== null) {
            yield* alarmStorage.delete;
          }
          return;
        }
        const now = runtime.now();
        const retryAt = now + outboundAlarmRetryMillis;
        // Preserve an earlier pending retry so unrelated RPC traffic cannot starve due work.
        const target =
          next <= now && current !== null && current > now
            ? Math.min(current, retryAt)
            : next <= now
              ? retryAt
              : next;
        if (current !== target) {
          yield* alarmStorage.set(target);
        }
      }),
    });
  })
);
