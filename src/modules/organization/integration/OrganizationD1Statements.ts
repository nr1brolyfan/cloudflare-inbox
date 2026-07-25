import { and, asc, eq, isNull, ne, notExists, sql } from "drizzle-orm";

import { LEGACY_DEFAULT_ORGANIZATION_ID } from "#/modules/organization/domain/Organization";
import { appAuthorizationGuard } from "#/platform/control-plane-d1/AuthorizationGuardSchema";
import type { ControlPlaneStatement } from "#/platform/control-plane-d1/ControlPlaneBatch";
import type { ControlPlaneDatabase } from "#/platform/control-plane-d1/ControlPlaneDatabase";
import { appOrganization } from "#/platform/control-plane-d1/OrganizationRootSchema";

import {
  appMailDomain,
  appMailbox,
  appOrganizationLegacyCutover,
} from "../adapters/d1/OrganizationSchema";
import { canonicalMailboxAncestryPredicate } from "./OrganizationD1Predicates";

/** Bounded current claims for first-release single-domain reconciliation. */
export const currentMailDomainClaimsStatement = (
  database: ControlPlaneDatabase
) =>
  database
    .select({
      canonicalDomain: appMailDomain.canonicalDomain,
      canonicalizationProfileId: appMailDomain.canonicalizationProfileId,
      canonicalizationVersion: appMailDomain.canonicalizationVersion,
      createdAt: appMailDomain.createdAt,
      id: appMailDomain.id,
      organizationId: appMailDomain.organizationId,
      status: appMailDomain.status,
      updatedAt: appMailDomain.updatedAt,
      version: appMailDomain.version,
    })
    .from(appMailDomain)
    .where(ne(appMailDomain.status, "retired"))
    .orderBy(asc(appMailDomain.id))
    .limit(2);

/** Bounded mailbox inventory used to distinguish pre-bootstrap configuration. */
export const mailboxBootstrapStateStatement = (
  database: ControlPlaneDatabase
) =>
  database
    .select({ mailboxId: appMailbox.id })
    .from(appMailbox)
    .where(canonicalMailboxAncestryPredicate(database, appMailbox.id))
    .orderBy(asc(appMailbox.id))
    .limit(2);

export interface LegacyDefaultOrganizationBootstrapInsert {
  readonly authorizationGuardNonce: string;
  readonly createdAt: number;
}

/** Fresh-cutover organization insert selected by the transaction-local guard. */
export const legacyDefaultOrganizationBootstrapInsertStatement = (
  database: ControlPlaneDatabase,
  input: LegacyDefaultOrganizationBootstrapInsert
): ControlPlaneStatement =>
  database.insert(appOrganization).select(
    database
      .select({
        createdAt: sql`${input.createdAt}`.as("created_at"),
        id: sql`${LEGACY_DEFAULT_ORGANIZATION_ID}`.as("id"),
        updatedAt: sql`${input.createdAt}`.as("updated_at"),
      })
      .from(appAuthorizationGuard)
      .innerJoin(
        appOrganizationLegacyCutover,
        and(
          eq(appOrganizationLegacyCutover.id, 1),
          eq(appOrganizationLegacyCutover.schemaVersion, 1),
          eq(appOrganizationLegacyCutover.outcome, "fresh-empty"),
          isNull(appOrganizationLegacyCutover.sourceMailboxId),
          isNull(appOrganizationLegacyCutover.sourceCreatedAt),
          isNull(appOrganizationLegacyCutover.organizationId)
        )
      )
      .where(
        and(
          eq(appAuthorizationGuard.nonce, input.authorizationGuardNonce),
          notExists(
            database
              .select({ value: sql`1` })
              .from(appOrganization)
              .where(eq(appOrganization.id, LEGACY_DEFAULT_ORGANIZATION_ID))
          )
        )
      )
  );
