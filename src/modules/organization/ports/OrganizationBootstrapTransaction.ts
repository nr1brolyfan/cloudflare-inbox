import type * as AuthPermission from "@effect-auth/core/Permission";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { MailboxRecord } from "#/modules/organization/domain/Mailbox";
import { MailboxDisplayName } from "#/modules/organization/domain/Mailbox";
import { CanonicalMailDomain } from "#/modules/organization/domain/MailDomain";
import { NormalizedEmailAddress } from "#/shared/EmailAddress";
import { AdministrativeOperationId } from "#/shared/Operation";
import type { CurrentRequestAuth } from "#/shared/RequestAuth";
import type { RequestCorrelation } from "#/shared/RequestCorrelation";

export const TrustedBootstrapOrganizationCommand = Schema.Struct({
  acknowledgedRecoveryCodeRotationOperationId: Schema.optional(
    AdministrativeOperationId
  ),
  displayName: MailboxDisplayName,
  initialAddress: NormalizedEmailAddress,
  initialDomain: CanonicalMailDomain,
  operationId: AdministrativeOperationId,
  ownerEmailAllowlist: Schema.Array(NormalizedEmailAddress),
});
export type TrustedBootstrapOrganizationCommand = Schema.Schema.Type<
  typeof TrustedBootstrapOrganizationCommand
>;

export interface OrganizationBootstrapTransactionError {
  readonly cause?: unknown;
  readonly commitState?: "committed" | "not-committed" | "unknown";
  readonly message: string;
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
}

export interface OrganizationBootstrapTransactionService {
  readonly bootstrap: (
    input: TrustedBootstrapOrganizationCommand
  ) => Effect.Effect<
    MailboxRecord,
    OrganizationBootstrapTransactionError,
    AuthPermission.CurrentPrincipal | CurrentRequestAuth | RequestCorrelation
  >;
}

/** Atomic organization bootstrap supplied by a persistence adapter. */
export class OrganizationBootstrapTransaction extends Context.Service<
  OrganizationBootstrapTransaction,
  OrganizationBootstrapTransactionService
>()("cloudflare-inbox/OrganizationBootstrapTransaction") {}
