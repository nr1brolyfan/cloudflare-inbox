import * as Layer from "effect/Layer";

import { MailboxOutboundDeliveryReadingClock } from "#/modules/mailbox/ports/MailboxOutboundDeliveryReadingClock";

export const MailboxOutboundDeliveryReadingClockSystemLayer = Layer.succeed(
  MailboxOutboundDeliveryReadingClock,
  MailboxOutboundDeliveryReadingClock.of({ now: Date.now })
);
