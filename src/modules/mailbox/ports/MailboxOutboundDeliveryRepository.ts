import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type { MailboxDomainError } from "#/modules/mailbox/domain/MailboxError";
import type {
  GetOutboundDeliveryInput,
  OutboundDeliveryResult,
} from "#/modules/mailbox/domain/MailboxOutbound";
import type { MailboxRepositoryError } from "#/modules/mailbox/ports/MailboxRepositoryError";

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
