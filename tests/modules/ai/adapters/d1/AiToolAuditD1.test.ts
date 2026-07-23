/* oxlint-disable unicorn/no-array-for-each -- Effect.forEach is not Array#forEach. */
import { DatabaseSync } from "node:sqlite";

import * as AuthPermission from "@effect-auth/core/Permission";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  AiToolAuditD1Layer,
  aiToolAuditRetentionMillis,
} from "#/modules/ai/adapters/d1/AiToolAuditD1";
import { AiToolAuditEvent } from "#/modules/ai/domain/AiToolAuditEvent";
import { AiToolAudit } from "#/modules/ai/ports/AiToolAudit";
import {
  ControlPlaneD1Binding,
  ControlPlaneDatabaseLayer,
} from "#/platform/control-plane-d1/ControlPlaneDatabase";
import type { ControlPlaneDatabase } from "#/platform/control-plane-d1/ControlPlaneDatabase";

import {
  applyControlPlaneMigrations,
  makeTestD1Database,
} from "../../../../support/d1";

const event = Schema.decodeUnknownSync(AiToolAuditEvent)({
  callId: "call-a",
  kind: "read",
  mailboxId: "mailbox-a",
  name: "mail_read",
  outcome: "succeeded",
  reason: "completed",
  runId: "run-a",
  source: "interactive-session",
});
describe("D1 AI tool audit", () => {
  let database: DatabaseSync;
  let auditLayer: Layer.Layer<AiToolAudit, never>;
  let databaseLayer: Layer.Layer<ControlPlaneDatabase, never>;

  beforeEach(async () => {
    database = new DatabaseSync(":memory:");
    await applyControlPlaneMigrations(database);
    const bindingLayer = Layer.succeed(
      ControlPlaneD1Binding,
      ControlPlaneD1Binding.of({
        database: makeTestD1Database(database) as unknown as D1Database,
      })
    );
    databaseLayer = ControlPlaneDatabaseLayer.pipe(Layer.provide(bindingLayer));
    auditLayer = AiToolAuditD1Layer.pipe(Layer.provide(databaseLayer));
  });

  afterEach(() => database.close());

  const record = (value: AiToolAuditEvent = event, principalId = "user-a") =>
    AiToolAudit.pipe(
      Effect.flatMap((audit) => audit.record(value)),
      Effect.provide(auditLayer),
      Effect.provideService(
        AuthPermission.CurrentPrincipal,
        AuthPermission.CurrentPrincipal.of(
          AuthPermission.PermissionSubject.make("user", principalId)
        )
      )
    );

  it("stores normalized metadata with deterministic identity and 90-day retention", async () => {
    const before = Date.now();
    await Effect.runPromise(record());
    const after = Date.now();
    const row = database
      .prepare("select * from app_ai_tool_audit")
      .get() as Record<string, unknown>;

    expect(row).toMatchObject({
      call_id: "call-a",
      mailbox_id: "mailbox-a",
      outcome: "succeeded",
      principal_id: "user-a",
      principal_type: "user",
      reason: "completed",
      run_id: "run-a",
      source: "interactive-session",
      tool_kind: "read",
      tool_name: "mail_read",
    });
    expect(row.id).toMatch(/^ai-tool-audit-sha256:[0-9a-f]{64}$/u);
    expect({
      recordedAtIsNumber: typeof row.recorded_at === "number",
      recordedInWindow:
        Number(row.recorded_at) >= before && Number(row.recorded_at) <= after,
      retention: Number(row.retain_until) - Number(row.recorded_at),
    }).toStrictEqual({
      recordedAtIsNumber: true,
      recordedInWindow: true,
      retention: aiToolAuditRetentionMillis,
    });
  });

  it("accepts exact concurrent replays and keeps one row", async () => {
    await Effect.runPromise(
      Effect.forEach(Array.from({ length: 8 }), () => record(), {
        concurrency: "unbounded",
      })
    );
    expect(
      database.prepare("select count(*) as count from app_ai_tool_audit").get()
    ).toMatchObject({ count: 1 });
  });

  it("records failed and successful outcomes for the same logical call", async () => {
    const failed = Schema.decodeUnknownSync(AiToolAuditEvent)({
      ...event,
      outcome: "failed",
      reason: "execution-failed",
    });
    await Effect.runPromise(record(failed));
    await Effect.runPromise(record(event));

    expect(
      database.prepare("select count(*) as count from app_ai_tool_audit").get()
    ).toMatchObject({ count: 2 });
  });

  it("fails a changed deterministic-ID collision", async () => {
    await Effect.runPromise(record());
    database
      .prepare("update app_ai_tool_audit set reason = 'unavailable'")
      .run();

    await expect(Effect.runPromise(record())).rejects.toMatchObject({
      _tag: "AiToolAuditError",
      reason: "collision",
    });
  });

  it("fails closed on storage errors", async () => {
    database.exec("drop table app_ai_tool_audit");
    await expect(Effect.runPromise(record())).rejects.toMatchObject({
      _tag: "AiToolAuditError",
      reason: "storage",
    });
  });

  it("has no columns for prompts, content, arguments, results, sessions, IPs, causes, or tokens", () => {
    const columns = database
      .prepare("pragma table_info(app_ai_tool_audit)")
      .all()
      .map((row) => String(row.name));

    expect(columns).toStrictEqual([
      "id",
      "principal_type",
      "principal_id",
      "mailbox_id",
      "source",
      "run_id",
      "call_id",
      "tool_name",
      "tool_kind",
      "outcome",
      "reason",
      "recorded_at",
      "retain_until",
    ]);
    expect(columns.join(" ")).not.toMatch(
      /\b(?:prompt|argument|result|query|content|session|ip|cause|token)\b/u
    );
  });
});
