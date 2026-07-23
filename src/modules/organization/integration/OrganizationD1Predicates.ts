import { and, eq, exists, isNull } from "drizzle-orm";
import type { SQLWrapper } from "drizzle-orm";

import type { ControlPlaneDatabase } from "#/platform/control-plane-d1/ControlPlaneDatabase";

import { appMailbox } from "../adapters/d1/OrganizationSchema";

/** Stable foreign-key target for D1 schemas owned by collaborating contexts. */
export const organizationMailboxIdReference = () => appMailbox.id;

/** Active-mailbox check that can be embedded in another context's D1 query. */
export const activeOrganizationMailboxPredicate = (
  database: ControlPlaneDatabase,
  mailboxId: string | SQLWrapper
) =>
  exists(
    database
      .select({ id: appMailbox.id })
      .from(appMailbox)
      .where(
        and(
          eq(appMailbox.id, mailboxId),
          eq(appMailbox.status, "active"),
          isNull(appMailbox.deletedAt)
        )
      )
  );
