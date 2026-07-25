import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

import { authUser } from "#/auth/schema/modules/core";
import { appOrganization } from "#/platform/control-plane-d1/OrganizationRootSchema";

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

/** Additive organization audit stream while the retained V1 table cannot be rebuilt. */
export const appOrganizationAdministrativeAuditEvent = sqliteTable(
  "app_organization_administrative_audit_event",
  {
    storageId: integer("storage_id").primaryKey({ autoIncrement: true }),
    eventId: text("event_id").notNull().unique(),
    schemaVersion: integer("schema_version").notNull(),
    eventVersion: integer("event_version").notNull(),
    operationId: text("operation_id").notNull().unique(),
    action: text("action", {
      enum: ["organization.suspend", "organization.resume"],
    }).notNull(),
    actorId: text("actor_id").notNull(),
    organizationId: text("organization_id").notNull(),
    reasonCode: text("reason_code", {
      enum: ["organization-suspended", "organization-resumed"],
    }).notNull(),
    changeType: text("change_type", {
      enum: ["organization-suspended", "organization-resumed"],
    }).notNull(),
    resourceVersionBefore: integer("resource_version_before").notNull(),
    resourceVersionAfter: integer("resource_version_after").notNull(),
    requestId: text("request_id").notNull(),
    correlationId: text("correlation_id").notNull(),
    occurredAt: integer("occurred_at").notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId],
      foreignColumns: [appOrganization.id],
      name: "app_organization_administrative_audit_organization_fk",
    })
      .onUpdate("restrict")
      .onDelete("restrict"),
    foreignKey({
      columns: [t.actorId],
      foreignColumns: [authUser.id],
      name: "app_organization_administrative_audit_actor_fk",
    })
      .onUpdate("restrict")
      .onDelete("restrict"),
    check(
      "app_organization_administrative_audit_event_id_check",
      sql`length(event_id) = 83
        and substr(event_id, 1, 19) = 'admin-audit-sha256:'
        and substr(event_id, 20) not glob '*[^0-9a-f]*'`
    ),
    check(
      "app_organization_administrative_audit_operation_id_check",
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
      "app_organization_administrative_audit_semantics_check",
      sql`schema_version = 1
        and event_version = 1
        and length(actor_id) between 1 and 128
        and actor_id = trim(actor_id)
        and length(organization_id) between 1 and 128
        and organization_id not glob '*[^A-Za-z0-9_-]*'
        and typeof(resource_version_before) = 'integer'
        and resource_version_before between 1 and 9007199254740990
        and typeof(resource_version_after) = 'integer'
        and resource_version_after = resource_version_before + 1
        and typeof(occurred_at) = 'integer'
        and occurred_at between 0 and 9007199254740991
        and length(request_id) = 36
        and request_id = lower(trim(request_id))
        and substr(request_id, 9, 1) = '-'
        and substr(request_id, 14, 1) = '-'
        and substr(request_id, 15, 1) = '4'
        and substr(request_id, 19, 1) = '-'
        and substr(request_id, 20, 1) in ('8', '9', 'a', 'b')
        and substr(request_id, 24, 1) = '-'
        and length(replace(request_id, '-', '')) = 32
        and replace(request_id, '-', '') not glob '*[^0-9a-f]*'
        and length(correlation_id) = 36
        and correlation_id = lower(trim(correlation_id))
        and substr(correlation_id, 9, 1) = '-'
        and substr(correlation_id, 14, 1) = '-'
        and substr(correlation_id, 15, 1) = '4'
        and substr(correlation_id, 19, 1) = '-'
        and substr(correlation_id, 20, 1) in ('8', '9', 'a', 'b')
        and substr(correlation_id, 24, 1) = '-'
        and length(replace(correlation_id, '-', '')) = 32
        and replace(correlation_id, '-', '') not glob '*[^0-9a-f]*'
        and ((action = 'organization.suspend'
          and reason_code = 'organization-suspended'
          and change_type = 'organization-suspended')
        or (action = 'organization.resume'
          and reason_code = 'organization-resumed'
          and change_type = 'organization-resumed'))`
    ),
    index("app_organization_administrative_audit_tenant_time_idx").on(
      t.organizationId,
      sql`${t.occurredAt} desc`,
      sql`${t.storageId} desc`
    ),
    index("app_organization_administrative_audit_actor_time_idx").on(
      t.actorId,
      sql`${t.occurredAt} desc`,
      sql`${t.storageId} desc`
    ),
  ]
);
