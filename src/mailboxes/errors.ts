/* oxlint-disable max-classes-per-file -- Mailbox errors are intentionally consolidated. */
import * as Data from "effect/Data";

import type {
  AsyncRuleJobId,
  InboundIngestId,
  OperationId,
  OutboundDeliveryId,
  RuleId,
  UnixMillis,
  Version,
} from "./core";

export class BlobStoreError extends Data.TaggedError("BlobStoreError")<{
  readonly operation: "read" | "write" | "head" | "delete";
  readonly objectType: "raw-message" | "body" | "attachment";
  readonly message: string;
  readonly cause: unknown;
  readonly retryable: boolean;
}> {}

export class DeliveryIndeterminateError extends Data.TaggedError(
  "DeliveryIndeterminateError"
)<{
  readonly message: string;
  readonly cause: unknown;
}> {}

export class DeliveryRejectedError extends Data.TaggedError(
  "DeliveryRejectedError"
)<{
  readonly reason:
    | "invalid-message"
    | "message-too-large"
    | "invalid-sender"
    | "recipient-suppressed"
    | "provider-rejected";
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class DeliveryTemporaryFailureError extends Data.TaggedError(
  "DeliveryTemporaryFailureError"
)<{
  readonly message: string;
  readonly retryAt?: UnixMillis;
  readonly cause: unknown;
}> {}

export class MailboxDomainError extends Data.TaggedError("MailboxDomainError")<{
  readonly operation:
    | "create-address"
    | "set-address-enabled"
    | "set-primary-address"
    | "create-folder"
    | "list-folders"
    | "rename-folder"
    | "delete-folder"
    | "create-label"
    | "list-labels"
    | "rename-label"
    | "delete-label"
    | "list-messages"
    | "search-messages"
    | "get-attachment"
    | "get-message"
    | "get-thread"
    | "mutate-message"
    | "create-draft"
    | "get-draft"
    | "update-draft"
    | "schedule-outbound"
    | "get-outbound"
    | "cancel-outbound"
    | "resend-outbound"
    | "record-inbound"
    | "commit-inbound"
    | "replay-inbound";
  readonly reason:
    | "validation"
    | "not-found"
    | "version-conflict"
    | "idempotency-conflict"
    | "invalid-state"
    | "system-folder"
    | "folder-not-empty";
  readonly message: string;
  readonly resourceType?:
    | "mailbox"
    | "address"
    | "folder"
    | "label"
    | "message"
    | "attachment"
    | "thread"
    | "draft"
    | "inbound"
    | "outbound";
  readonly resourceId?: string;
  readonly expectedVersion?: Version;
  readonly actualVersion?: Version;
}> {}

export class MailboxRepositoryError extends Data.TaggedError(
  "MailboxRepositoryError"
)<{
  readonly operation:
    | "read"
    | "write"
    | "transaction"
    | "migrate"
    | "reconcile";
  readonly commitState: "not-committed" | "committed" | "unknown";
  readonly message: string;
  readonly cause: unknown;
  readonly transient?: boolean;
}> {
  get retryable(): boolean {
    return this.transient ?? this.commitState === "not-committed";
  }
}

export class MimeParseError extends Data.TaggedError("MimeParseError")<{
  readonly reason:
    | "malformed-message"
    | "message-too-large"
    | "unsupported-message";
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class InboundManifestMismatchError extends Data.TaggedError(
  "InboundManifestMismatchError"
)<{
  readonly message: string;
}> {}

/** Marker preserved through Workflow retries so only exhausted transient failures are persisted. */
export class InboundRetryableStepError extends Error {
  readonly cause: unknown;

  constructor(cause: unknown) {
    super("Retryable inbound Workflow step failed");
    this.name = "InboundRetryableStepError";
    this.cause = cause;
  }
}

export class RuleEvaluationError extends Data.TaggedError(
  "RuleEvaluationError"
)<{
  readonly ruleId: RuleId;
  readonly ruleVersion: Version;
  readonly message: string;
  readonly cause: unknown;
}> {}

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
