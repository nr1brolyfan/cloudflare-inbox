import * as Context from "effect/Context";
/* oxlint-disable max-classes-per-file -- Inbound domain schemas are intentionally consolidated. */
import * as Data from "effect/Data";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
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
} from "./core";
import type {
  BlobStoreError,
  MimeParseError,
  WorkflowStartError,
} from "./errors";

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
  status: Schema.Literals(["parsing", "attachments_stored"]),
});
export type InboundWorkflowResultV1 = Schema.Schema.Type<
  typeof InboundWorkflowResultV1
>;

export interface InboundWorkflowStarter {
  readonly start: (
    params: InboundWorkflowParamsV1
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
