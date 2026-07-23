/* oxlint-disable max-classes-per-file -- Audit event and its application service form one cohesive boundary. */
import { UserIdSchema } from "@effect-auth/core/Identifiers";
import * as AuthPermission from "@effect-auth/core/Permission";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { ExternalRecoveryIdentityId } from "#/modules/account-security/domain/ExternalRecoveryIdentity";
import { CurrentRequestAuth } from "#/modules/account-security/ports/CurrentRequestAuth";
import { AdministrativeAuditRuntime } from "#/modules/administrative-audit/ports/AdministrativeAuditRuntime";
import { MailboxId, Version } from "#/modules/mailbox/domain/Mailbox";
import {
  BackendCorrelationId,
  BackendRequestId,
  CurrentBackendRequestContext,
} from "#/shared/BackendRequestContext";
import type { BackendRequestContext } from "#/shared/BackendRequestContext";
import { AdministrativeOperationId } from "#/shared/Operation";
import { UnixMillis } from "#/shared/Temporal";

import { AdministrativeAuditError } from "./AdministrativeAuditError";

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

export interface AdministrativeAuditShape {
  readonly prepare: (
    input: PrepareAdministrativeAuditEvent
  ) => Effect.Effect<
    AdministrativeAuditEvent,
    AdministrativeAuditError,
    AuthPermission.CurrentPrincipal | BackendRequestContext | CurrentRequestAuth
  >;
}

const eventDetails = (input: PrepareAdministrativeAuditEvent) => {
  if (input._tag === "MailboxBootstrapped") {
    return {
      action: "mailbox.owner-bootstrap" as const,
      change: {
        _tag: "MailboxBootstrapped" as const,
        afterVersion: Schema.decodeUnknownSync(Version)(1),
      },
      reasonCode: "owner-bootstrap" as const,
      resource: { _tag: "Mailbox" as const, id: input.mailboxId },
      tenantScope: {
        _tag: "LegacyMailbox" as const,
        mailboxId: input.mailboxId,
      },
    };
  }
  if (input._tag === "MailboxRenamed") {
    return {
      action: "mailbox.rename" as const,
      change: {
        _tag: "MailboxRenamed" as const,
        afterVersion: Schema.decodeUnknownSync(Version)(
          input.beforeVersion + 1
        ),
        beforeVersion: input.beforeVersion,
        changedField: "displayName" as const,
      },
      reasonCode: "mailbox-renamed" as const,
      resource: { _tag: "Mailbox" as const, id: input.mailboxId },
      tenantScope: {
        _tag: "LegacyMailbox" as const,
        mailboxId: input.mailboxId,
      },
    };
  }
  if (input._tag === "ExternalRecoveryIdentityEnrolled") {
    return {
      action: "external-recovery-identity.enroll" as const,
      change: {
        _tag: "ExternalRecoveryIdentityEnrolled" as const,
        afterVersion: Schema.decodeUnknownSync(Version)(1),
      },
      reasonCode: "recovery-enrolled" as const,
      resource: {
        _tag: "ExternalRecoveryIdentity" as const,
        id: input.identityId,
      },
      tenantScope: { _tag: "Global" as const },
    };
  }
  if (input._tag === "ExternalRecoveryIdentityVerified") {
    return {
      action: "external-recovery-identity.verify" as const,
      change: {
        _tag: "ExternalRecoveryIdentityVerified" as const,
        afterVersion: Schema.decodeUnknownSync(Version)(
          input.beforeVersion + 1
        ),
        beforeVersion: input.beforeVersion,
      },
      reasonCode: "recovery-verified" as const,
      resource: {
        _tag: "ExternalRecoveryIdentity" as const,
        id: input.identityId,
      },
      tenantScope: { _tag: "Global" as const },
    };
  }
  return {
    action: "external-recovery-identity.revoke" as const,
    change: {
      _tag: "ExternalRecoveryIdentityRevoked" as const,
      afterVersion: Schema.decodeUnknownSync(Version)(input.beforeVersion + 1),
      beforeVersion: input.beforeVersion,
    },
    reasonCode: "recovery-revoked" as const,
    resource: {
      _tag: "ExternalRecoveryIdentity" as const,
      id: input.identityId,
    },
    tenantScope: { _tag: "Global" as const },
  };
};

/** Prepares immutable audit metadata; concrete mutation adapters persist it atomically. */
export class AdministrativeAudit extends Context.Service<
  AdministrativeAudit,
  AdministrativeAuditShape
>()("cloudflare-inbox/AdministrativeAudit", {
  make: Effect.gen(function* () {
    const runtime = yield* AdministrativeAuditRuntime;

    return {
      prepare: (input) =>
        Effect.gen(function* () {
          const principal = yield* AuthPermission.CurrentPrincipal;
          const requestAuth = yield* CurrentRequestAuth;
          const requestContext = yield* CurrentBackendRequestContext;
          if (
            principal.type !== "user" ||
            principal.id !== requestAuth.validated.actor.userId
          ) {
            return yield* new AdministrativeAuditError({
              cause: new Error("Administrative audit actor contexts differ"),
              reason: "invalid-context",
            });
          }

          const details = eventDetails(input);
          const digest = yield* runtime
            .digestSha256(
              JSON.stringify([
                1,
                input.operationId,
                details.action,
                details.resource._tag,
                details.resource.id,
                "succeeded",
              ])
            )
            .pipe(
              Effect.mapError(
                (cause) =>
                  new AdministrativeAuditError({ cause, reason: "digest" })
              )
            );
          const eventId = Schema.decodeUnknownSync(AdministrativeAuditEventId)(
            `admin-audit-sha256:${digest}`
          );

          return yield* Schema.decodeUnknownEffect(
            AdministrativeAuditEventSchema
          )({
            ...details,
            actor: { id: principal.id, type: "user" },
            eventId,
            eventVersion: 1,
            occurredAt: input.occurredAt,
            operationId: input.operationId,
            outcome: "succeeded",
            requestContext: {
              correlationId: requestContext.correlationId,
              requestId: requestContext.requestId,
            },
            schemaVersion: 1,
          }).pipe(
            Effect.mapError(
              (cause) =>
                new AdministrativeAuditError({
                  cause,
                  reason: "invalid-event",
                })
            )
          );
        }),
    } satisfies AdministrativeAuditShape;
  }),
}) {
  static readonly layerNoDeps = Layer.effect(this, this.make);
}
