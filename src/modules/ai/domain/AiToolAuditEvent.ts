import * as Schema from "effect/Schema";

import { MailboxId } from "#/modules/mailbox/domain/Mailbox";

import { AiToolCallId, AiToolName, AiToolRunId } from "./AiToolProtocol";

export type AiToolKind = "mutation" | "read" | "unknown";

export const AiToolAuditReason = Schema.Literals([
  "completed",
  "denied",
  "execution-failed",
  "forbidden-arguments",
  "invalid-arguments",
  "invalid-call",
  "invalid-result",
  "limit-aggregate-argument-bytes",
  "limit-aggregate-result-bytes",
  "limit-argument-bytes-per-call",
  "limit-mutations",
  "limit-reads",
  "limit-replay-mismatch",
  "limit-result-bytes-per-call",
  "limit-total-calls",
  "unavailable",
  "unknown-tool",
]);
export type AiToolAuditReason = Schema.Schema.Type<typeof AiToolAuditReason>;

/** Audit data is intentionally metadata-only and excludes model or tool content. */
export class AiToolAuditEvent extends Schema.Class<AiToolAuditEvent>(
  "cloudflare-inbox/AiToolAuditEvent"
)({
  callId: AiToolCallId,
  kind: Schema.Literals(["mutation", "read", "unknown"]),
  mailboxId: MailboxId,
  name: AiToolName,
  outcome: Schema.Literals(["failed", "rejected", "succeeded"]),
  reason: AiToolAuditReason,
  runId: AiToolRunId,
  source: Schema.Literal("interactive-session"),
}) {}
