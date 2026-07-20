import * as AuthPermission from "@effect-auth/core/Permission";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { MailboxId } from "../mailboxes/core";
import { AiToolCallId, AiToolName, AiToolRunId } from "./tool-protocol";

/** Audit data is intentionally metadata-only and excludes model or tool content. */
export class AiToolAuditEvent extends Schema.Class<AiToolAuditEvent>(
  "cloudflare-inbox/AiToolAuditEvent"
)({
  callId: AiToolCallId,
  mailboxId: MailboxId,
  name: AiToolName,
  outcome: Schema.Literals(["failed", "rejected", "succeeded"]),
  runId: AiToolRunId,
  source: Schema.Literal("interactive-session"),
}) {}

export interface AiToolAudit {
  readonly record: (
    event: AiToolAuditEvent
  ) => Effect.Effect<void, never, AuthPermission.CurrentPrincipal>;
}

export const AiToolAudit = Context.Service<AiToolAudit>(
  "cloudflare-inbox/AiToolAudit"
);

/** Explicit foundation adapter: no audit sink is configured yet. */
export const AiToolAuditNoopLive = Layer.succeed(
  AiToolAudit,
  AiToolAudit.of({
    record: () => AuthPermission.CurrentPrincipal.pipe(Effect.asVoid),
  })
);
