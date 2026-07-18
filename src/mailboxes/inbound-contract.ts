import * as Schema from "effect/Schema";

import { InboundIngestId, MailboxId, OperationId } from "./identifiers";
import { InboundProcessingSchema } from "./inbound-processing";

export const GetInboundProcessingInput = Schema.Struct({
  mailboxId: MailboxId,
  inboundIngestId: InboundIngestId,
});
export type GetInboundProcessingInput = Schema.Schema.Type<
  typeof GetInboundProcessingInput
>;

export const ReplayInboundInput = Schema.Struct({
  mailboxId: MailboxId,
  inboundIngestId: InboundIngestId,
  operationId: OperationId,
});
export type ReplayInboundInput = Schema.Schema.Type<typeof ReplayInboundInput>;

export const InboundProcessingResult = InboundProcessingSchema;
export type InboundProcessingResult = Schema.Schema.Type<
  typeof InboundProcessingResult
>;
