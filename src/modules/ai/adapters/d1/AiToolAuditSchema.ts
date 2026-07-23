import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

export const appAiToolAudit = sqliteTable(
  "app_ai_tool_audit",
  {
    id: text("id").primaryKey(),
    principalType: text("principal_type").notNull(),
    principalId: text("principal_id").notNull(),
    mailboxId: text("mailbox_id").notNull(),
    source: text("source", { enum: ["interactive-session"] }).notNull(),
    runId: text("run_id").notNull(),
    callId: text("call_id").notNull(),
    toolName: text("tool_name").notNull(),
    toolKind: text("tool_kind", {
      enum: ["mutation", "read", "unknown"],
    }).notNull(),
    outcome: text("outcome", {
      enum: ["failed", "rejected", "succeeded"],
    }).notNull(),
    reason: text("reason").notNull(),
    recordedAt: integer("recorded_at").notNull(),
    retainUntil: integer("retain_until").notNull(),
  },
  (t) => [
    check(
      "app_ai_tool_audit_id_check",
      sql`length(id) = 85
        and substr(id, 1, 21) = 'ai-tool-audit-sha256:'
        and substr(id, 22) not glob '*[^0-9a-f]*'`
    ),
    check(
      "app_ai_tool_audit_principal_type_check",
      sql`length(principal_type) between 1 and 64`
    ),
    check(
      "app_ai_tool_audit_principal_id_check",
      sql`length(principal_id) between 1 and 256`
    ),
    check(
      "app_ai_tool_audit_mailbox_id_check",
      sql`length(mailbox_id) between 1 and 128`
    ),
    check(
      "app_ai_tool_audit_source_check",
      sql`source = 'interactive-session'`
    ),
    check(
      "app_ai_tool_audit_run_id_check",
      sql`length(run_id) between 1 and 128`
    ),
    check(
      "app_ai_tool_audit_call_id_check",
      sql`length(call_id) between 1 and 128`
    ),
    check(
      "app_ai_tool_audit_tool_name_check",
      sql`length(tool_name) between 1 and 64`
    ),
    check(
      "app_ai_tool_audit_tool_kind_check",
      sql`tool_kind in ('mutation', 'read', 'unknown')`
    ),
    check(
      "app_ai_tool_audit_outcome_check",
      sql`outcome in ('failed', 'rejected', 'succeeded')`
    ),
    check(
      "app_ai_tool_audit_reason_check",
      sql`length(reason) between 1 and 64`
    ),
    check("app_ai_tool_audit_recorded_at_check", sql`recorded_at >= 0`),
    check(
      "app_ai_tool_audit_retain_until_check",
      sql`retain_until > recorded_at`
    ),
    index("app_ai_tool_audit_retention_idx").on(t.retainUntil),
    index("app_ai_tool_audit_mailbox_time_idx").on(
      t.mailboxId,
      sql`${t.recordedAt} desc`
    ),
  ]
);
