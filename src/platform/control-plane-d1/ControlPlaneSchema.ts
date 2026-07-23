import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const appExternalRecoveryIdentity = sqliteTable(
  "app_external_recovery_identity",
  {
    id: text("id").notNull(),
    userId: text("user_id").notNull(),
    address: text("address").notNull(),
    normalizedAddress: text("normalized_address").notNull(),
    comparisonKey: text("comparison_key").notNull(),
    status: text("status", {
      enum: ["pending", "verified", "revoked"],
    }).notNull(),
    challengeId: text("challenge_id").notNull(),
    challengeExpiresAt: integer("challenge_expires_at").notNull(),
    enrollmentOperationId: text("enrollment_operation_id").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    verifiedAt: integer("verified_at"),
    revokedAt: integer("revoked_at"),
    version: integer("version").notNull().default(1),
  },
  (t) => [
    primaryKey({
      name: "app_external_recovery_identity_pkey",
      columns: [t.id],
    }),
    check(
      "app_external_recovery_identity_id_check",
      sql`length(id) between 1 and 128`
    ),
    check(
      "app_external_recovery_identity_user_id_check",
      sql`length(user_id) between 1 and 128`
    ),
    check(
      "app_external_recovery_identity_address_check",
      sql`length(address) between 3 and 320 and address = trim(address)`
    ),
    check(
      "app_external_recovery_identity_normalized_address_check",
      sql`length(normalized_address) between 3 and 320
        and normalized_address = trim(normalized_address)
        and instr(address, '@') > 1
        and instr(substr(address, instr(address, '@') + 1), '@') = 0
        and normalized_address =
          substr(address, 1, instr(address, '@'))
          || lower(substr(address, instr(address, '@') + 1))`
    ),
    check(
      "app_external_recovery_identity_comparison_key_check",
      sql`length(comparison_key) between 3 and 320
        and comparison_key = lower(trim(comparison_key))
        and comparison_key = lower(address)`
    ),
    check(
      "app_external_recovery_identity_status_check",
      sql`status in ('pending', 'verified', 'revoked')`
    ),
    check(
      "app_external_recovery_identity_challenge_id_check",
      sql`length(challenge_id) between 1 and 128`
    ),
    check(
      "app_external_recovery_identity_challenge_expiry_check",
      sql`challenge_expires_at >= 0 and challenge_expires_at > created_at`
    ),
    check(
      "app_external_recovery_identity_operation_id_check",
      sql`length(enrollment_operation_id) = 36
        and enrollment_operation_id = lower(trim(enrollment_operation_id))
        and substr(enrollment_operation_id, 9, 1) = '-'
        and substr(enrollment_operation_id, 14, 1) = '-'
        and substr(enrollment_operation_id, 15, 1) = '4'
        and substr(enrollment_operation_id, 19, 1) = '-'
        and substr(enrollment_operation_id, 20, 1) in ('8', '9', 'a', 'b')
        and substr(enrollment_operation_id, 24, 1) = '-'
        and length(replace(enrollment_operation_id, '-', '')) = 32
        and replace(enrollment_operation_id, '-', '') not glob '*[^0-9a-f]*'`
    ),
    check(
      "app_external_recovery_identity_created_at_check",
      sql`created_at >= 0`
    ),
    check(
      "app_external_recovery_identity_updated_at_check",
      sql`updated_at >= created_at`
    ),
    check(
      "app_external_recovery_identity_verified_at_check",
      sql`verified_at is null
        or (verified_at >= created_at and verified_at <= updated_at)`
    ),
    check(
      "app_external_recovery_identity_revoked_at_check",
      sql`revoked_at is null
        or (revoked_at >= created_at and revoked_at <= updated_at)`
    ),
    check(
      "app_external_recovery_identity_lifecycle_order_check",
      sql`verified_at is null
        or revoked_at is null
        or revoked_at >= verified_at`
    ),
    check("app_external_recovery_identity_version_check", sql`version >= 1`),
    check(
      "app_external_recovery_identity_state_check",
      sql`(status = 'pending' and verified_at is null and revoked_at is null)
        or (status = 'verified' and verified_at is not null and revoked_at is null)
        or (status = 'revoked' and revoked_at is not null)`
    ),
    uniqueIndex("app_external_recovery_identity_challenge_idx").on(
      t.challengeId
    ),
    uniqueIndex("app_external_recovery_identity_operation_idx").on(
      t.enrollmentOperationId
    ),
    index("app_external_recovery_identity_pending_user_expiry_idx")
      .on(t.userId, t.challengeExpiresAt)
      .where(sql`status = 'pending'`),
    uniqueIndex("app_external_recovery_identity_verified_user_idx")
      .on(t.userId)
      .where(sql`status = 'verified'`),
    uniqueIndex("app_external_recovery_identity_verified_address_idx")
      .on(t.comparisonKey)
      .where(sql`status = 'verified'`),
    index("app_external_recovery_identity_pending_address_expiry_idx")
      .on(t.comparisonKey, t.challengeExpiresAt)
      .where(sql`status = 'pending'`),
    index("app_external_recovery_identity_pending_expiry_idx")
      .on(t.challengeExpiresAt)
      .where(sql`status = 'pending'`),
  ]
);

export const appPasskeyCredentialRevocation = sqliteTable(
  "app_passkey_credential_revocation",
  {
    operationId: text("operation_id").primaryKey(),
    userId: text("user_id").notNull(),
    credentialRecordId: text("credential_record_id").notNull().unique(),
    credentialCreatedAt: integer("credential_created_at").notNull(),
    credentialLastUsedAt: integer("credential_last_used_at"),
    revokedAt: integer("revoked_at").notNull(),
  },
  (t) => [
    check(
      "app_passkey_credential_revocation_operation_id_check",
      sql`length(operation_id) = 36
        and operation_id = lower(trim(operation_id))
        and substr(operation_id, 9, 1) = '-'
        and substr(operation_id, 14, 1) = '-'
        and substr(operation_id, 15, 1) = '4'
        and substr(operation_id, 19, 1) = '-'
        and substr(operation_id, 20, 1) in ('8', '9', 'a', 'b')
        and substr(operation_id, 24, 1) = '-'
        and length(replace(operation_id, '-', '')) = 32
        and replace(operation_id, '-', '') not glob '*[^0-9a-f]*'`
    ),
    check(
      "app_passkey_credential_revocation_user_check",
      sql`length(user_id) between 1 and 128 and user_id = trim(user_id)`
    ),
    check(
      "app_passkey_credential_revocation_credential_check",
      sql`length(credential_record_id) between 1 and 256
        and credential_record_id = trim(credential_record_id)`
    ),
    check(
      "app_passkey_credential_revocation_time_check",
      sql`credential_created_at >= 0 and revoked_at >= credential_created_at
        and (credential_last_used_at is null
          or credential_last_used_at between credential_created_at and revoked_at)`
    ),
    index("app_passkey_credential_revocation_user_operation_idx").on(
      t.userId,
      t.operationId
    ),
  ]
);

export const appAuthorizationGuard = sqliteTable(
  "app_authorization_guard",
  {
    nonce: text("nonce").notNull(),
  },
  (t) => [
    primaryKey({ name: "app_authorization_guard_pkey", columns: [t.nonce] }),
    check(
      "app_authorization_guard_nonce_check",
      sql`length(nonce) between 1 and 128`
    ),
  ]
);

export const appAdministrativeAuditEvent = sqliteTable(
  "app_administrative_audit_event",
  {
    storageId: integer("storage_id").primaryKey({ autoIncrement: true }),
    eventId: text("event_id").notNull().unique(),
    schemaVersion: integer("schema_version").notNull(),
    eventVersion: integer("event_version").notNull(),
    operationId: text("operation_id").notNull(),
    action: text("action").notNull(),
    outcome: text("outcome", {
      enum: ["succeeded", "rejected", "failed"],
    }).notNull(),
    actorType: text("actor_type", {
      enum: ["user", "system", "service"],
    }).notNull(),
    actorId: text("actor_id").notNull(),
    tenantScopeType: text("tenant_scope_type", {
      enum: ["global", "legacy-mailbox"],
    }).notNull(),
    tenantScopeId: text("tenant_scope_id").notNull(),
    resourceType: text("resource_type", {
      enum: ["mailbox", "external-recovery-identity"],
    }).notNull(),
    resourceId: text("resource_id").notNull(),
    requestId: text("request_id"),
    correlationId: text("correlation_id"),
    reasonCode: text("reason_code").notNull(),
    changeType: text("change_type").notNull(),
    resourceVersionBefore: integer("resource_version_before"),
    resourceVersionAfter: integer("resource_version_after"),
    occurredAt: integer("occurred_at").notNull(),
  },
  (t) => [
    check(
      "app_administrative_audit_event_id_check",
      sql`length(event_id) = 83
        and substr(event_id, 1, 19) = 'admin-audit-sha256:'
        and substr(event_id, 20) not glob '*[^0-9a-f]*'`
    ),
    check(
      "app_administrative_audit_schema_version_check",
      sql`schema_version >= 1`
    ),
    check(
      "app_administrative_audit_event_version_check",
      sql`event_version >= 1`
    ),
    check(
      "app_administrative_audit_operation_id_check",
      sql`length(operation_id) = 36
        and operation_id = lower(trim(operation_id))
        and substr(operation_id, 9, 1) = '-'
        and substr(operation_id, 14, 1) = '-'
        and substr(operation_id, 15, 1) = '4'
        and substr(operation_id, 19, 1) = '-'
        and substr(operation_id, 20, 1) in ('8', '9', 'a', 'b')
        and substr(operation_id, 24, 1) = '-'
        and length(replace(operation_id, '-', '')) = 32
        and replace(operation_id, '-', '') not glob '*[^0-9a-f]*'`
    ),
    check(
      "app_administrative_audit_action_check",
      sql`length(action) between 3 and 128
        and action = lower(trim(action))
        and action not glob '*[^a-z0-9._-]*'`
    ),
    check(
      "app_administrative_audit_outcome_check",
      sql`outcome in ('succeeded', 'rejected', 'failed')`
    ),
    check(
      "app_administrative_audit_actor_type_check",
      sql`actor_type in ('user', 'system', 'service')`
    ),
    check(
      "app_administrative_audit_actor_id_check",
      sql`length(actor_id) between 1 and 256 and actor_id = trim(actor_id)`
    ),
    check(
      "app_administrative_audit_tenant_scope_check",
      sql`tenant_scope_type in ('global', 'legacy-mailbox')
        and length(tenant_scope_id) between 1 and 128
        and tenant_scope_id = trim(tenant_scope_id)`
    ),
    check(
      "app_administrative_audit_resource_check",
      sql`resource_type in ('mailbox', 'external-recovery-identity')
        and length(resource_id) between 1 and 128
        and resource_id = trim(resource_id)`
    ),
    check(
      "app_administrative_audit_request_context_check",
      sql`(request_id is null and correlation_id is null)
        or (request_id is not null and correlation_id is not null
          and length(request_id) = 36 and length(correlation_id) = 36
          and request_id = lower(trim(request_id))
          and correlation_id = lower(trim(correlation_id)))`
    ),
    check(
      "app_administrative_audit_reason_check",
      sql`length(reason_code) between 1 and 64
        and reason_code = lower(trim(reason_code))
        and reason_code not glob '*[^a-z0-9._-]*'`
    ),
    check(
      "app_administrative_audit_change_type_check",
      sql`length(change_type) between 3 and 64
        and change_type = lower(trim(change_type))
        and change_type not glob '*[^a-z0-9._-]*'`
    ),
    check(
      "app_administrative_audit_resource_version_check",
      sql`(resource_version_before is null or resource_version_before >= 1)
        and (resource_version_after is null or resource_version_after >= 1)`
    ),
    check("app_administrative_audit_occurred_at_check", sql`occurred_at >= 0`),
    check(
      "app_administrative_audit_semantics_check",
      sql`(action = 'mailbox.owner-bootstrap'
          and outcome = 'succeeded'
          and tenant_scope_type = 'legacy-mailbox'
          and tenant_scope_id = resource_id
          and resource_type = 'mailbox'
          and reason_code = 'owner-bootstrap'
          and change_type = 'mailbox-bootstrapped'
          and resource_version_before is null
          and resource_version_after = 1)
        or (action = 'mailbox.rename'
          and outcome = 'succeeded'
          and tenant_scope_type = 'legacy-mailbox'
          and tenant_scope_id = resource_id
          and resource_type = 'mailbox'
          and reason_code = 'mailbox-renamed'
          and change_type = 'mailbox-renamed'
          and resource_version_before >= 1
          and resource_version_after = resource_version_before + 1)
        or (action = 'external-recovery-identity.enroll'
          and outcome = 'succeeded'
          and tenant_scope_type = 'global'
          and tenant_scope_id = 'global'
          and resource_type = 'external-recovery-identity'
          and reason_code = 'recovery-enrolled'
          and change_type = 'external-recovery-identity-enrolled'
          and resource_version_before is null
          and resource_version_after = 1)
        or (action = 'external-recovery-identity.verify'
          and outcome = 'succeeded'
          and tenant_scope_type = 'global'
          and tenant_scope_id = 'global'
          and resource_type = 'external-recovery-identity'
          and reason_code = 'recovery-verified'
          and change_type = 'external-recovery-identity-verified'
          and resource_version_before >= 1
          and resource_version_after = resource_version_before + 1)
        or (action = 'external-recovery-identity.revoke'
          and outcome = 'succeeded'
          and tenant_scope_type = 'global'
          and tenant_scope_id = 'global'
          and resource_type = 'external-recovery-identity'
          and reason_code = 'recovery-revoked'
          and change_type = 'external-recovery-identity-revoked'
          and resource_version_before >= 1
          and resource_version_after = resource_version_before + 1)`
    ),
    index("app_administrative_audit_operation_idx").on(
      t.operationId,
      t.storageId
    ),
    index("app_administrative_audit_tenant_time_idx").on(
      t.tenantScopeType,
      t.tenantScopeId,
      sql`${t.occurredAt} desc`,
      sql`${t.storageId} desc`
    ),
    index("app_administrative_audit_actor_time_idx").on(
      t.actorType,
      t.actorId,
      sql`${t.occurredAt} desc`,
      sql`${t.storageId} desc`
    ),
    index("app_administrative_audit_resource_time_idx").on(
      t.resourceType,
      t.resourceId,
      sql`${t.occurredAt} desc`,
      sql`${t.storageId} desc`
    ),
    index("app_administrative_audit_action_outcome_time_idx").on(
      t.action,
      t.outcome,
      sql`${t.occurredAt} desc`,
      sql`${t.storageId} desc`
    ),
  ]
);

export const appDevEmailMessage = sqliteTable(
  "app_dev_email_message",
  {
    id: text("id").notNull(),
    kind: text("kind").notNull(),
    recipient: text("recipient").notNull(),
    messageJson: text("message_json").notNull(),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (t) => [
    primaryKey({ name: "app_dev_email_message_pkey", columns: [t.id] }),
    index("app_dev_email_message_created_at_idx").on(sql`${t.createdAt} desc`),
    index("app_dev_email_message_recipient_created_at_idx").on(
      t.recipient,
      sql`${t.createdAt} desc`
    ),
  ]
);

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
