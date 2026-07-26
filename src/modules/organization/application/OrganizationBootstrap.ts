/* oxlint-disable max-classes-per-file -- Bootstrap command, error, and service form one cohesive use case. */
import type * as AuthPermission from "@effect-auth/core/Permission";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import type { MailboxRecord } from "#/modules/organization/domain/Mailbox";
import { MailboxDisplayName } from "#/modules/organization/domain/Mailbox";
import { OrganizationBootstrapTransaction } from "#/modules/organization/ports/OrganizationBootstrapTransaction";
import type { OrganizationBootstrapTransactionError } from "#/modules/organization/ports/OrganizationBootstrapTransaction";
import { AdministrativeOperationId } from "#/shared/Operation";
import type { CurrentRequestAuth } from "#/shared/RequestAuth";
import type { RequestCorrelation } from "#/shared/RequestCorrelation";

import { MailboxBootstrapConfig } from "../contracts/MailboxBootstrapConfig";

export const BootstrapOrganizationCommand = Schema.Struct({
  acknowledgedRecoveryCodeRotationOperationId: Schema.optional(
    AdministrativeOperationId
  ),
  actorUserId: Schema.optional(Schema.Never),
  displayName: MailboxDisplayName,
  initialAddress: Schema.optional(Schema.Never),
  initialDomain: Schema.optional(Schema.Never),
  mailboxId: Schema.optional(Schema.Never),
  operationId: AdministrativeOperationId,
  organizationId: Schema.optional(Schema.Never),
  ownerEmailAllowlist: Schema.optional(Schema.Never),
  ownerUserId: Schema.optional(Schema.Never),
  protocol: Schema.optional(Schema.Never),
  protocolGeneration: Schema.optional(Schema.Never),
  protocolMarker: Schema.optional(Schema.Never),
  protocolVersion: Schema.optional(Schema.Never),
  passkeyCount: Schema.optional(Schema.Never),
  recoveryCodeCount: Schema.optional(Schema.Never),
  recoveryReady: Schema.optional(Schema.Never),
  securitySetupReady: Schema.optional(Schema.Never),
});
export type BootstrapOrganizationCommand = Schema.Schema.Type<
  typeof BootstrapOrganizationCommand
>;

export class OrganizationBootstrapError extends Data.TaggedError(
  "OrganizationBootstrapError"
)<{
  readonly cause?: unknown;
  readonly commitState?: "committed" | "not-committed" | "unknown";
  readonly message: string;
  readonly operation: "bootstrap-owner";
  readonly permission?: AuthPermission.PermissionId;
  readonly reason:
    | "authorization-recheck"
    | "conflict"
    | "invalid-input"
    | "not-found"
    | "operation-conflict"
    | "owner-not-eligible"
    | "security-setup-required"
    | "session-recheck"
    | "step-up-required"
    | "storage";
  readonly scope?: AuthPermission.PermissionScope;
}> {}

const mapBootstrapError = (error: OrganizationBootstrapTransactionError) =>
  new OrganizationBootstrapError({
    cause: error.cause,
    commitState: error.commitState,
    message: error.message,
    operation: "bootstrap-owner",
    permission: error.permission,
    reason: error.reason,
    scope: error.scope,
  });

export interface OrganizationBootstrapService {
  // Actor authority remains request context; callers provide only bootstrap intent.
  readonly bootstrap: (
    input: BootstrapOrganizationCommand
  ) => Effect.Effect<
    MailboxRecord,
    OrganizationBootstrapError,
    AuthPermission.CurrentPrincipal | CurrentRequestAuth | RequestCorrelation
  >;
}

export class OrganizationBootstrap extends Context.Service<
  OrganizationBootstrap,
  OrganizationBootstrapService
>()("cloudflare-inbox/OrganizationBootstrap", {
  make: Effect.gen(function* () {
    const config = yield* MailboxBootstrapConfig;
    const transaction = yield* OrganizationBootstrapTransaction;

    return {
      bootstrap: (input) =>
        transaction
          .bootstrap({
            ...(input.acknowledgedRecoveryCodeRotationOperationId === undefined
              ? {}
              : {
                  acknowledgedRecoveryCodeRotationOperationId:
                    input.acknowledgedRecoveryCodeRotationOperationId,
                }),
            displayName: input.displayName,
            initialAddress: config.initialAddress,
            initialDomain: config.initialDomain,
            operationId: input.operationId,
            ownerEmailAllowlist: config.ownerEmailAllowlist,
          })
          .pipe(Effect.mapError(mapBootstrapError)),
    } satisfies OrganizationBootstrapService;
  }),
}) {
  static readonly layerNoDeps = Layer.effect(this, this.make);

  static readonly mockLayer = Layer.mock(this, {
    bootstrap: () => Effect.die("Unexpected organization bootstrap"),
  });
}
