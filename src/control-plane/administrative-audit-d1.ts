import type { AdministrativeAuditEvent } from "../audit/administrative-audit";
import type { ControlPlaneStatement } from "./batch";

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
  } as const;
  return types[event.change._tag];
};

const tenantScope = (event: AdministrativeAuditEvent) =>
  event.tenantScope._tag === "Global"
    ? ({ id: "global", type: "global" } as const)
    : ({
        id: event.tenantScope.mailboxId,
        type: "legacy-mailbox",
      } as const);

const resource = (event: AdministrativeAuditEvent) =>
  event.resource._tag === "Mailbox"
    ? ({ id: event.resource.id, type: "mailbox" } as const)
    : ({
        id: event.resource.id,
        type: "external-recovery-identity",
      } as const);

/** Storage-private encoding inserted in the same guarded D1 batch as the mutation. */
export const administrativeAuditInsertStatement = (
  event: AdministrativeAuditEvent,
  authorizationGuardNonce: string
): ControlPlaneStatement => {
  const eventResource = resource(event);
  const eventTenantScope = tenantScope(event);
  return {
    sql: `insert into app_administrative_audit_event
            (event_id, schema_version, event_version, operation_id, action,
             outcome, actor_type, actor_id, tenant_scope_type, tenant_scope_id,
             resource_type, resource_id, request_id, correlation_id,
             reason_code, change_type, resource_version_before,
             resource_version_after, occurred_at)
          select ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
            from app_authorization_guard
           where nonce = ?`,
    params: [
      event.eventId,
      event.schemaVersion,
      event.eventVersion,
      event.operationId,
      event.action,
      event.outcome,
      event.actor.type,
      event.actor.id,
      eventTenantScope.type,
      eventTenantScope.id,
      eventResource.type,
      eventResource.id,
      event.requestContext.requestId,
      event.requestContext.correlationId,
      event.reasonCode,
      changeType(event),
      resourceVersionBefore(event),
      resourceVersionAfter(event),
      event.occurredAt,
      authorizationGuardNonce,
    ],
  };
};
