import { and, eq, ne, or, sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { authUserIdentity } from "#/auth/schema/modules/core";
import { externalRecoveryAddressComparisonKey } from "#/modules/account-security/domain/ExternalRecoveryIdentity";
import { RecoverySafeIdentityRejected } from "#/modules/account-security/domain/RecoverySafeIdentityError";
import { RecoverySafeIdentityPolicy } from "#/modules/account-security/ports/RecoverySafeIdentityPolicy";
import {
  legacyPrimaryMailboxAddressClaimsStatement,
  mailboxAddressLookupStatement,
} from "#/modules/address-routing/integration/AddressRoutingD1Statements";
import { MailboxBootstrapConfig } from "#/modules/organization/contracts/MailboxBootstrapConfig";
import {
  MailDomainSchema,
  canonicalizeMailDomainV1,
} from "#/modules/organization/domain/MailDomain";
import type { CanonicalMailDomain } from "#/modules/organization/domain/MailDomain";
import {
  currentMailDomainClaimsStatement,
  mailboxBootstrapStateStatement,
} from "#/modules/organization/integration/OrganizationD1Statements";
import { ControlPlaneDatabase } from "#/platform/control-plane-d1/ControlPlaneDatabase";
import {
  EmailAddress,
  NormalizedEmailAddress,
  normalizeEmailAddressDomain,
} from "#/shared/EmailAddress";

import { appExternalRecoveryIdentity } from "./AccountSecuritySchema";

const storageError = (cause: unknown) =>
  new RecoverySafeIdentityRejected({ cause, reason: "storage" });

const domainOfAddress = (address: string) =>
  address.slice(address.lastIndexOf("@") + 1);

const decodeCanonicalStoredDomain = (value: unknown) =>
  Schema.decodeUnknownEffect(MailDomainSchema)(value).pipe(
    Effect.map((domain) => domain.canonicalDomain),
    Effect.mapError(storageError)
  );

const decodeLegacyDomain = (value: {
  readonly address: unknown;
  readonly normalizedAddress: unknown;
}) =>
  Effect.gen(function* () {
    const address = yield* Schema.decodeUnknownEffect(EmailAddress)(
      value.address
    );
    const normalizedAddress = yield* Schema.decodeUnknownEffect(
      NormalizedEmailAddress
    )(value.normalizedAddress);
    if (
      address !== value.address ||
      normalizedAddress !== value.normalizedAddress ||
      normalizeEmailAddressDomain(address) !== normalizedAddress
    ) {
      return yield* Effect.fail(
        new Error("stored primary mailbox address projections disagree")
      );
    }
    return yield* canonicalizeMailDomainV1(domainOfAddress(normalizedAddress));
  }).pipe(Effect.mapError(storageError));

const resolveManagedDomain = (
  database: ControlPlaneDatabase,
  trustedDomain: CanonicalMailDomain
) =>
  Effect.gen(function* () {
    const [persistedClaims, mailboxRows, legacyClaims] = yield* Effect.all(
      [
        currentMailDomainClaimsStatement(database),
        mailboxBootstrapStateStatement(database),
        legacyPrimaryMailboxAddressClaimsStatement(database),
      ],
      { concurrency: "unbounded" }
    ).pipe(Effect.mapError(storageError));
    if (
      persistedClaims.length > 1 ||
      mailboxRows.length > 1 ||
      legacyClaims.length > 1
    ) {
      return yield* storageError(
        new Error("managed-domain storage is not single-domain")
      );
    }

    const [mailbox] = mailboxRows;
    const [persistedClaim] = persistedClaims;
    const persistedDomain =
      persistedClaim === undefined
        ? undefined
        : yield* decodeCanonicalStoredDomain(persistedClaim);
    const [legacyClaim] = legacyClaims;
    const legacyDomain =
      legacyClaim === undefined
        ? undefined
        : yield* decodeLegacyDomain(legacyClaim);

    if (
      (mailbox === undefined && legacyClaim !== undefined) ||
      (mailbox !== undefined &&
        legacyClaim !== undefined &&
        legacyClaim.mailboxId !== mailbox.mailboxId) ||
      (mailbox !== undefined &&
        persistedDomain === undefined &&
        legacyDomain === undefined)
    ) {
      return yield* storageError(
        new Error("managed-domain continuity claim is unusable")
      );
    }

    const claims = [
      trustedDomain,
      ...(persistedDomain === undefined ? [] : [persistedDomain]),
      ...(legacyDomain === undefined ? [] : [legacyDomain]),
    ];
    if (new Set(claims).size !== 1) {
      return yield* storageError(
        new Error("managed-domain authority claims disagree")
      );
    }
    const managedDomain =
      persistedDomain ?? (mailbox === undefined ? trustedDomain : legacyDomain);
    return managedDomain === undefined
      ? yield* storageError(
          new Error("managed-domain authority is unavailable")
        )
      : managedDomain;
  });

/** Deterministic compatibility resolver for the first-release managed domain. */
export const RecoverySafeIdentityD1Layer = Layer.effect(
  RecoverySafeIdentityPolicy,
  Effect.gen(function* () {
    const config = yield* MailboxBootstrapConfig;
    const database = yield* ControlPlaneDatabase;
    const trustedDomain = yield* canonicalizeMailDomainV1(
      domainOfAddress(config.initialAddress)
    ).pipe(Effect.orDie);

    return RecoverySafeIdentityPolicy.of({
      requireSafeAddress: (input) =>
        Effect.gen(function* () {
          const comparisonKey = externalRecoveryAddressComparisonKey(
            input.address
          );
          const candidateDomain = comparisonKey.slice(
            comparisonKey.lastIndexOf("@") + 1
          );
          const managedDomain = yield* resolveManagedDomain(
            database,
            trustedDomain
          );
          if (candidateDomain === managedDomain) {
            return yield* new RecoverySafeIdentityRejected({
              reason: "managed-domain",
            });
          }

          const recoveryPredicate = and(
            input.purpose === "external-recovery" && input.userId !== undefined
              ? or(
                  eq(appExternalRecoveryIdentity.comparisonKey, comparisonKey),
                  eq(appExternalRecoveryIdentity.userId, input.userId)
                )
              : eq(appExternalRecoveryIdentity.comparisonKey, comparisonKey),
            sql`(${appExternalRecoveryIdentity.status} = 'verified'
              or (${appExternalRecoveryIdentity.status} = 'pending'
                and ${appExternalRecoveryIdentity.challengeExpiresAt}
                  > cast(unixepoch('subsec') * 1000 as integer)))`,
            input.purpose === "login-email-initiation" ||
              input.excludeRecoveryIdentityId === undefined
              ? undefined
              : ne(
                  appExternalRecoveryIdentity.id,
                  input.excludeRecoveryIdentityId
                )
          );
          const [mailboxAddresses, loginIdentities, recoveryIdentities] =
            yield* Effect.all(
              [
                mailboxAddressLookupStatement(database, comparisonKey),
                database
                  .select({ id: authUserIdentity.id })
                  .from(authUserIdentity)
                  .where(
                    and(
                      eq(authUserIdentity.kind, "email"),
                      eq(
                        sql`lower(${authUserIdentity.normalizedValue})`,
                        comparisonKey
                      ),
                      sql`${authUserIdentity.revokedAt} is null`
                    )
                  )
                  .limit(1),
                database
                  .select({ id: appExternalRecoveryIdentity.id })
                  .from(appExternalRecoveryIdentity)
                  .where(recoveryPredicate)
                  .limit(1),
              ],
              { concurrency: "unbounded" }
            ).pipe(Effect.mapError(storageError));

          if (mailboxAddresses.length > 0) {
            return yield* new RecoverySafeIdentityRejected({
              reason: "mailbox-address",
            });
          }
          if (
            input.purpose === "external-recovery" &&
            loginIdentities.length > 0
          ) {
            return yield* new RecoverySafeIdentityRejected({
              reason: "login-identity",
            });
          }
          if (recoveryIdentities.length > 0) {
            return yield* new RecoverySafeIdentityRejected({
              reason: "recovery-identity",
            });
          }
        }),
    });
  })
);
