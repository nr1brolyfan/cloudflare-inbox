import { and, eq, isNotNull, isNull } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { authUser, authUserIdentity } from "#/auth/schema/modules/core";
import {
  PasskeyAuthenticationIdentityStore,
  PasskeyAuthenticationIdentityStoreError,
} from "#/modules/account-security/ports/PasskeyAuthenticationIdentityStore";
import { ControlPlaneDatabase } from "#/platform/control-plane-d1/ControlPlaneDatabase";

import { appExternalRecoveryIdentity } from "./AccountSecuritySchema";

const mapStoreError = (cause: unknown) =>
  new PasskeyAuthenticationIdentityStoreError({ cause });

export const PasskeyAuthenticationIdentityD1Layer = Layer.effect(
  PasskeyAuthenticationIdentityStore,
  Effect.gen(function* () {
    const database = yield* ControlPlaneDatabase;
    return PasskeyAuthenticationIdentityStore.of({
      eligible: (userId) =>
        Effect.all([
          database
            .select({ id: authUser.id })
            .from(authUser)
            .where(and(eq(authUser.id, userId), isNull(authUser.disabledAt)))
            .limit(1),
          database
            .select({ id: appExternalRecoveryIdentity.id })
            .from(appExternalRecoveryIdentity)
            .where(
              and(
                eq(appExternalRecoveryIdentity.userId, userId),
                eq(appExternalRecoveryIdentity.status, "verified")
              )
            )
            .limit(1),
          database
            .select({ id: authUserIdentity.id })
            .from(authUserIdentity)
            .where(
              and(
                eq(authUserIdentity.userId, userId),
                eq(authUserIdentity.isPrimaryLogin, 1),
                isNotNull(authUserIdentity.verifiedAt),
                isNull(authUserIdentity.revokedAt)
              )
            )
            .limit(1),
        ]).pipe(
          Effect.mapError(mapStoreError),
          Effect.map(([users, recoveries, identities]) =>
            Boolean(users[0] && recoveries[0] && identities[0])
          )
        ),
      verifiedIdentity: (userId) =>
        database
          .select({
            id: authUserIdentity.id,
            kind: authUserIdentity.kind,
            value: authUserIdentity.value,
          })
          .from(authUserIdentity)
          .where(
            and(
              eq(authUserIdentity.userId, userId),
              eq(authUserIdentity.isPrimaryLogin, 1),
              isNotNull(authUserIdentity.verifiedAt),
              isNull(authUserIdentity.revokedAt)
            )
          )
          .limit(1)
          .pipe(
            Effect.mapError(mapStoreError),
            Effect.map(([identity]) => identity)
          ),
    });
  })
);
