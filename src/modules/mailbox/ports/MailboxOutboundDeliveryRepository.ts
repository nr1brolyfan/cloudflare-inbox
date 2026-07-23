import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type {
  MailboxDomainError,
  MailboxRepositoryError,
} from "#/mailboxes/errors";
import type {
  GetOutboundDeliveryInput,
  OutboundDeliveryResult,
} from "#/mailboxes/outbound";

export interface MailboxOutboundDeliveryRepositoryService {
  readonly getOutboundDelivery: (
    input: GetOutboundDeliveryInput
  ) => Effect.Effect<
    OutboundDeliveryResult,
    MailboxDomainError | MailboxRepositoryError
  >;
}

export class MailboxOutboundDeliveryRepository extends Context.Service<
  MailboxOutboundDeliveryRepository,
  MailboxOutboundDeliveryRepositoryService
>()("cloudflare-inbox/MailboxOutboundDeliveryRepository") {}
