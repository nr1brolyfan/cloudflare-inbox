/* oxlint-disable max-classes-per-file -- MIME capabilities and their errors form one consumer-owned port. */
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import type * as Effect from "effect/Effect";

import type {
  ExtractedInboundMessageV1,
  ParsedInboundMessageV1,
} from "#/modules/mailbox/domain/MailboxInbound";

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

export interface InboundMimeParserService {
  readonly parse: (
    raw: ArrayBuffer
  ) => Effect.Effect<ParsedInboundMessageV1, MimeParseError>;
}

export class InboundMimeParser extends Context.Service<
  InboundMimeParser,
  InboundMimeParserService
>()("cloudflare-inbox/InboundMimeParser") {}

export interface InboundMimeAttachmentExtractorService {
  readonly extract: (
    raw: ArrayBuffer
  ) => Effect.Effect<ExtractedInboundMessageV1, MimeParseError>;
}

export class InboundMimeAttachmentExtractor extends Context.Service<
  InboundMimeAttachmentExtractor,
  InboundMimeAttachmentExtractorService
>()("cloudflare-inbox/InboundMimeAttachmentExtractor") {}
