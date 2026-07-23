import * as Data from "effect/Data";

import type {
  AsyncRuleJobId,
  InboundIngestId,
  OutboundDeliveryId,
} from "#/modules/mailbox/domain/Mailbox";
import type { OperationId } from "#/shared/Operation";

export class WorkflowStartError extends Data.TaggedError("WorkflowStartError")<{
  readonly workflow: "async-rules" | "inbound" | "outbound";
  readonly instanceId:
    | AsyncRuleJobId
    | InboundIngestId
    | OperationId
    | OutboundDeliveryId;
  readonly message: string;
  readonly cause: unknown;
}> {}
