import * as Schema from "effect/Schema";

import {
  DraftId,
  MailboxId,
  OperationId,
  OutboundDeliveryId,
} from "./identifiers";
import { OutboundDeliverySchema } from "./outbound-delivery";
import { UnixMillis, Version } from "./primitives";

export const ScheduleOutboundInput = Schema.Struct({
  mailboxId: MailboxId,
  draftId: DraftId,
  expectedVersion: Version,
  operationId: OperationId,
  sendAt: UnixMillis,
});
export type ScheduleOutboundInput = Schema.Schema.Type<
  typeof ScheduleOutboundInput
>;

export const ScheduleOutboundResult = Schema.Struct({
  delivery: OutboundDeliverySchema,
  serverNow: UnixMillis,
});
export type ScheduleOutboundResult = Schema.Schema.Type<
  typeof ScheduleOutboundResult
>;

export const GetOutboundDeliveryInput = Schema.Struct({
  mailboxId: MailboxId,
  outboundDeliveryId: OutboundDeliveryId,
});
export type GetOutboundDeliveryInput = Schema.Schema.Type<
  typeof GetOutboundDeliveryInput
>;

export const CancelOutboundDeliveryInput = Schema.Struct({
  mailboxId: MailboxId,
  outboundDeliveryId: OutboundDeliveryId,
  expectedVersion: Version,
});
export type CancelOutboundDeliveryInput = Schema.Schema.Type<
  typeof CancelOutboundDeliveryInput
>;

export const ResendOutboundInput = Schema.Struct({
  mailboxId: MailboxId,
  outboundDeliveryId: OutboundDeliveryId,
  expectedVersion: Version,
  operationId: OperationId,
  acknowledgeDuplicateRisk: Schema.Literal(true),
});
export type ResendOutboundInput = Schema.Schema.Type<
  typeof ResendOutboundInput
>;

/** Resend creates a new delivery whose resendOf points at the source. */
export const ResendOutboundResult = Schema.Struct({
  sourceDeliveryId: OutboundDeliveryId,
  delivery: OutboundDeliverySchema,
}).check(
  Schema.makeFilter((result) =>
    result.delivery.resendOf === result.sourceDeliveryId
      ? undefined
      : "resend delivery must point at the source delivery"
  )
);
export type ResendOutboundResult = Schema.Schema.Type<
  typeof ResendOutboundResult
>;

export const OutboundDeliveryResult = OutboundDeliverySchema;
export type OutboundDeliveryResult = Schema.Schema.Type<
  typeof OutboundDeliveryResult
>;
