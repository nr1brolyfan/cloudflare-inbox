import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type { MailboxDomainError } from "#/modules/mailbox/domain/MailboxError";
import type {
  CancelOutboundDeliveryInput,
  OutboundDeliveryResult,
  ScheduleOutboundInput,
  ScheduleOutboundResult,
} from "#/modules/mailbox/domain/MailboxOutbound";
import type { MailboxRepositoryError } from "#/modules/mailbox/ports/MailboxRepositoryError";

type RepositoryError = MailboxDomainError | MailboxRepositoryError;

export interface MailboxOutboundSendingRepositoryService {
  readonly cancelOutboundDelivery: (
    input: CancelOutboundDeliveryInput
  ) => Effect.Effect<OutboundDeliveryResult, RepositoryError>;
  readonly scheduleOutbound: (
    input: ScheduleOutboundInput
  ) => Effect.Effect<ScheduleOutboundResult, RepositoryError>;
}

export class MailboxOutboundSendingRepository extends Context.Service<
  MailboxOutboundSendingRepository,
  MailboxOutboundSendingRepositoryService
>()("cloudflare-inbox/MailboxOutboundSendingRepository") {}
