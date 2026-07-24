import { and, asc, eq, notExists, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import { appAuthorizationGuard } from "#/platform/control-plane-d1/AuthorizationGuardSchema";
import type { ControlPlaneStatement } from "#/platform/control-plane-d1/ControlPlaneBatch";
import type { ControlPlaneDatabase } from "#/platform/control-plane-d1/ControlPlaneDatabase";

import { appMailboxAddress } from "../adapters/d1/AddressRoutingSchema";

export const mailboxAddressAvailablePredicate = (
  database: ControlPlaneDatabase,
  comparisonKey: string
) =>
  notExists(
    database
      .select({ value: sql`1` })
      .from(appMailboxAddress)
      .where(
        sql`lower(${appMailboxAddress.normalizedAddress}) = ${comparisonKey}`
      )
  );

export const mailboxAddressLookupStatement = (
  database: ControlPlaneDatabase,
  comparisonKey: string
) =>
  database
    .select({ id: appMailboxAddress.id })
    .from(appMailboxAddress)
    .where(
      eq(sql`lower(${appMailboxAddress.normalizedAddress})`, comparisonKey)
    )
    .limit(1);

/** Bounded retained primary routes used as legacy managed-domain anchors. */
export const legacyPrimaryMailboxAddressClaimsStatement = (
  database: ControlPlaneDatabase
) =>
  database
    .select({
      address: appMailboxAddress.address,
      mailboxId: appMailboxAddress.mailboxId,
      normalizedAddress: appMailboxAddress.normalizedAddress,
    })
    .from(appMailboxAddress)
    .where(eq(appMailboxAddress.isPrimary, true))
    .orderBy(asc(appMailboxAddress.mailboxId), asc(appMailboxAddress.id))
    .limit(2);

export interface PrimaryMailboxAddressInsert {
  readonly address: string;
  readonly authorizationGuardNonce: string;
  readonly createdAt: number;
  readonly mailboxId: string;
  readonly mailboxCreated: SQL<unknown>;
  readonly normalizedAddress: string;
}

/** Address insert selected by transaction-local authorization and creation. */
export const primaryMailboxAddressInsertStatement = (
  database: ControlPlaneDatabase,
  input: PrimaryMailboxAddressInsert
): ControlPlaneStatement =>
  database.insert(appMailboxAddress).select(
    database
      .select({
        address: sql`${input.address}`.as("address"),
        createdAt: sql`${input.createdAt}`.as("created_at"),
        enabled: sql<boolean>`1`.as("enabled"),
        id: sql`${"primary"}`.as("id"),
        isPrimary: sql<boolean>`1`.as("is_primary"),
        mailboxId: sql`${input.mailboxId}`.as("mailbox_id"),
        normalizedAddress: sql`${input.normalizedAddress}`.as(
          "normalized_address"
        ),
        updatedAt: sql`${input.createdAt}`.as("updated_at"),
      })
      .from(appAuthorizationGuard)
      .where(
        and(
          eq(appAuthorizationGuard.nonce, input.authorizationGuardNonce),
          input.mailboxCreated
        )
      )
  );
