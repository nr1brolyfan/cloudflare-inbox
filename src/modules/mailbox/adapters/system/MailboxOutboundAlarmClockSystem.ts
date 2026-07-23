import * as Layer from "effect/Layer";

import { MailboxOutboundAlarmClock } from "#/modules/mailbox/ports/MailboxOutboundAlarmClock";

export const MailboxOutboundAlarmClockSystemLayer = Layer.succeed(
  MailboxOutboundAlarmClock,
  MailboxOutboundAlarmClock.of({ now: Date.now })
);
