import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

export interface MailboxAlarmStorageService {
  readonly delete: Effect.Effect<void>;
  readonly get: Effect.Effect<number | null>;
  readonly set: (scheduledAt: number) => Effect.Effect<void>;
}

export class MailboxAlarmStorage extends Context.Service<
  MailboxAlarmStorage,
  MailboxAlarmStorageService
>()("cloudflare-inbox/MailboxAlarmStorage") {}
