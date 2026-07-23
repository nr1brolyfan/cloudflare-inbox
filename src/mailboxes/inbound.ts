import * as Context from "effect/Context";
/* oxlint-disable max-classes-per-file -- Inbound domain schemas are intentionally consolidated. */
import * as Data from "effect/Data";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  AsyncRuleJobId,
  AttemptCount,
  ByteSize,
  ContentId,
  EmailAddress,
  FileName,
  InboundIngestId,
  MailAddress,
  MailboxId,
  MessageSubject,
  MessageId,
  MimeType,
  OperationId,
  RfcMessageId,
  UnixMillis,
  Version,
} from "#/modules/mailbox/domain/Mailbox";
import type { MailboxDomainError } from "#/modules/mailbox/domain/MailboxError";
import type { MimeParseError } from "#/modules/mailbox/ports/InboundEmailProcessing";
import type { BlobStoreError } from "#/modules/mailbox/ports/MailboxBlobStore";
import type { MailboxRepositoryError } from "#/modules/mailbox/ports/MailboxRepositoryError";
import type { WorkflowStartError } from "#/modules/mailbox/ports/MailboxWorkflowStarter";

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
  asyncRuleJobId: Schema.optional(AsyncRuleJobId),
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
      processing.asyncRuleJobId !== undefined &&
      processing.status !== "ready"
    ) {
      return "asyncRuleJobId may be present only when inbound processing is ready";
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

export interface InboundMailboxResolver {
  readonly resolve: (
    recipient: EmailAddress
  ) => Effect.Effect<MailboxId, InboundEmailRejected>;
}

/** Resolves a validated SMTP envelope recipient before selecting a MailboxDO. */
export const InboundMailboxResolver = Context.Service<InboundMailboxResolver>(
  "cloudflare-inbox/InboundMailboxResolver"
);

export const InboundWorkflowParamsV1 = Schema.Struct({
  formatVersion: Schema.Literal(1),
  inboundIngestId: InboundIngestId,
  mailboxId: MailboxId,
  envelope: ReceiveInboundEmailInput,
  receivedAt: UnixMillis,
});
export type InboundWorkflowParamsV1 = Schema.Schema.Type<
  typeof InboundWorkflowParamsV1
>;

const InboundExecutionAttempt = AttemptCount.pipe(
  Schema.check(Schema.isGreaterThanOrEqualTo(1))
);

export const InboundWorkflowParamsV2 = Schema.Struct({
  formatVersion: Schema.Literal(2),
  workflowInstanceId: OperationId,
  executionAttempt: InboundExecutionAttempt,
  inboundIngestId: InboundIngestId,
  mailboxId: MailboxId,
  envelope: ReceiveInboundEmailInput,
  receivedAt: UnixMillis,
});
export type InboundWorkflowParamsV2 = Schema.Schema.Type<
  typeof InboundWorkflowParamsV2
>;

export const InboundWorkflowParams = Schema.Union([
  InboundWorkflowParamsV1,
  InboundWorkflowParamsV2,
]);
export type InboundWorkflowParams = Schema.Schema.Type<
  typeof InboundWorkflowParams
>;

export const InboundRawStoredCheckpointV1 = Schema.Struct({
  formatVersion: Schema.Literal(1),
  inboundIngestId: InboundIngestId,
  mailboxId: MailboxId,
  status: Schema.Literal("raw_stored"),
});

export const InboundWorkflowResultV1 = Schema.Struct({
  formatVersion: Schema.Literal(1),
  inboundIngestId: InboundIngestId,
  mailboxId: MailboxId,
  messageId: Schema.optional(MessageId),
  status: Schema.Literals(["parsing", "attachments_stored", "ready"]),
}).check(
  Schema.makeFilter((result) =>
    (result.status === "ready") === (result.messageId !== undefined)
      ? undefined
      : "messageId must be present exactly when the workflow result is ready"
  )
);
export type InboundWorkflowResultV1 = Schema.Schema.Type<
  typeof InboundWorkflowResultV1
>;

export interface InboundWorkflowStarter {
  readonly start: (
    params: InboundWorkflowParams
  ) => Effect.Effect<void, WorkflowStartError>;
}

/** Starts the durable processor using the ingest ID as its instance identity. */
export const InboundWorkflowStarter = Context.Service<InboundWorkflowStarter>(
  "cloudflare-inbox/InboundWorkflowStarter"
);

const AttachmentIndex = Schema.Int.pipe(
  Schema.check(Schema.isGreaterThanOrEqualTo(0))
);

export const ParsedInboundAttachmentV1 = Schema.Struct({
  index: AttachmentIndex,
  fileName: Schema.optional(FileName),
  mimeType: MimeType,
  size: ByteSize,
  contentId: Schema.optional(ContentId),
  disposition: Schema.Literals(["attachment", "inline"]),
});
export type ParsedInboundAttachmentV1 = Schema.Schema.Type<
  typeof ParsedInboundAttachmentV1
>;

export const ParsedInboundMessageV1 = Schema.Struct({
  formatVersion: Schema.Literal(1),
  subject: MessageSubject,
  sender: Schema.optional(MailAddress),
  to: Schema.Array(MailAddress),
  cc: Schema.Array(MailAddress),
  bcc: Schema.Array(MailAddress),
  rfcMessageId: Schema.optional(RfcMessageId),
  inReplyTo: Schema.optional(RfcMessageId),
  references: Schema.Array(RfcMessageId),
  textBody: Schema.optional(Schema.String),
  htmlBody: Schema.optional(Schema.String),
  headerDate: Schema.optional(UnixMillis),
  attachments: Schema.Array(ParsedInboundAttachmentV1),
}).check(
  Schema.makeFilter((message) =>
    message.attachments.every((attachment, index) => attachment.index === index)
      ? undefined
      : "attachment indices must be contiguous and ordered"
  )
);
export type ParsedInboundMessageV1 = Schema.Schema.Type<
  typeof ParsedInboundMessageV1
>;

export const ReadInboundRawMessageInput = Schema.Struct({
  inboundIngestId: InboundIngestId,
  mailboxId: MailboxId,
  rawSize: ByteSize,
  receivedAt: UnixMillis,
});
export type ReadInboundRawMessageInput = Schema.Schema.Type<
  typeof ReadInboundRawMessageInput
>;

export interface InboundRawMessageReader {
  readonly read: (
    input: ReadInboundRawMessageInput
  ) => Effect.Effect<ArrayBuffer, BlobStoreError>;
}

export const InboundRawMessageReader = Context.Service<InboundRawMessageReader>(
  "cloudflare-inbox/InboundRawMessageReader"
);

export interface InboundMimeParser {
  readonly parse: (
    raw: ArrayBuffer
  ) => Effect.Effect<ParsedInboundMessageV1, MimeParseError>;
}

export const InboundMimeParser = Context.Service<InboundMimeParser>(
  "cloudflare-inbox/InboundMimeParser"
);

export const ExtractedInboundAttachmentV1 = Schema.Struct({
  metadata: ParsedInboundAttachmentV1,
  content: Schema.Uint8Array,
}).check(
  Schema.makeFilter((attachment) =>
    attachment.content.byteLength === attachment.metadata.size
      ? undefined
      : "attachment content size must match its metadata"
  )
);
export type ExtractedInboundAttachmentV1 = Schema.Schema.Type<
  typeof ExtractedInboundAttachmentV1
>;

export const ExtractedInboundMessageV1 = Schema.Struct({
  manifest: ParsedInboundMessageV1,
  attachments: Schema.Array(ExtractedInboundAttachmentV1),
}).check(
  Schema.makeFilter((message) => {
    if (message.attachments.length !== message.manifest.attachments.length) {
      return "extracted attachment count must match the parsed manifest";
    }
    return message.attachments.every((attachment, index) => {
      const expected = message.manifest.attachments[index];
      return (
        expected !== undefined &&
        JSON.stringify(
          Schema.encodeSync(ParsedInboundAttachmentV1)(attachment.metadata)
        ) ===
          JSON.stringify(Schema.encodeSync(ParsedInboundAttachmentV1)(expected))
      );
    })
      ? undefined
      : "extracted attachment metadata must match the parsed manifest";
  })
);
export type ExtractedInboundMessageV1 = Schema.Schema.Type<
  typeof ExtractedInboundMessageV1
>;

export interface InboundMimeAttachmentExtractor {
  readonly extract: (
    raw: ArrayBuffer
  ) => Effect.Effect<ExtractedInboundMessageV1, MimeParseError>;
}

export const InboundMimeAttachmentExtractor =
  Context.Service<InboundMimeAttachmentExtractor>(
    "cloudflare-inbox/InboundMimeAttachmentExtractor"
  );

export const StoreInboundAttachmentsInput = Schema.Struct({
  inboundIngestId: InboundIngestId,
  mailboxId: MailboxId,
  receivedAt: UnixMillis,
  attachments: Schema.Array(ExtractedInboundAttachmentV1),
});
export type StoreInboundAttachmentsInput = Schema.Schema.Type<
  typeof StoreInboundAttachmentsInput
>;

export interface InboundAttachmentStore {
  readonly store: (
    input: StoreInboundAttachmentsInput
  ) => Effect.Effect<void, BlobStoreError>;
}

export const InboundAttachmentStore = Context.Service<InboundAttachmentStore>(
  "cloudflare-inbox/InboundAttachmentStore"
);

export const InboundAttachmentsStoredCheckpointV1 = Schema.Struct({
  formatVersion: Schema.Literal(1),
  inboundIngestId: InboundIngestId,
  mailboxId: MailboxId,
  attachmentCount: AttachmentIndex,
  status: Schema.Literal("attachments_stored"),
});

export const CommitInboundMessageV1 = Schema.Struct({
  formatVersion: Schema.Literal(1),
  inboundIngestId: InboundIngestId,
  mailboxId: MailboxId,
  envelope: ReceiveInboundEmailInput,
  receivedAt: UnixMillis,
  message: ParsedInboundMessageV1,
});
export type CommitInboundMessageV1 = Schema.Schema.Type<
  typeof CommitInboundMessageV1
>;

export const CommitInboundMessageV2 = Schema.Struct({
  formatVersion: Schema.Literal(2),
  executionAttempt: InboundExecutionAttempt,
  inboundIngestId: InboundIngestId,
  mailboxId: MailboxId,
  envelope: ReceiveInboundEmailInput,
  receivedAt: UnixMillis,
  message: ParsedInboundMessageV1,
});

export const CommitInboundMessage = Schema.Union([
  CommitInboundMessageV1,
  CommitInboundMessageV2,
]);
export type CommitInboundMessage = Schema.Schema.Type<
  typeof CommitInboundMessage
>;

const InboundCheckpointStatus = Schema.Literals([
  "raw_stored",
  "parsing",
  "attachments_stored",
]);

export const RecordInboundCheckpointV1 = Schema.Struct({
  _tag: Schema.Literal("Checkpoint"),
  formatVersion: Schema.Literal(1),
  inboundIngestId: InboundIngestId,
  mailboxId: MailboxId,
  envelope: ReceiveInboundEmailInput,
  receivedAt: UnixMillis,
  status: InboundCheckpointStatus,
});

export const RecordInboundFailureV1 = Schema.Struct({
  _tag: Schema.Literal("Failure"),
  formatVersion: Schema.Literal(1),
  inboundIngestId: InboundIngestId,
  mailboxId: MailboxId,
  envelope: ReceiveInboundEmailInput,
  receivedAt: UnixMillis,
  message: Schema.optional(ParsedInboundMessageV1),
  failure: Schema.Struct({
    code: InboundFailureCode,
    replayable: Schema.Boolean,
  }),
});

export const RecordInboundProcessingV1 = Schema.Union([
  RecordInboundCheckpointV1,
  RecordInboundFailureV1,
]);
export type RecordInboundProcessingV1 = Schema.Schema.Type<
  typeof RecordInboundProcessingV1
>;

export const RecordInboundCheckpointV2 = Schema.Struct({
  ...RecordInboundCheckpointV1.fields,
  formatVersion: Schema.Literal(2),
  executionAttempt: InboundExecutionAttempt,
});

export const RecordInboundFailureV2 = Schema.Struct({
  ...RecordInboundFailureV1.fields,
  formatVersion: Schema.Literal(2),
  executionAttempt: InboundExecutionAttempt,
});

export const RecordInboundProcessing = Schema.Union([
  RecordInboundProcessingV1,
  RecordInboundCheckpointV2,
  RecordInboundFailureV2,
]);
export type RecordInboundProcessing = Schema.Schema.Type<
  typeof RecordInboundProcessing
>;

export const PreparedInboundReplayV1 = Schema.Struct({
  formatVersion: Schema.Literal(1),
  processing: InboundProcessingResult,
  workflow: InboundWorkflowParamsV2,
}).check(
  Schema.makeFilter((prepared) =>
    prepared.processing.status === "received" &&
    prepared.processing.id === prepared.workflow.inboundIngestId &&
    prepared.processing.mailboxId === prepared.workflow.mailboxId &&
    prepared.processing.attemptCount === prepared.workflow.executionAttempt
      ? undefined
      : "prepared replay processing and workflow must describe the same received attempt"
  )
);
export type PreparedInboundReplayV1 = Schema.Schema.Type<
  typeof PreparedInboundReplayV1
>;

export const InboundCommittedCheckpointV1 = Schema.Struct({
  formatVersion: Schema.Literal(1),
  inboundIngestId: InboundIngestId,
  mailboxId: MailboxId,
  messageId: MessageId,
  status: Schema.Literal("ready"),
});

export interface InboundMessageCommitter {
  readonly commit: (
    input: CommitInboundMessage
  ) => Effect.Effect<
    InboundProcessingResult,
    MailboxDomainError | MailboxRepositoryError
  >;
}

/** Trusted final commit boundary from the Workflow to one MailboxDO. */
export const InboundMessageCommitter = Context.Service<InboundMessageCommitter>(
  "cloudflare-inbox/InboundMessageCommitter"
);

export interface InboundProcessingRecorder {
  readonly record: (
    input: RecordInboundProcessing
  ) => Effect.Effect<
    InboundProcessingResult,
    MailboxDomainError | MailboxRepositoryError
  >;
}

/** Durable progress and terminal failure boundary owned by MailboxDO. */
export const InboundProcessingRecorder =
  Context.Service<InboundProcessingRecorder>(
    "cloudflare-inbox/InboundProcessingRecorder"
  );

export interface InboundReplayPreparer {
  readonly claim: (
    input: ReplayInboundInput
  ) => Effect.Effect<
    PreparedInboundReplayV1,
    MailboxDomainError | MailboxRepositoryError
  >;
}

export const InboundReplayPreparer = Context.Service<InboundReplayPreparer>(
  "cloudflare-inbox/InboundReplayPreparer"
);

export interface InboundReplay {
  readonly replay: (
    input: ReplayInboundInput
  ) => Effect.Effect<
    InboundProcessingResult,
    MailboxDomainError | MailboxRepositoryError | WorkflowStartError
  >;
}

export const InboundReplay = Context.Service<InboundReplay>(
  "cloudflare-inbox/InboundReplay"
);
