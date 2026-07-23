/* oxlint-disable max-classes-per-file -- Cohesive inbound repository capabilities share one port. */
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type { MailboxDomainError } from "#/modules/mailbox/domain/MailboxError";
import type {
  CommitInboundMessage,
  InboundProcessingResult,
  PreparedInboundReplayV1,
  RecordInboundProcessing,
  ReplayInboundInput,
} from "#/modules/mailbox/domain/MailboxInbound";
import type { MailboxRepositoryError } from "#/modules/mailbox/ports/MailboxRepositoryError";

type RepositoryError = MailboxDomainError | MailboxRepositoryError;

export interface InboundMessageCommitterService {
  readonly commit: (
    input: CommitInboundMessage
  ) => Effect.Effect<InboundProcessingResult, RepositoryError>;
}

/** Trusted final commit boundary from the Workflow to one MailboxDO. */
export class InboundMessageCommitter extends Context.Service<
  InboundMessageCommitter,
  InboundMessageCommitterService
>()("cloudflare-inbox/InboundMessageCommitter") {}

export interface InboundProcessingRecorderService {
  readonly record: (
    input: RecordInboundProcessing
  ) => Effect.Effect<InboundProcessingResult, RepositoryError>;
}

/** Durable progress and terminal failure boundary owned by MailboxDO. */
export class InboundProcessingRecorder extends Context.Service<
  InboundProcessingRecorder,
  InboundProcessingRecorderService
>()("cloudflare-inbox/InboundProcessingRecorder") {}

export interface InboundReplayPreparerService {
  readonly claim: (
    input: ReplayInboundInput
  ) => Effect.Effect<PreparedInboundReplayV1, RepositoryError>;
}

export class InboundReplayPreparer extends Context.Service<
  InboundReplayPreparer,
  InboundReplayPreparerService
>()("cloudflare-inbox/InboundReplayPreparer") {}
