/* oxlint-disable max-classes-per-file -- The port and its closed storage error form one boundary contract. */
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { CanonicalMailDomain } from "#/modules/organization/domain/MailDomain";
import type { MailDomainClaimReceipt } from "#/modules/organization/domain/MailDomain";

export const MaterializeLegacyMailDomainClaim = Schema.Struct({
  canonicalDomain: CanonicalMailDomain,
  effectiveAt: Schema.Number,
  normalizedAddressSnapshot: Schema.String,
  rawAddressSnapshot: Schema.String,
  sourceAuditEventId: Schema.optional(Schema.String),
  sourceBootstrapOperationId: Schema.optional(Schema.String),
});
export type MaterializeLegacyMailDomainClaim = Schema.Schema.Type<
  typeof MaterializeLegacyMailDomainClaim
>;

export interface LegacyMailDomainClaimSnapshot {
  readonly ancestry: readonly Record<string, unknown>[];
  readonly bootstrapDomainIntents: readonly Record<string, unknown>[];
  readonly bootstrapIntents: readonly Record<string, unknown>[];
  readonly bootstrapReceipts: readonly Record<string, unknown>[];
  readonly claimCutovers: readonly Record<string, unknown>[];
  readonly claimReceipts: readonly Record<string, unknown>[];
  readonly domains: readonly Record<string, unknown>[];
  readonly bootstrapAudits: readonly Record<string, unknown>[];
  readonly mailboxes: readonly Record<string, unknown>[];
  readonly mailboxOrganizationGeneration: readonly Record<string, unknown>[];
  readonly organizations: readonly Record<string, unknown>[];
  readonly ownerAssignments: readonly Record<string, unknown>[];
  readonly routes: readonly Record<string, unknown>[];
}

export class LegacyMailDomainClaimStoreError extends Data.TaggedError(
  "LegacyMailDomainClaimStoreError"
)<{ readonly cause?: unknown }> {}

export class LegacyMailDomainClaimStore extends Context.Service<
  LegacyMailDomainClaimStore,
  {
    readonly inspect: Effect.Effect<
      LegacyMailDomainClaimSnapshot,
      LegacyMailDomainClaimStoreError
    >;
    readonly materialize: (
      command: MaterializeLegacyMailDomainClaim
    ) => Effect.Effect<MailDomainClaimReceipt, LegacyMailDomainClaimStoreError>;
  }
>()("cloudflare-inbox/LegacyMailDomainClaimStore") {}
