/* oxlint-disable max-classes-per-file -- Operational status error and service form one port contract. */
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import type * as Effect from "effect/Effect";

import type { MailboxId } from "#/modules/mailbox/domain/Mailbox";

export class MailboxOperationalStatusError extends Data.TaggedError(
  "MailboxOperationalStatusError"
)<{
  readonly cause?: unknown;
  readonly message: string;
}> {}

export interface MailboxOperationalStatusService {
  readonly acquire: (input: {
    readonly mailboxId: MailboxId;
    readonly operationId: string;
    readonly operationKind: "inbound-commit" | "outbound-dispatch";
  }) => Effect.Effect<string | null, MailboxOperationalStatusError>;
  readonly isActive: (
    mailboxId: MailboxId
  ) => Effect.Effect<boolean, MailboxOperationalStatusError>;
  readonly release: (input: {
    readonly holderId: string;
    readonly mailboxId: MailboxId;
    readonly operationId: string;
    readonly operationKind: "inbound-commit" | "outbound-dispatch";
  }) => Effect.Effect<void, MailboxOperationalStatusError>;
}

/** Rechecks current mailbox and organization lifecycle at asynchronous commit seams. */
export class MailboxOperationalStatus extends Context.Service<
  MailboxOperationalStatus,
  MailboxOperationalStatusService
>()("cloudflare-inbox/MailboxOperationalStatus") {}
