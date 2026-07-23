import * as AuthPermission from "@effect-auth/core/Permission";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { Version } from "#/modules/mailbox/domain/Mailbox";

import { CurrentRequestAuth } from "../auth/session";
import { CurrentBackendRequestContext } from "../observability/request-context";
import {
  AdministrativeAudit,
  AdministrativeAuditEventId,
  AdministrativeAuditEventSchema,
} from "./administrative-audit";
import type { PrepareAdministrativeAuditEvent } from "./administrative-audit";
import { AdministrativeAuditError } from "./administrative-audit-error";

export interface AdministrativeAuditRuntimeShape {
  readonly digestSha256: (value: string) => Effect.Effect<string, unknown>;
}

export const AdministrativeAuditRuntime =
  Context.Service<AdministrativeAuditRuntimeShape>(
    "cloudflare-inbox/AdministrativeAuditRuntime"
  );

export const AdministrativeAuditRuntimeLive = Layer.succeed(
  AdministrativeAuditRuntime,
  AdministrativeAuditRuntime.of({
    digestSha256: (value) =>
      Effect.promise(() =>
        crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
      ).pipe(
        Effect.map((digest) =>
          [...new Uint8Array(digest)]
            .map((byte) => byte.toString(16).padStart(2, "0"))
            .join("")
        )
      ),
  })
);

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

export const AdministrativeAuditLive = Layer.effect(
  AdministrativeAudit,
  Effect.gen(function* () {
    const runtime = yield* AdministrativeAuditRuntime;

    return AdministrativeAudit.of({
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
    });
  })
);
