import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { MailboxAlarmStorage } from "#/modules/mailbox/ports/MailboxAlarmStorage";

export const MailboxAlarmStorageDoLayer = Layer.effect(
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
