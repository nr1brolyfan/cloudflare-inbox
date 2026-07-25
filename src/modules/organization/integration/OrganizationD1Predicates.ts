import { and, eq, exists, isNull, or, sql } from "drizzle-orm";
import type { SQLWrapper } from "drizzle-orm";

import type { ControlPlaneDatabase } from "#/platform/control-plane-d1/ControlPlaneDatabase";
import { appOrganization } from "#/platform/control-plane-d1/OrganizationRootSchema";

import {
  appMailbox,
  appMailboxLegacyOrganizationAssignment,
  appOrganizationLegacyCutover,
} from "../adapters/d1/OrganizationSchema";

/** Stable foreign-key target for D1 schemas owned by collaborating contexts. */
export const organizationMailboxIdReference = () => appMailbox.id;

/** Exact retained data ancestry for one mailbox; startup owns schema checks. */
export const canonicalMailboxAncestryPredicate = (
  database: ControlPlaneDatabase,
  mailboxId: string | SQLWrapper
) =>
  sql<boolean>`${and(
    exists(
      database
        .select({ id: appMailbox.id })
        .from(appMailbox)
        .innerJoin(
          appMailboxLegacyOrganizationAssignment,
          and(
            eq(appMailboxLegacyOrganizationAssignment.mailboxId, appMailbox.id),
            eq(
              appMailboxLegacyOrganizationAssignment.organizationId,
              appMailbox.organizationId
            ),
            eq(
              appMailboxLegacyOrganizationAssignment.effectiveAt,
              appMailbox.createdAt
            ),
            eq(appMailboxLegacyOrganizationAssignment.schemaVersion, 1)
          )
        )
        .innerJoin(
          appOrganization,
          and(
            eq(appOrganization.id, appMailbox.organizationId),
            eq(
              appOrganization.createdAt,
              appMailboxLegacyOrganizationAssignment.effectiveAt
            )
          )
        )
        .innerJoin(
          appOrganizationLegacyCutover,
          or(
            and(
              eq(
                appMailboxLegacyOrganizationAssignment.source,
                "legacy-cutover"
              ),
              eq(appOrganizationLegacyCutover.id, 1),
              eq(appOrganizationLegacyCutover.schemaVersion, 1),
              eq(appOrganizationLegacyCutover.outcome, "legacy-primary"),
              eq(
                appOrganizationLegacyCutover.sourceMailboxId,
                appMailboxLegacyOrganizationAssignment.mailboxId
              ),
              eq(
                appOrganizationLegacyCutover.sourceCreatedAt,
                appMailboxLegacyOrganizationAssignment.effectiveAt
              ),
              eq(
                appOrganizationLegacyCutover.organizationId,
                appMailboxLegacyOrganizationAssignment.organizationId
              )
            ),
            and(
              eq(
                appMailboxLegacyOrganizationAssignment.source,
                "fresh-bootstrap"
              ),
              eq(appOrganizationLegacyCutover.id, 1),
              eq(appOrganizationLegacyCutover.schemaVersion, 1),
              eq(appOrganizationLegacyCutover.outcome, "fresh-empty"),
              isNull(appOrganizationLegacyCutover.sourceMailboxId),
              isNull(appOrganizationLegacyCutover.sourceCreatedAt),
              isNull(appOrganizationLegacyCutover.organizationId)
            )
          )
        )
        .where(eq(appMailbox.id, mailboxId))
    )
  )}`;

/** Active-mailbox check that can be embedded in another context's D1 query. */
export const activeOrganizationMailboxPredicate = (
  database: ControlPlaneDatabase,
  mailboxId: string | SQLWrapper
) =>
  exists(
    database
      .select({ id: appMailbox.id })
      .from(appMailbox)
      .innerJoin(
        appOrganization,
        eq(appOrganization.id, appMailbox.organizationId)
      )
      .where(
        and(
          eq(appMailbox.id, mailboxId),
          eq(appMailbox.status, "active"),
          eq(appOrganization.status, "active"),
          isNull(appMailbox.deletedAt),
          canonicalMailboxAncestryPredicate(database, mailboxId)
        )
      )
  );
