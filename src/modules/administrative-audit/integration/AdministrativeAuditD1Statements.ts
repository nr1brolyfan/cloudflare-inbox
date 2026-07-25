import { eq, sql } from "drizzle-orm";

import {
  appAdministrativeAuditEvent,
  appOrganizationAdministrativeAuditEvent,
} from "#/modules/administrative-audit/adapters/d1/AdministrativeAuditSchema";
import type { AdministrativeAuditEvent } from "#/modules/administrative-audit/contracts/AdministrativeAudit";
import { appAuthorizationGuard } from "#/platform/control-plane-d1/AuthorizationGuardSchema";
import type { ControlPlaneStatement } from "#/platform/control-plane-d1/ControlPlaneBatch";
import type { ControlPlaneDatabase } from "#/platform/control-plane-d1/ControlPlaneDatabase";

/** Stable foreign-key target for collaborating control-plane schemas. */
export const administrativeAuditEventIdReference = () =>
  appAdministrativeAuditEvent.eventId;
export const organizationAdministrativeAuditEventIdReference = () =>
  appOrganizationAdministrativeAuditEvent.eventId;

const resourceVersionBefore = (event: AdministrativeAuditEvent) =>
  "beforeVersion" in event.change ? event.change.beforeVersion : null;

const resourceVersionAfter = (event: AdministrativeAuditEvent) =>
  event.change.afterVersion;

const changeType = (event: AdministrativeAuditEvent) => {
  const types = {
    ExternalRecoveryIdentityEnrolled: "external-recovery-identity-enrolled",
    ExternalRecoveryIdentityRevoked: "external-recovery-identity-revoked",
    ExternalRecoveryIdentityVerified: "external-recovery-identity-verified",
    MailboxBootstrapped: "mailbox-bootstrapped",
    MailboxRenamed: "mailbox-renamed",
    OrganizationResumed: "organization-resumed",
    OrganizationSuspended: "organization-suspended",
  } as const;
  return types[event.change._tag];
};

const tenantScope = (event: AdministrativeAuditEvent) =>
  event.tenantScope._tag === "Global"
    ? ({ id: "global", type: "global" } as const)
    : event.tenantScope._tag === "LegacyMailbox"
      ? ({
          id: event.tenantScope.mailboxId,
          type: "legacy-mailbox",
        } as const)
      : ({
          id: event.tenantScope.organizationId,
          type: "organization",
        } as const);

const resource = (event: AdministrativeAuditEvent) =>
  event.resource._tag === "Mailbox"
    ? ({ id: event.resource.id, type: "mailbox" } as const)
    : ({
        id: event.resource.id,
        type: "external-recovery-identity",
      } as const);

/** Audit insert kept in the caller's guarded, ordered D1 batch. */
export const administrativeAuditInsertStatement = (
  database: ControlPlaneDatabase,
  event: AdministrativeAuditEvent,
  authorizationGuardNonce: string
): ControlPlaneStatement => {
  if (
    event.resource._tag === "Organization" &&
    event.tenantScope._tag === "Organization"
  ) {
    return database.insert(appOrganizationAdministrativeAuditEvent).select(
      database
        .select({
          action: sql`${event.action}`.as("action"),
          actorId: sql`${event.actor.id}`.as("actor_id"),
          changeType: sql`${changeType(event)}`.as("change_type"),
          correlationId: sql`${event.requestContext.correlationId}`.as(
            "correlation_id"
          ),
          eventId: sql`${event.eventId}`.as("event_id"),
          eventVersion: sql`${event.eventVersion}`.as("event_version"),
          occurredAt: sql`${event.occurredAt}`.as("occurred_at"),
          operationId: sql`${event.operationId}`.as("operation_id"),
          organizationId: sql`${event.resource.id}`.as("organization_id"),
          reasonCode: sql`${event.reasonCode}`.as("reason_code"),
          requestId: sql`${event.requestContext.requestId}`.as("request_id"),
          resourceVersionAfter: sql`${resourceVersionAfter(event)}`.as(
            "resource_version_after"
          ),
          resourceVersionBefore: sql`${resourceVersionBefore(event)}`.as(
            "resource_version_before"
          ),
          schemaVersion: sql`${event.schemaVersion}`.as("schema_version"),
        })
        .from(appAuthorizationGuard)
        .where(eq(appAuthorizationGuard.nonce, authorizationGuardNonce))
    );
  }
  const eventResource = resource(event);
  const eventTenantScope = tenantScope(event);
  return database.insert(appAdministrativeAuditEvent).select(
    database
      .select({
        action: sql`${event.action}`.as("action"),
        actorId: sql`${event.actor.id}`.as("actor_id"),
        actorType: sql`${event.actor.type}`.as("actor_type"),
        changeType: sql`${changeType(event)}`.as("change_type"),
        correlationId: sql`${event.requestContext.correlationId}`.as(
          "correlation_id"
        ),
        eventId: sql`${event.eventId}`.as("event_id"),
        eventVersion: sql`${event.eventVersion}`.as("event_version"),
        occurredAt: sql`${event.occurredAt}`.as("occurred_at"),
        operationId: sql`${event.operationId}`.as("operation_id"),
        outcome: sql`${event.outcome}`.as("outcome"),
        reasonCode: sql`${event.reasonCode}`.as("reason_code"),
        requestId: sql`${event.requestContext.requestId}`.as("request_id"),
        resourceId: sql`${eventResource.id}`.as("resource_id"),
        resourceType: sql`${eventResource.type}`.as("resource_type"),
        resourceVersionAfter: sql`${resourceVersionAfter(event)}`.as(
          "resource_version_after"
        ),
        resourceVersionBefore: sql`${resourceVersionBefore(event)}`.as(
          "resource_version_before"
        ),
        schemaVersion: sql`${event.schemaVersion}`.as("schema_version"),
        tenantScopeId: sql`${eventTenantScope.id}`.as("tenant_scope_id"),
        tenantScopeType: sql`${eventTenantScope.type}`.as("tenant_scope_type"),
      })
      .from(appAuthorizationGuard)
      .where(eq(appAuthorizationGuard.nonce, authorizationGuardNonce))
  );
};
