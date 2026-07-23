import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type {
  MailboxDomainError,
  MailboxRepositoryError,
} from "#/mailboxes/errors";
import type {
  CancelOutboundDeliveryInput,
  OutboundDeliveryResult,
  ScheduleOutboundInput,
  ScheduleOutboundResult,
} from "#/mailboxes/outbound";

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
