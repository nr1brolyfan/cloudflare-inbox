/* oxlint-disable max-classes-per-file -- Audit event and its storage error form one port contract. */
import * as AuthPermission from "@effect-auth/core/Permission";
import { eq } from "drizzle-orm";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { ControlPlaneDatabase } from "../control-plane/database";
import { appAiToolAudit } from "../control-plane/schema";
import { MailboxId } from "../mailboxes/core";
import { AiToolCallId, AiToolName, AiToolRunId } from "./tool-protocol";
import type { AiToolKind } from "./tool-run-budget";

export const aiToolAuditRetentionDays = 90;
/** Indexed retention horizon for future cleanup; no deletion job exists yet. */
export const aiToolAuditRetentionMillis =
  aiToolAuditRetentionDays * 24 * 60 * 60 * 1000;

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

export class AiToolAuditError extends Data.TaggedError("AiToolAuditError")<{
  readonly cause: unknown;
  readonly reason: "collision" | "storage";
}> {}

export interface AiToolAudit {
  readonly record: (
    event: AiToolAuditEvent
  ) => Effect.Effect<void, AiToolAuditError, AuthPermission.CurrentPrincipal>;
}

export const AiToolAudit = Context.Service<AiToolAudit>(
  "cloudflare-inbox/AiToolAudit"
);

const digestHex = (value: string) =>
  Effect.tryPromise({
    try: () => crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    catch: (cause) => new AiToolAuditError({ cause, reason: "storage" }),
  }).pipe(
    Effect.map((digest) =>
      [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("")
    )
  );

const auditId = (
  principal: AuthPermission.PermissionSubject,
  event: AiToolAuditEvent
) =>
  digestHex(
    JSON.stringify([
      principal.type,
      principal.id,
      event.mailboxId,
      event.source,
      event.runId,
      event.callId,
      event.outcome,
    ])
  ).pipe(Effect.map((digest) => `ai-tool-audit-sha256:${digest}`));

const sameEvent = (
  row: {
    readonly callId: string;
    readonly mailboxId: string;
    readonly outcome: string;
    readonly principalId: string;
    readonly principalType: string;
    readonly reason: string;
    readonly runId: string;
    readonly source: string;
    readonly toolKind: string;
    readonly toolName: string;
  },
  principal: AuthPermission.PermissionSubject,
  event: AiToolAuditEvent
) =>
  row.principalType === principal.type &&
  row.principalId === principal.id &&
  row.mailboxId === event.mailboxId &&
  row.source === event.source &&
  row.runId === event.runId &&
  row.callId === event.callId &&
  row.toolName === event.name &&
  row.toolKind === event.kind &&
  row.outcome === event.outcome &&
  row.reason === event.reason;

/** D1 metadata sink with deterministic identity and replay/collision verification. */
export const AiToolAuditD1Live = Layer.effect(
  AiToolAudit,
  Effect.gen(function* () {
    const database = yield* ControlPlaneDatabase;

    return AiToolAudit.of({
      record: (event) =>
        Effect.gen(function* () {
          const principal = yield* AuthPermission.CurrentPrincipal;
          const id = yield* auditId(principal, event);
          const recordedAt = yield* Clock.currentTimeMillis;
          const retainUntil = recordedAt + aiToolAuditRetentionMillis;

          yield* database
            .insert(appAiToolAudit)
            .values({
              callId: event.callId,
              id,
              mailboxId: event.mailboxId,
              outcome: event.outcome,
              principalId: principal.id,
              principalType: principal.type,
              reason: event.reason,
              recordedAt,
              retainUntil,
              runId: event.runId,
              source: event.source,
              toolKind: event.kind satisfies AiToolKind,
              toolName: event.name,
            })
            .onConflictDoNothing({ target: appAiToolAudit.id })
            .pipe(
              Effect.mapError(
                (cause) => new AiToolAuditError({ cause, reason: "storage" })
              )
            );

          const rows = yield* database
            .select({
              callId: appAiToolAudit.callId,
              mailboxId: appAiToolAudit.mailboxId,
              outcome: appAiToolAudit.outcome,
              principalId: appAiToolAudit.principalId,
              principalType: appAiToolAudit.principalType,
              reason: appAiToolAudit.reason,
              runId: appAiToolAudit.runId,
              source: appAiToolAudit.source,
              toolKind: appAiToolAudit.toolKind,
              toolName: appAiToolAudit.toolName,
            })
            .from(appAiToolAudit)
            .where(eq(appAiToolAudit.id, id))
            .limit(2)
            .pipe(
              Effect.mapError(
                (cause) => new AiToolAuditError({ cause, reason: "storage" })
              )
            );

          if (
            rows.length !== 1 ||
            rows[0] === undefined ||
            !sameEvent(rows[0], principal, event)
          ) {
            return yield* new AiToolAuditError({
              cause: new Error("AI tool audit replay does not match"),
              reason: "collision",
            });
          }
        }),
    });
  })
);
