/* oxlint-disable max-classes-per-file -- Startup result, error, and service form one closed protocol. */
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { MailboxBootstrapConfig } from "#/modules/organization/contracts/MailboxBootstrapConfig";
import {
  LEGACY_DEFAULT_MAIL_DOMAIN_ID,
  MAIL_DOMAIN_CANONICALIZATION_PROFILE_ID,
  MailDomainClaimReceipt,
  MailDomainSchema,
  canonicalizeMailDomainV1,
} from "#/modules/organization/domain/MailDomain";
import { LEGACY_DEFAULT_ORGANIZATION_ID } from "#/modules/organization/domain/Organization";
import { OrganizationOwnerAssignmentReceiptSchema } from "#/modules/organization/domain/OrganizationOwnerAssignment";
import { LegacyMailDomainClaimStore } from "#/modules/organization/ports/LegacyMailDomainClaimStore";
import {
  EmailAddress,
  NormalizedEmailAddress,
  normalizeEmailAddressDomain,
} from "#/shared/EmailAddress";

const PrimaryRouteRow = Schema.Struct({
  address: EmailAddress,
  id: Schema.Literal("primary"),
  createdAt: Schema.Number,
  enabled: Schema.Literal(1),
  isPrimary: Schema.Literal(1),
  mailboxId: Schema.Literal("primary"),
  normalizedAddress: NormalizedEmailAddress,
  updatedAt: Schema.Number,
  version: Schema.Literal(1),
});
const AncestryRow = Schema.Struct({
  effectiveAt: Schema.Number,
  mailboxId: Schema.Literal("primary"),
  organizationId: Schema.Literal("legacy_default_v1"),
  schemaVersion: Schema.Literal(1),
  source: Schema.Literals(["legacy-cutover", "fresh-bootstrap"]),
});
const BootstrapReceiptRow = Schema.Struct({
  actorUserId: Schema.String,
  committedAt: Schema.Number,
  expectedVersion: Schema.Null,
  mailboxId: Schema.Literal("primary"),
  operationId: Schema.String,
  operationKind: Schema.Literal("bootstrap-owner"),
  resultCreatedAt: Schema.Number,
  resultCreatedByUserId: Schema.String,
  resultMailboxId: Schema.Literal("primary"),
  resultUpdatedAt: Schema.Number,
  resultVersion: Schema.Literal(1),
  schemaVersion: Schema.Literal(1),
});
const BootstrapIntentRow = Schema.Struct({
  initialAddress: NormalizedEmailAddress,
  operationId: Schema.String,
  schemaVersion: Schema.Number,
});
const BootstrapDomainIntentRow = Schema.Struct({
  canonicalDomain: Schema.String,
  canonicalizationProfileId: Schema.String,
  canonicalizationVersion: Schema.Number,
  operationId: Schema.String,
  schemaVersion: Schema.Number,
});
const ClaimCutoverRow = Schema.Struct({
  id: Schema.Literal(1),
  initialOutcome: Schema.Literals([
    "fresh-empty",
    "legacy-awaiting-reconciliation",
    "already-bootstrapped-awaiting-reconciliation",
    "complete-pair",
  ]),
  initialStatus: Schema.Literals([
    "awaiting-bootstrap",
    "awaiting-reconciliation",
    "complete",
  ]),
  schemaVersion: Schema.Literal(1),
});
const BootstrapAuditRow = Schema.Struct({
  action: Schema.Literal("mailbox.owner-bootstrap"),
  actorId: Schema.String,
  actorType: Schema.Literal("user"),
  changeType: Schema.Literal("mailbox-bootstrapped"),
  eventId: Schema.String,
  occurredAt: Schema.Number,
  operationId: Schema.String,
  outcome: Schema.Literal("succeeded"),
  reasonCode: Schema.Literal("owner-bootstrap"),
  resourceId: Schema.Literal("primary"),
  resourceType: Schema.Literal("mailbox"),
  resourceVersionAfter: Schema.Literal(1),
  resourceVersionBefore: Schema.Null,
  tenantScopeId: Schema.Literal("primary"),
  tenantScopeType: Schema.Literal("legacy-mailbox"),
});

const domainOfAddress = (address: string) =>
  address.slice(address.lastIndexOf("@") + 1);

export class LegacyMailDomainClaimInitializationError extends Data.TaggedError(
  "LegacyMailDomainClaimInitializationError"
)<{
  readonly reason:
    | "canonicalization"
    | "conflicting-authority"
    | "invalid-history"
    | "invalid-persisted-claim"
    | "invalid-storage-state"
    | "storage";
}> {}

type LegacyMailDomainClaimInitializationErrorReason =
  LegacyMailDomainClaimInitializationError["reason"];

export class LegacyMailDomainClaimInitialization extends Schema.Class<LegacyMailDomainClaimInitialization>(
  "cloudflare-inbox/LegacyMailDomainClaimInitialization"
)({
  outcome: Schema.Literals(["fresh-empty", "reconciled", "validated"]),
}) {}

const initializationError = (
  reason: LegacyMailDomainClaimInitializationErrorReason
) => new LegacyMailDomainClaimInitializationError({ reason });

const decodeOne = <A>(
  decode: (value: unknown) => A,
  rows: readonly Record<string, unknown>[],
  reason: LegacyMailDomainClaimInitializationErrorReason
): Effect.Effect<A, LegacyMailDomainClaimInitializationError> =>
  rows.length === 1
    ? Effect.try({
        try: () => decode(rows[0]),
        catch: () => initializationError(reason),
      })
    : Effect.fail(initializationError(reason));

const canonicalize = (value: unknown) =>
  canonicalizeMailDomainV1(value).pipe(
    Effect.mapError(() => initializationError("canonicalization"))
  );

export interface LegacyMailDomainClaimReconcilerShape {
  readonly initialize: Effect.Effect<
    LegacyMailDomainClaimInitialization,
    LegacyMailDomainClaimInitializationError
  >;
}

export class LegacyMailDomainClaimReconciler extends Context.Service<
  LegacyMailDomainClaimReconciler,
  LegacyMailDomainClaimReconcilerShape
>()("cloudflare-inbox/LegacyMailDomainClaimReconciler", {
  make: Effect.gen(function* () {
    const config = yield* MailboxBootstrapConfig;
    const store = yield* LegacyMailDomainClaimStore;

    const initialize = Effect.fn("organization.legacy-domain.initialize")(
      // oxlint-disable-next-line eslint/complexity -- One startup state machine validates every mutually dependent authority before its only write.
      function* () {
        const snapshot = yield* store.inspect.pipe(
          Effect.mapError(() => initializationError("storage"))
        );
        if (
          snapshot.mailboxOrganizationGeneration.length !== 1 ||
          snapshot.mailboxOrganizationGeneration[0]?.valid !== 1
        ) {
          return yield* initializationError("invalid-storage-state");
        }
        const cutover = yield* decodeOne(
          Schema.decodeUnknownSync(ClaimCutoverRow),
          snapshot.claimCutovers,
          "invalid-storage-state"
        );
        const freshEmpty =
          snapshot.mailboxes.length === 0 &&
          snapshot.organizations.length === 0 &&
          snapshot.routes.length === 0 &&
          snapshot.ancestry.length === 0 &&
          snapshot.ownerAssignments.length === 0 &&
          snapshot.bootstrapReceipts.length === 0 &&
          snapshot.bootstrapIntents.length === 0 &&
          snapshot.bootstrapDomainIntents.length === 0 &&
          snapshot.bootstrapAudits.length === 0 &&
          snapshot.domains.length === 0 &&
          snapshot.claimReceipts.length === 0;
        if (freshEmpty) {
          if (
            cutover.initialOutcome !== "fresh-empty" ||
            cutover.initialStatus !== "awaiting-bootstrap"
          ) {
            return yield* initializationError("invalid-storage-state");
          }
          return new LegacyMailDomainClaimInitialization({
            outcome: "fresh-empty",
          });
        }
        if (
          snapshot.mailboxes.length !== 1 ||
          snapshot.organizations.length !== 1 ||
          snapshot.routes.length !== 1 ||
          snapshot.ancestry.length !== 1 ||
          snapshot.ownerAssignments.length !== 1 ||
          snapshot.domains.length > 1 ||
          snapshot.claimReceipts.length > 1 ||
          snapshot.bootstrapReceipts.length > 1 ||
          snapshot.bootstrapIntents.length > 1 ||
          snapshot.bootstrapDomainIntents.length > 1 ||
          snapshot.bootstrapAudits.length > 1
        ) {
          return yield* initializationError("invalid-storage-state");
        }

        const route = yield* decodeOne(
          Schema.decodeUnknownSync(PrimaryRouteRow),
          snapshot.routes,
          "invalid-storage-state"
        );
        const ancestry = yield* decodeOne(
          Schema.decodeUnknownSync(AncestryRow),
          snapshot.ancestry,
          "invalid-history"
        );
        if (
          snapshot.mailboxes[0]?.id !== "primary" ||
          snapshot.mailboxes[0]?.organizationId !==
            LEGACY_DEFAULT_ORGANIZATION_ID ||
          snapshot.mailboxes[0]?.organizationId !== ancestry.organizationId ||
          snapshot.organizations[0]?.id !== LEGACY_DEFAULT_ORGANIZATION_ID
        ) {
          return yield* initializationError("invalid-storage-state");
        }
        const owner = yield* decodeOne(
          Schema.decodeUnknownSync(OrganizationOwnerAssignmentReceiptSchema),
          snapshot.ownerAssignments,
          "invalid-history"
        );
        if (
          route.enabled !== 1 ||
          route.isPrimary !== 1 ||
          route.createdAt !== route.updatedAt ||
          ancestry.effectiveAt !== route.createdAt ||
          owner.mailboxId !== "primary" ||
          owner.organizationId !== LEGACY_DEFAULT_ORGANIZATION_ID ||
          owner.membershipId !== "legacy_default_v1_owner_v1" ||
          owner.source !== ancestry.source ||
          (owner.source === "fresh-bootstrap" &&
            owner.assignedAt !== route.createdAt) ||
          (owner.source === "legacy-cutover" &&
            owner.assignedAt < route.createdAt) ||
          normalizeEmailAddressDomain(route.address) !== route.normalizedAddress
        ) {
          return yield* initializationError("invalid-storage-state");
        }

        const rawDomain = yield* canonicalize(domainOfAddress(route.address));
        const normalizedDomain = yield* canonicalize(
          domainOfAddress(route.normalizedAddress)
        );
        if (
          rawDomain !== normalizedDomain ||
          rawDomain !== config.initialDomain
        ) {
          return yield* initializationError("conflicting-authority");
        }

        const bootstrapReceipt =
          snapshot.bootstrapReceipts.length === 0
            ? undefined
            : yield* decodeOne(
                Schema.decodeUnknownSync(BootstrapReceiptRow),
                snapshot.bootstrapReceipts,
                "invalid-history"
              );
        const bootstrapIntent =
          snapshot.bootstrapIntents.length === 0
            ? undefined
            : yield* decodeOne(
                Schema.decodeUnknownSync(BootstrapIntentRow),
                snapshot.bootstrapIntents,
                "invalid-history"
              );
        const bootstrapAudit =
          snapshot.bootstrapAudits.length === 0
            ? undefined
            : yield* decodeOne(
                Schema.decodeUnknownSync(BootstrapAuditRow),
                snapshot.bootstrapAudits,
                "invalid-history"
              );
        if (
          (bootstrapReceipt === undefined) !==
            (bootstrapIntent === undefined) ||
          (bootstrapReceipt !== undefined &&
            (bootstrapReceipt.operationId !== bootstrapIntent?.operationId ||
              bootstrapReceipt.resultCreatedAt !== route.createdAt ||
              bootstrapReceipt.resultUpdatedAt !== route.createdAt ||
              bootstrapReceipt.committedAt !== route.createdAt ||
              bootstrapReceipt.actorUserId !== owner.userId ||
              bootstrapReceipt.resultCreatedByUserId !== owner.userId ||
              owner.sourceBootstrapOperationId !==
                bootstrapReceipt.operationId ||
              owner.sourceAuditEventId === null))
        ) {
          return yield* initializationError("invalid-history");
        }
        if (bootstrapIntent !== undefined) {
          const intentDomain = yield* canonicalize(
            domainOfAddress(bootstrapIntent.initialAddress)
          );
          if (
            intentDomain !== rawDomain ||
            bootstrapIntent.operationId !== bootstrapReceipt?.operationId ||
            bootstrapIntent.initialAddress !== route.normalizedAddress ||
            ![1, 2].includes(bootstrapIntent.schemaVersion)
          ) {
            return yield* initializationError("conflicting-authority");
          }
        } else if (owner.sourceBootstrapOperationId !== null) {
          return yield* initializationError("invalid-history");
        }

        if (
          (owner.sourceAuditEventId === null) !==
            (bootstrapAudit === undefined) ||
          (bootstrapAudit !== undefined &&
            (bootstrapAudit.eventId !== owner.sourceAuditEventId ||
              bootstrapAudit.operationId !==
                (bootstrapReceipt?.operationId ?? bootstrapAudit.operationId) ||
              bootstrapAudit.actorId !== owner.userId ||
              bootstrapAudit.occurredAt !== route.createdAt))
        ) {
          return yield* initializationError("invalid-history");
        }

        const expectedCutover =
          ancestry.source === "fresh-bootstrap"
            ? bootstrapReceipt === undefined
              ? undefined
              : "already-bootstrapped-awaiting-reconciliation"
            : bootstrapReceipt === undefined
              ? "legacy-awaiting-reconciliation"
              : "already-bootstrapped-awaiting-reconciliation";
        if (
          cutover.initialOutcome !== "complete-pair" &&
          cutover.initialOutcome !== "fresh-empty" &&
          cutover.initialOutcome !== expectedCutover
        ) {
          return yield* initializationError("invalid-history");
        }

        let stagedDomain: typeof rawDomain | undefined;
        if (snapshot.bootstrapDomainIntents.length === 1) {
          const staged = yield* decodeOne(
            Schema.decodeUnknownSync(BootstrapDomainIntentRow),
            snapshot.bootstrapDomainIntents,
            "invalid-history"
          );
          stagedDomain = yield* canonicalize(staged.canonicalDomain);
          if (
            stagedDomain !== rawDomain ||
            staged.canonicalizationProfileId !==
              MAIL_DOMAIN_CANONICALIZATION_PROFILE_ID ||
            staged.canonicalizationVersion !== 1 ||
            staged.schemaVersion !== 1 ||
            staged.operationId !== bootstrapReceipt?.operationId ||
            bootstrapIntent?.schemaVersion !== 2
          ) {
            return yield* initializationError("conflicting-authority");
          }
        }

        if (snapshot.domains.length !== snapshot.claimReceipts.length) {
          return yield* initializationError("invalid-persisted-claim");
        }
        let claimReceipt: MailDomainClaimReceipt | undefined;
        if (snapshot.domains.length === 1) {
          const domain = yield* Schema.decodeUnknownEffect(MailDomainSchema)(
            snapshot.domains[0]
          ).pipe(
            Effect.mapError(() =>
              initializationError("invalid-persisted-claim")
            )
          );
          claimReceipt = yield* Schema.decodeUnknownEffect(
            MailDomainClaimReceipt
          )({
            ...snapshot.claimReceipts[0],
            sourceAuditEventId:
              snapshot.claimReceipts[0]?.sourceAuditEventId ?? undefined,
            sourceBootstrapOperationId:
              snapshot.claimReceipts[0]?.sourceBootstrapOperationId ??
              undefined,
          }).pipe(
            Effect.mapError(() =>
              initializationError("invalid-persisted-claim")
            )
          );
          if (
            domain.id !== LEGACY_DEFAULT_MAIL_DOMAIN_ID ||
            domain.organizationId !== LEGACY_DEFAULT_ORGANIZATION_ID ||
            domain.status !== "pending_verification" ||
            domain.version !== 1 ||
            domain.canonicalDomain !== rawDomain ||
            domain.createdAt !== route.createdAt ||
            domain.updatedAt !== route.createdAt ||
            claimReceipt.domainId !== domain.id ||
            claimReceipt.organizationId !== LEGACY_DEFAULT_ORGANIZATION_ID ||
            claimReceipt.mailboxId !== "primary" ||
            claimReceipt.primaryAddressId !== "primary" ||
            claimReceipt.canonicalDomain !== domain.canonicalDomain ||
            claimReceipt.rawAddressSnapshot !== route.address ||
            claimReceipt.normalizedAddressSnapshot !==
              route.normalizedAddress ||
            claimReceipt.effectiveAt !== route.createdAt ||
            claimReceipt.sourceBootstrapOperationId !==
              (owner.sourceBootstrapOperationId ?? undefined) ||
            claimReceipt.sourceAuditEventId !==
              (owner.sourceAuditEventId ?? undefined) ||
            (claimReceipt.source === "fresh-bootstrap" &&
              (ancestry.source !== "fresh-bootstrap" ||
                cutover.initialOutcome !== "fresh-empty")) ||
            (claimReceipt.source === "legacy-reconciliation" &&
              cutover.initialOutcome === "fresh-empty") ||
            (claimReceipt.source === "fresh-bootstrap" &&
              rawDomain.split(".").some((label) => label.startsWith("xn--")) &&
              stagedDomain === undefined)
          ) {
            return yield* initializationError("invalid-persisted-claim");
          }
        } else if (snapshot.bootstrapDomainIntents.length !== 0) {
          return yield* initializationError("invalid-history");
        }

        if (claimReceipt !== undefined) {
          return new LegacyMailDomainClaimInitialization({
            outcome: "validated",
          });
        }

        yield* store
          .materialize({
            canonicalDomain: rawDomain,
            effectiveAt: route.createdAt,
            normalizedAddressSnapshot: route.normalizedAddress,
            rawAddressSnapshot: route.address,
            sourceAuditEventId: owner.sourceAuditEventId ?? undefined,
            sourceBootstrapOperationId:
              owner.sourceBootstrapOperationId ?? undefined,
          })
          .pipe(Effect.mapError(() => initializationError("storage")));
        return new LegacyMailDomainClaimInitialization({
          outcome: "reconciled",
        });
      }
    )();

    return { initialize } satisfies LegacyMailDomainClaimReconcilerShape;
  }),
}) {
  static readonly layerNoDeps = Layer.effect(this, this.make);
}
