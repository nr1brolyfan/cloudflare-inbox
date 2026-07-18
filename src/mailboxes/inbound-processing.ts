import * as Schema from "effect/Schema";

import { InboundIngestId, MailboxId, MessageId } from "./identifiers";
import { InboundProcessingFailure } from "./inbound-processing-failure";
import { InboundProcessingStatus } from "./inbound-processing-status";
import { AttemptCount, UnixMillis, Version } from "./primitives";

export class InboundProcessing extends Schema.Class<InboundProcessing>(
  "cloudflare-inbox/InboundProcessing"
)({
  id: InboundIngestId,
  mailboxId: MailboxId,
  status: InboundProcessingStatus,
  messageId: Schema.optional(MessageId),
  failure: Schema.optional(InboundProcessingFailure),
  attemptCount: AttemptCount,
  createdAt: UnixMillis,
  updatedAt: UnixMillis,
  version: Version,
}) {}

export const InboundProcessingSchema = InboundProcessing.check(
  Schema.makeFilter((processing) => {
    if (processing.updatedAt < processing.createdAt) {
      return "updatedAt cannot be earlier than createdAt";
    }
    if (
      (processing.status === "ready") !==
      (processing.messageId !== undefined)
    ) {
      return "messageId must be present exactly when inbound processing is ready";
    }
    if (
      processing.failure !== undefined &&
      (processing.failure.failedAt < processing.createdAt ||
        processing.failure.failedAt > processing.updatedAt)
    ) {
      return "failedAt must fall within the inbound processing timeline";
    }
    return (processing.status === "failed") ===
      (processing.failure !== undefined)
      ? undefined
      : "failure must be present exactly when inbound processing has failed";
  })
);
