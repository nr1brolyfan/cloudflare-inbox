import { asc, eq, sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { legacyPrimaryMailboxAddressClaimsStatement } from "#/modules/address-routing/integration/AddressRoutingD1Statements";
import { appAdministrativeAuditEvent } from "#/modules/administrative-audit/adapters/d1/AdministrativeAuditSchema";
import {
  appMailDomain,
  appMailDomainClaimCutover,
  appMailDomainClaimReceipt,
  appMailbox,
  appMailboxAdministrationReceipt,
  appMailboxBootstrapDomainIntent,
  appMailboxBootstrapReceiptV1Intent,
  appMailboxBootstrapReceiptV2,
  appMailboxLegacyOrganizationAssignment,
  appOrganization,
  appOrganizationOwnerAssignmentReceipt,
} from "#/modules/organization/adapters/d1/OrganizationSchema";
import {
  LEGACY_DEFAULT_MAIL_DOMAIN_ID,
  MAIL_DOMAIN_CANONICALIZATION_PROFILE_ID,
  MailDomainClaimReceipt,
} from "#/modules/organization/domain/MailDomain";
import { canonicalMailboxAncestryPredicate } from "#/modules/organization/integration/OrganizationD1Predicates";
import {
  LegacyMailDomainClaimStore,
  LegacyMailDomainClaimStoreError,
} from "#/modules/organization/ports/LegacyMailDomainClaimStore";
import type { MaterializeLegacyMailDomainClaim } from "#/modules/organization/ports/LegacyMailDomainClaimStore";
import { ControlPlaneBatch } from "#/platform/control-plane-d1/ControlPlaneBatch";
import { ControlPlaneDatabase } from "#/platform/control-plane-d1/ControlPlaneDatabase";

const storageError = (cause?: unknown) =>
  new LegacyMailDomainClaimStoreError({ cause });

const readReceiptResult = (value: unknown) =>
  Schema.decodeUnknownEffect(
    Schema.Array(
      Schema.Struct({
        canonicalDomain: Schema.String,
        canonicalizationProfileId: Schema.String,
        canonicalizationVersion: Schema.Number,
        domainId: Schema.String,
        effectiveAt: Schema.Number,
        mailboxId: Schema.String,
        normalizedAddressSnapshot: Schema.String,
        organizationId: Schema.String,
        primaryAddressId: Schema.String,
        rawAddressSnapshot: Schema.String,
        schemaVersion: Schema.Number,
        source: Schema.String,
        sourceAuditEventId: Schema.NullOr(Schema.String),
        sourceBootstrapOperationId: Schema.NullOr(Schema.String),
      })
    )
  )(value).pipe(
    Effect.flatMap((rows) =>
      rows.length === 1
        ? Schema.decodeUnknownEffect(MailDomainClaimReceipt)({
            ...rows[0],
            sourceAuditEventId: rows[0]?.sourceAuditEventId ?? undefined,
            sourceBootstrapOperationId:
              rows[0]?.sourceBootstrapOperationId ?? undefined,
          })
        : Effect.fail(new Error("mail domain claim postcondition failed"))
    ),
    Effect.mapError(storageError)
  );

const resultRows = (
  results: readonly { readonly results?: readonly unknown[] }[],
  index: number
): Effect.Effect<
  readonly Record<string, unknown>[],
  LegacyMailDomainClaimStoreError
> =>
  Effect.try({
    try: () => {
      const rows = results[index]?.results;
      if (
        !Array.isArray(rows) ||
        rows.some(
          (row) => row === null || typeof row !== "object" || Array.isArray(row)
        )
      ) {
        throw new Error("invalid D1 inspection result");
      }
      return rows.map((row) =>
        Object.fromEntries(
          Object.entries(row as Record<string, unknown>).map(([key, value]) => [
            key
              .split("_")
              .map((part, partIndex) =>
                partIndex === 0
                  ? part
                  : `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`
              )
              .join(""),
            value,
          ])
        )
      );
    },
    catch: storageError,
  });

export const LegacyMailDomainClaimStoreD1Layer = Layer.effect(
  LegacyMailDomainClaimStore,
  Effect.gen(function* () {
    const database = yield* ControlPlaneDatabase;
    const batch = yield* ControlPlaneBatch;

    const inspect = Effect.gen(function* () {
      const results = yield* batch
        .execute([
          database
            .select()
            .from(appMailboxLegacyOrganizationAssignment)
            .orderBy(asc(appMailboxLegacyOrganizationAssignment.mailboxId))
            .limit(2),
          database
            .select()
            .from(appAdministrativeAuditEvent)
            .where(
              eq(appAdministrativeAuditEvent.action, "mailbox.owner-bootstrap")
            )
            .orderBy(asc(appAdministrativeAuditEvent.storageId))
            .limit(2),
          database
            .select()
            .from(appMailboxBootstrapDomainIntent)
            .orderBy(asc(appMailboxBootstrapDomainIntent.operationId))
            .limit(2),
          database
            .select({
              initialAddress: appMailboxBootstrapReceiptV1Intent.initialAddress,
              operationId: appMailboxBootstrapReceiptV1Intent.operationId,
              schemaVersion: sql<number>`1`.as("schema_version"),
            })
            .from(appMailboxBootstrapReceiptV1Intent)
            .limit(2),
          database
            .select({
              initialAddress: appMailboxBootstrapReceiptV2.initialAddress,
              operationId: appMailboxBootstrapReceiptV2.operationId,
              schemaVersion: appMailboxBootstrapReceiptV2.schemaVersion,
            })
            .from(appMailboxBootstrapReceiptV2)
            .limit(2),
          database
            .select({
              actorUserId: appMailboxAdministrationReceipt.actorUserId,
              committedAt: appMailboxAdministrationReceipt.committedAt,
              expectedVersion: appMailboxAdministrationReceipt.expectedVersion,
              mailboxId: appMailboxAdministrationReceipt.mailboxId,
              operationId: appMailboxAdministrationReceipt.operationId,
              operationKind: appMailboxAdministrationReceipt.operationKind,
              resultCreatedAt: appMailboxAdministrationReceipt.resultCreatedAt,
              resultCreatedByUserId:
                appMailboxAdministrationReceipt.resultCreatedByUserId,
              resultMailboxId: appMailboxAdministrationReceipt.resultMailboxId,
              resultUpdatedAt: appMailboxAdministrationReceipt.resultUpdatedAt,
              resultVersion: appMailboxAdministrationReceipt.resultVersion,
              schemaVersion: appMailboxAdministrationReceipt.schemaVersion,
            })
            .from(appMailboxAdministrationReceipt)
            .where(
              eq(
                appMailboxAdministrationReceipt.operationKind,
                "bootstrap-owner"
              )
            )
            .limit(2),
          database.select().from(appMailDomainClaimReceipt).limit(2),
          database.select().from(appMailDomainClaimCutover).limit(2),
          database.select().from(appMailDomain).limit(2),
          database
            .select({
              id: appMailbox.id,
              organizationId: appMailbox.organizationId,
            })
            .from(appMailbox)
            .where(canonicalMailboxAncestryPredicate(database, appMailbox.id))
            .limit(2),
          database
            .select({ id: appOrganization.id })
            .from(appOrganization)
            .limit(2),
          database
            .select()
            .from(appOrganizationOwnerAssignmentReceipt)
            .limit(2),
          legacyPrimaryMailboxAddressClaimsStatement(database),
          database.all(sql`
            select case when
              (select count(*) from app_mailbox_organization_generation) = 1
              and exists (select 1 from app_mailbox_organization_generation
                where id = 1 and schema_version = 1
                  and json_array_length(artifact_sql_json) = 22
                  and artifact_sql_json = (select json_group_array(json_object(
                    'type', type, 'name', name, 'tbl_name', tbl_name, 'sql', sql
                  )) from (
                    select type, name, tbl_name, sql from sqlite_master
                    where name in (
                      'app_mailbox_legacy_organization_assignment',
                      'app_mailbox_legacy_organization_assignment_cutover',
                      'app_mailbox_legacy_organization_assignment_binding',
                      'app_mailbox_legacy_organization_assignment_no_replace',
                      'app_mailbox_legacy_organization_assignment_no_update',
                      'app_mailbox_legacy_organization_assignment_no_delete',
                      'app_mailbox_legacy_organization_assignment_cutover_no_insert',
                      'app_mailbox_legacy_organization_assignment_cutover_no_update',
                      'app_mailbox_legacy_organization_assignment_cutover_no_delete',
                      'app_mailbox_organization_status_idx',
                      'app_mailbox_organization_insert_contract',
                      'app_mailbox_organization_materialize_fresh',
                      'app_mailbox_organization_immutable',
                      'app_mailbox_identity_immutable',
                      'app_mailbox_no_replace',
                      'app_mailbox_no_delete',
                      'app_mailbox_organization_consistent_after_update',
                      'app_mailbox_organization_successor_fence',
                      'app_mailbox_organization_generation',
                      'app_mailbox_organization_generation_no_replace',
                      'app_mailbox_organization_generation_no_update',
                      'app_mailbox_organization_generation_no_delete'
                    ) order by type, name
                  ))
                  and column_json = (select json_group_array(json_object(
                    'cid', cid, 'name', name, 'type', type,
                    'notnull', "notnull", 'dflt_value', dflt_value,
                    'pk', pk, 'hidden', hidden
                  )) from (
                    select * from pragma_table_xinfo('app_mailbox')
                    where name = 'organization_id' order by cid
                  ))
                  and foreign_key_json = (select json_group_array(json_object(
                    'id', id, 'seq', seq, 'table', "table", 'from', "from",
                    'to', "to", 'on_update', on_update,
                    'on_delete', on_delete, 'match', match
                  )) from (
                    select * from pragma_foreign_key_list('app_mailbox')
                    where "from" = 'organization_id' order by id, seq
                  )))
              then 1 else 0 end as valid
          `),
        ])
        .pipe(Effect.mapError(storageError));
      const ancestry = yield* resultRows(results, 0);
      const bootstrapAudits = yield* resultRows(results, 1);
      const bootstrapDomainIntents = yield* resultRows(results, 2);
      const legacyBootstrapIntents = yield* resultRows(results, 3);
      const currentBootstrapIntents = yield* resultRows(results, 4);
      const bootstrapReceipts = yield* resultRows(results, 5);
      const claimReceipts = yield* resultRows(results, 6);
      const claimCutovers = yield* resultRows(results, 7);
      const domains = yield* resultRows(results, 8);
      const mailboxes = yield* resultRows(results, 9);
      const organizations = yield* resultRows(results, 10);
      const ownerAssignments = yield* resultRows(results, 11);
      const routes = yield* resultRows(results, 12);
      const mailboxOrganizationGeneration = yield* resultRows(results, 13);
      return {
        ancestry,
        bootstrapAudits,
        bootstrapDomainIntents,
        bootstrapIntents: [
          ...legacyBootstrapIntents,
          ...currentBootstrapIntents,
        ],
        bootstrapReceipts,
        claimCutovers,
        claimReceipts,
        domains,
        mailboxes,
        mailboxOrganizationGeneration,
        organizations,
        ownerAssignments,
        routes,
      };
    }).pipe(Effect.mapError(storageError));

    const materialize = (command: MaterializeLegacyMailDomainClaim) =>
      Effect.gen(function* () {
        const results = yield* batch
          .execute([
            database.all(sql`
            insert into app_mail_domain (
              id, organization_id, canonical_domain,
              canonicalization_profile_id, canonicalization_version, status,
              created_at, updated_at, version
            )
            select ${LEGACY_DEFAULT_MAIL_DOMAIN_ID}, 'legacy_default_v1',
              ${command.canonicalDomain},
              ${MAIL_DOMAIN_CANONICALIZATION_PROFILE_ID}, 1,
              'pending_verification', ${command.effectiveAt},
              ${command.effectiveAt}, 1
            where (select count(*) from app_mailbox) = 1
              and (select count(*) from app_organization) = 1
              and not exists (select 1 from app_mail_domain)
              and not exists (select 1 from app_mail_domain_claim_receipt)
              and exists (select 1 from app_mail_domain_claim_cutover
                where id = 1 and schema_version = 1
                  and initial_status = 'awaiting-reconciliation')
              and exists (select 1 from app_mailbox_address address
                where address.mailbox_id = 'primary'
                  and address.id = 'primary' and address.is_primary = 1
                  and address.enabled = 1 and address.version = 1
                  and address.address = ${command.rawAddressSnapshot}
                  and address.normalized_address = ${command.normalizedAddressSnapshot}
                  and address.created_at = ${command.effectiveAt}
                  and address.updated_at = ${command.effectiveAt})
              and exists (select 1
                from app_mailbox mailbox
                join app_mailbox_legacy_organization_assignment ancestry
                  on ancestry.mailbox_id = mailbox.id
                 and ancestry.organization_id = mailbox.organization_id
                where mailbox.id = 'primary'
                  and mailbox.organization_id = 'legacy_default_v1'
                  and ancestry.organization_id = 'legacy_default_v1'
                  and ancestry.effective_at = ${command.effectiveAt}
                  and ancestry.schema_version = 1)
              and exists (select 1
                from app_organization_owner_assignment_receipt owner
                where owner.organization_id = 'legacy_default_v1'
                  and owner.mailbox_id = 'primary'
                  and owner.source_bootstrap_operation_id
                    is ${command.sourceBootstrapOperationId ?? null}
                  and owner.source_audit_event_id
                    is ${command.sourceAuditEventId ?? null})
          `),
            database.all(sql`
            insert into app_mail_domain_claim_receipt (
              domain_id, organization_id, mailbox_id, primary_address_id,
              raw_address_snapshot, normalized_address_snapshot,
              canonical_domain, canonicalization_profile_id,
              canonicalization_version, source, effective_at,
              source_bootstrap_operation_id, source_audit_event_id,
              schema_version
            )
            select domain.id, domain.organization_id, 'primary', 'primary',
              ${command.rawAddressSnapshot}, ${command.normalizedAddressSnapshot},
              domain.canonical_domain, domain.canonicalization_profile_id,
              domain.canonicalization_version, 'legacy-reconciliation',
              ${command.effectiveAt},
              ${command.sourceBootstrapOperationId ?? null},
              ${command.sourceAuditEventId ?? null}, 1
            from app_mail_domain domain
            where domain.id = ${LEGACY_DEFAULT_MAIL_DOMAIN_ID}
              and domain.canonical_domain = ${command.canonicalDomain}
              and domain.status = 'pending_verification'
              and domain.version = 1
              and domain.created_at = ${command.effectiveAt}
              and domain.updated_at = ${command.effectiveAt}
              and not exists (select 1 from app_mail_domain_claim_receipt)
              and (
                ${command.sourceBootstrapOperationId ?? null} is null
                or exists (select 1
                  from app_mailbox_administration_receipt receipt
                  where receipt.operation_id = ${command.sourceBootstrapOperationId ?? null}
                    and receipt.operation_kind = 'bootstrap-owner'
                    and receipt.result_created_at = ${command.effectiveAt}
                    and receipt.result_updated_at = ${command.effectiveAt}
                    and receipt.committed_at = ${command.effectiveAt}
                    and ((select count(*)
                      from app_mailbox_bootstrap_receipt_v1_intent intent
                      where intent.operation_id = receipt.operation_id
                        and intent.initial_address = ${command.normalizedAddressSnapshot})
                    + (select count(*) from app_mailbox_bootstrap_receipt_v2 intent
                      where intent.operation_id = receipt.operation_id
                        and intent.initial_address = ${command.normalizedAddressSnapshot}
                        and intent.schema_version = 2)) = 1)
              )
          `),
            database.all(sql`
            insert into app_mail_domain_claim_cutover
              (id, schema_version, initial_outcome, initial_status)
            select 2, 1, 'complete-pair', 'complete'
            where not exists (select 1
              from app_mail_domain domain
              join app_mail_domain_claim_receipt receipt
                on receipt.domain_id = domain.id
              where domain.id = ${LEGACY_DEFAULT_MAIL_DOMAIN_ID}
                and domain.canonical_domain = ${command.canonicalDomain}
                and domain.status = 'pending_verification'
                and domain.version = 1
                and receipt.effective_at = ${command.effectiveAt}
                and receipt.raw_address_snapshot = ${command.rawAddressSnapshot}
                and receipt.normalized_address_snapshot = ${command.normalizedAddressSnapshot})
          `),
            database.all(sql`
            select domain_id as domainId,
              organization_id as organizationId, mailbox_id as mailboxId,
              primary_address_id as primaryAddressId,
              raw_address_snapshot as rawAddressSnapshot,
              normalized_address_snapshot as normalizedAddressSnapshot,
              canonical_domain as canonicalDomain,
              canonicalization_profile_id as canonicalizationProfileId,
              canonicalization_version as canonicalizationVersion,
              source, effective_at as effectiveAt,
              source_bootstrap_operation_id as sourceBootstrapOperationId,
              source_audit_event_id as sourceAuditEventId,
              schema_version as schemaVersion
            from app_mail_domain_claim_receipt
            where domain_id = ${LEGACY_DEFAULT_MAIL_DOMAIN_ID}
          `),
          ])
          .pipe(Effect.mapError(storageError));
        return yield* readReceiptResult(results[3]?.results);
      });

    return LegacyMailDomainClaimStore.of({ inspect, materialize });
  })
);
