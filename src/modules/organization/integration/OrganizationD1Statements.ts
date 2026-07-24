import { asc, ne } from "drizzle-orm";

import type { ControlPlaneDatabase } from "#/platform/control-plane-d1/ControlPlaneDatabase";

import { appMailDomain, appMailbox } from "../adapters/d1/OrganizationSchema";

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
    .orderBy(asc(appMailbox.id))
    .limit(2);
