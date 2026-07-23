import * as AuthPermission from "@effect-auth/core/Permission";
import { eq } from "drizzle-orm";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ControlPlaneDatabase } from "#/platform/control-plane-d1/ControlPlaneDatabase";
import { appAiToolAudit } from "#/platform/control-plane-d1/ControlPlaneSchema";

import type {
  AiToolAuditEvent,
  AiToolKind,
} from "../../domain/AiToolAuditEvent";
import { AiToolAudit, AiToolAuditError } from "../../ports/AiToolAudit";

export const aiToolAuditRetentionDays = 90;
/** Indexed retention horizon for future cleanup; no deletion job exists yet. */
export const aiToolAuditRetentionMillis =
  aiToolAuditRetentionDays * 24 * 60 * 60 * 1000;

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
export const AiToolAuditD1Layer = Layer.effect(
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
