/* oxlint-disable max-classes-per-file -- Inbound domain schemas are intentionally consolidated. */
import * as Data from "effect/Data";
import * as Schema from "effect/Schema";

import {
  AttemptCount,
  ByteSize,
  EmailAddress,
  InboundIngestId,
  MailboxId,
  MessageId,
  OperationId,
  UnixMillis,
  Version,
} from "./core";

export const InboundFailureCode = Schema.Literals([
  "malformed_message",
  "message_too_large",
  "unsupported_message",
  "processing_failed",
]);
export type InboundFailureCode = Schema.Schema.Type<typeof InboundFailureCode>;

export class InboundProcessingFailure extends Schema.Class<InboundProcessingFailure>(
  "cloudflare-inbox/InboundProcessingFailure"
)({
  code: InboundFailureCode,
  failedAt: UnixMillis,
  replayable: Schema.Boolean,
}) {}

/** Durable checkpoints exposed for progress and replay diagnostics. */
export const InboundProcessingStatus = Schema.Literals([
  "received",
  "raw_stored",
  "parsing",
  "attachments_stored",
  "ready",
  "failed",
]);
export type InboundProcessingStatus = Schema.Schema.Type<
  typeof InboundProcessingStatus
>;

export const isInboundTerminalStatus = (
  status: InboundProcessingStatus
): boolean => status === "ready" || status === "failed";

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

const transitions = {
  received: new Set<InboundProcessingStatus>(["raw_stored", "failed"]),
  raw_stored: new Set<InboundProcessingStatus>(["parsing", "failed"]),
  parsing: new Set<InboundProcessingStatus>(["attachments_stored", "failed"]),
  attachments_stored: new Set<InboundProcessingStatus>(["ready", "failed"]),
  ready: new Set<InboundProcessingStatus>(),
  failed: new Set<InboundProcessingStatus>(),
} as const satisfies Record<
  InboundProcessingStatus,
  ReadonlySet<InboundProcessingStatus>
>;

/** Same-state writes are accepted as idempotent retries. */
export const canTransitionInbound = (
  from: InboundProcessingStatus,
  to: InboundProcessingStatus
): boolean => from === to || transitions[from].has(to);

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

export const ReceiveInboundEmailInput = Schema.Struct({
  envelopeFrom: Schema.optional(EmailAddress),
  envelopeTo: EmailAddress,
  rawSize: ByteSize,
});
export type ReceiveInboundEmailInput = Schema.Schema.Type<
  typeof ReceiveInboundEmailInput
>;

export class InboundEmailRejected extends Data.TaggedError(
  "InboundEmailRejected"
)<{
  readonly reason:
    | "invalid-envelope"
    | "processing-unavailable"
    | "unknown-recipient";
  readonly message: string;
  readonly cause?: unknown;
}> {}
