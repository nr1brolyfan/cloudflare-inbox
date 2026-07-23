import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { MailboxAlarmStorage } from "#/modules/mailbox/ports/MailboxAlarmStorage";
import { MailboxOutboundAlarmClock } from "#/modules/mailbox/ports/MailboxOutboundAlarmClock";
import { MailboxOutboundLifecycleStore } from "#/modules/mailbox/ports/MailboxOutboundLifecycleStore";

export const outboundAlarmRetryMillis = 30_000;

export interface MailboxOutboundAlarmSchedulerService {
  readonly nextScheduledAt: Effect.Effect<number | null>;
  readonly reconcile: Effect.Effect<void>;
}

export class MailboxOutboundAlarmScheduler extends Context.Service<
  MailboxOutboundAlarmScheduler,
  MailboxOutboundAlarmSchedulerService
>()("cloudflare-inbox/MailboxOutboundAlarmScheduler", {
  make: Effect.gen(function* () {
    const lifecycle = yield* MailboxOutboundLifecycleStore;
    const clock = yield* MailboxOutboundAlarmClock;
    const alarmStorage = yield* MailboxAlarmStorage;
    const { nextScheduledAt } = lifecycle;

    return {
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
        const now = clock.now();
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
    } satisfies MailboxOutboundAlarmSchedulerService;
  }),
}) {
  static readonly layerNoDeps = Layer.effect(this, this.make);
}
