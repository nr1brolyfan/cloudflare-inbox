import { and, eq, ne, sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { authUserIdentity } from "#/auth/schema/modules/core";
import { externalRecoveryAddressComparisonKey } from "#/modules/account-security/domain/ExternalRecoveryIdentity";
import { RecoverySafeIdentityRejected } from "#/modules/account-security/domain/RecoverySafeIdentityError";
import { RecoverySafeIdentityPolicy } from "#/modules/account-security/ports/RecoverySafeIdentityPolicy";
import { appMailboxAddress } from "#/modules/address-routing/adapters/d1/AddressRoutingSchema";
import { MailboxAdministrationConfig } from "#/modules/organization/adapters/d1/MailboxAdministrationD1";
import { ControlPlaneDatabase } from "#/platform/control-plane-d1/ControlPlaneDatabase";
import { appExternalRecoveryIdentity } from "#/platform/control-plane-d1/ControlPlaneSchema";

const storageError = (cause: unknown) =>
  new RecoverySafeIdentityRejected({ cause, reason: "storage" });

/** Transitional policy uses the configured owner domain until MailDomain exists. */
export const RecoverySafeIdentityD1Layer = Layer.effect(
  RecoverySafeIdentityPolicy,
  Effect.gen(function* () {
    const config = yield* MailboxAdministrationConfig;
    const database = yield* ControlPlaneDatabase;
    const ownerDomain = config.ownerEmail
      .slice(config.ownerEmail.lastIndexOf("@") + 1)
      .toLowerCase();

    return RecoverySafeIdentityPolicy.of({
      requireExternalRecoveryAddress: (input) =>
        Effect.gen(function* () {
          const comparisonKey = externalRecoveryAddressComparisonKey(
            input.address
          );
          const candidateDomain = comparisonKey.slice(
            comparisonKey.lastIndexOf("@") + 1
          );
          if (candidateDomain === ownerDomain) {
            return yield* new RecoverySafeIdentityRejected({
              reason: "managed-domain",
            });
          }

          const recoveryPredicate = and(
            eq(appExternalRecoveryIdentity.comparisonKey, comparisonKey),
            sql`(${appExternalRecoveryIdentity.status} = 'verified'
              or (${appExternalRecoveryIdentity.status} = 'pending'
                and ${appExternalRecoveryIdentity.challengeExpiresAt}
                  > cast(unixepoch('subsec') * 1000 as integer)))`,
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
                database
                  .select({ id: appMailboxAddress.id })
                  .from(appMailboxAddress)
                  .where(
                    eq(
                      sql`lower(${appMailboxAddress.normalizedAddress})`,
                      comparisonKey
                    )
                  )
                  .limit(1),
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
          if (loginIdentities.length > 0) {
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
