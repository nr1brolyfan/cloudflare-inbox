import * as Context from "effect/Context";

export interface MailboxOutboundAlarmClockService {
  readonly now: () => number;
}

export class MailboxOutboundAlarmClock extends Context.Service<
  MailboxOutboundAlarmClock,
  MailboxOutboundAlarmClockService
>()("cloudflare-inbox/MailboxOutboundAlarmClock") {}
