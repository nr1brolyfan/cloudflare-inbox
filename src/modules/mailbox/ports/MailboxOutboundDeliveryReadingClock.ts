import * as Context from "effect/Context";

export interface MailboxOutboundDeliveryReadingClockService {
  readonly now: () => number;
}

/** Explicit clock used to produce the client-visible observation time. */
export class MailboxOutboundDeliveryReadingClock extends Context.Service<
  MailboxOutboundDeliveryReadingClock,
  MailboxOutboundDeliveryReadingClockService
>()("cloudflare-inbox/MailboxOutboundDeliveryReadingClock") {}
