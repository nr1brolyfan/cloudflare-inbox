import { UserIdSchema } from "@effect-auth/core/Identifiers";
import type * as AuthPermission from "@effect-auth/core/Permission";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { ExternalRecoveryIdentityId } from "../auth/external-recovery-identity";
import type { CurrentRequestAuthShape } from "../auth/session";
import {
  AdministrativeOperationId,
  MailboxId,
  UnixMillis,
  Version,
} from "../mailboxes/core";
import {
  BackendCorrelationId,
  BackendRequestId,
} from "../observability/request-context";
import type { BackendRequestContext } from "../observability/request-context";
import type { AdministrativeAuditError } from "./administrative-audit-error";

export const AdministrativeAuditEventId = Schema.String.pipe(
  Schema.check(
    Schema.isLengthBetween(83, 83),
    Schema.isPattern(/^admin-audit-sha256:[0-9a-f]{64}$/u)
  ),
  Schema.brand("cloudflare-inbox/AdministrativeAuditEventId")
);
export type AdministrativeAuditEventId = Schema.Schema.Type<
  typeof AdministrativeAuditEventId
>;

export const AdministrativeAuditAction = Schema.Literals([
  "external-recovery-identity.enroll",
  "external-recovery-identity.revoke",
  "external-recovery-identity.verify",
  "mailbox.owner-bootstrap",
  "mailbox.rename",
]);
export type AdministrativeAuditAction = Schema.Schema.Type<
  typeof AdministrativeAuditAction
>;

export const AdministrativeAuditReasonCode = Schema.Literals([
  "mailbox-renamed",
  "owner-bootstrap",
  "recovery-enrolled",
  "recovery-revoked",
  "recovery-verified",
]);

const AdministrativeAuditActor = Schema.Struct({
  id: UserIdSchema,
  type: Schema.Literal("user"),
});

const AdministrativeAuditTenantScope = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("Global"),
  }),
  Schema.Struct({
    _tag: Schema.Literal("LegacyMailbox"),
    mailboxId: MailboxId,
  }),
]);

const AdministrativeAuditResource = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("ExternalRecoveryIdentity"),
    id: ExternalRecoveryIdentityId,
  }),
  Schema.Struct({
    _tag: Schema.Literal("Mailbox"),
    id: MailboxId,
  }),
]);

const AdministrativeAuditChange = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("ExternalRecoveryIdentityEnrolled"),
    afterVersion: Version,
  }),
  Schema.Struct({
    _tag: Schema.Literal("ExternalRecoveryIdentityRevoked"),
    afterVersion: Version,
    beforeVersion: Version,
  }),
  Schema.Struct({
    _tag: Schema.Literal("ExternalRecoveryIdentityVerified"),
    afterVersion: Version,
    beforeVersion: Version,
  }),
  Schema.Struct({
    _tag: Schema.Literal("MailboxBootstrapped"),
    afterVersion: Version,
  }),
  Schema.Struct({
    _tag: Schema.Literal("MailboxRenamed"),
    afterVersion: Version,
    beforeVersion: Version,
    changedField: Schema.Literal("displayName"),
  }),
]);

const AdministrativeAuditRequestContext = Schema.Struct({
  correlationId: BackendCorrelationId,
  requestId: BackendRequestId,
});

export class AdministrativeAuditEvent extends Schema.Class<AdministrativeAuditEvent>(
  "cloudflare-inbox/AdministrativeAuditEvent"
)({
  action: AdministrativeAuditAction,
  actor: AdministrativeAuditActor,
  change: AdministrativeAuditChange,
  eventId: AdministrativeAuditEventId,
  eventVersion: Schema.Literal(1),
  occurredAt: UnixMillis,
  operationId: AdministrativeOperationId,
  outcome: Schema.Literal("succeeded"),
  reasonCode: AdministrativeAuditReasonCode,
  requestContext: AdministrativeAuditRequestContext,
  resource: AdministrativeAuditResource,
  schemaVersion: Schema.Literal(1),
  tenantScope: AdministrativeAuditTenantScope,
}) {}

const administrativeAuditSemantics: Readonly<
  Record<
    AdministrativeAuditAction,
    (event: AdministrativeAuditEvent) => boolean
  >
> = {
  "mailbox.owner-bootstrap": (event) =>
    event.resource._tag === "Mailbox" &&
    event.tenantScope._tag === "LegacyMailbox" &&
    event.tenantScope.mailboxId === event.resource.id &&
    event.reasonCode === "owner-bootstrap" &&
    event.change._tag === "MailboxBootstrapped" &&
    event.change.afterVersion === 1,
  "mailbox.rename": (event) =>
    event.resource._tag === "Mailbox" &&
    event.tenantScope._tag === "LegacyMailbox" &&
    event.tenantScope.mailboxId === event.resource.id &&
    event.reasonCode === "mailbox-renamed" &&
    event.change._tag === "MailboxRenamed" &&
    event.change.afterVersion === event.change.beforeVersion + 1,
  "external-recovery-identity.enroll": (event) =>
    event.resource._tag === "ExternalRecoveryIdentity" &&
    event.tenantScope._tag === "Global" &&
    event.reasonCode === "recovery-enrolled" &&
    event.change._tag === "ExternalRecoveryIdentityEnrolled" &&
    event.change.afterVersion === 1,
  "external-recovery-identity.verify": (event) =>
    event.resource._tag === "ExternalRecoveryIdentity" &&
    event.tenantScope._tag === "Global" &&
    event.reasonCode === "recovery-verified" &&
    event.change._tag === "ExternalRecoveryIdentityVerified" &&
    event.change.afterVersion === event.change.beforeVersion + 1,
  "external-recovery-identity.revoke": (event) =>
    event.resource._tag === "ExternalRecoveryIdentity" &&
    event.tenantScope._tag === "Global" &&
    event.reasonCode === "recovery-revoked" &&
    event.change._tag === "ExternalRecoveryIdentityRevoked" &&
    event.change.afterVersion === event.change.beforeVersion + 1,
};

export const AdministrativeAuditEventSchema = AdministrativeAuditEvent.check(
  Schema.makeFilter((event) =>
    administrativeAuditSemantics[event.action](event)
      ? undefined
      : "administrative audit semantics are inconsistent"
  )
);

export const PrepareAdministrativeAuditEvent = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("ExternalRecoveryIdentityEnrolled"),
    identityId: ExternalRecoveryIdentityId,
    occurredAt: UnixMillis,
    operationId: AdministrativeOperationId,
  }),
  Schema.Struct({
    _tag: Schema.Literal("ExternalRecoveryIdentityRevoked"),
    beforeVersion: Version,
    identityId: ExternalRecoveryIdentityId,
    occurredAt: UnixMillis,
    operationId: AdministrativeOperationId,
  }),
  Schema.Struct({
    _tag: Schema.Literal("ExternalRecoveryIdentityVerified"),
    beforeVersion: Version,
    identityId: ExternalRecoveryIdentityId,
    occurredAt: UnixMillis,
    operationId: AdministrativeOperationId,
  }),
  Schema.Struct({
    _tag: Schema.Literal("MailboxBootstrapped"),
    mailboxId: MailboxId,
    occurredAt: UnixMillis,
    operationId: AdministrativeOperationId,
  }),
  Schema.Struct({
    _tag: Schema.Literal("MailboxRenamed"),
    beforeVersion: Version,
    mailboxId: MailboxId,
    occurredAt: UnixMillis,
    operationId: AdministrativeOperationId,
  }),
]);
export type PrepareAdministrativeAuditEvent = Schema.Schema.Type<
  typeof PrepareAdministrativeAuditEvent
>;

export interface AdministrativeAudit {
  readonly prepare: (
    input: PrepareAdministrativeAuditEvent
  ) => Effect.Effect<
    AdministrativeAuditEvent,
    AdministrativeAuditError,
    | AuthPermission.CurrentPrincipal
    | BackendRequestContext
    | CurrentRequestAuthShape
  >;
}

/** Prepares immutable audit metadata; concrete mutation adapters persist it atomically. */
export const AdministrativeAudit = Context.Service<AdministrativeAudit>(
  "cloudflare-inbox/AdministrativeAudit"
);
