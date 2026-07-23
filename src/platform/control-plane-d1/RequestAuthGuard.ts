import { and, eq, exists, gt, isNull, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import { authUser } from "../../auth/schema/modules/core";
import { authSession } from "../../auth/schema/modules/sessions";
import type { ControlPlaneDatabase } from "./ControlPlaneDatabase";

export const controlPlaneDatabaseNow = sql<number>`cast(
  unixepoch('subsec') * 1000 as integer
 )`;

const unrestrictedSession = sql<boolean>`coalesce(json_array_length(
  json_extract(
    ${authSession.metadata},
    '$.__effectAuthSession.claims.requirements'
  )
), 0) = 0`;

export interface GuardedRequestAuth {
  readonly aal: string;
  readonly amr: readonly string[];
  readonly authTime: number;
  readonly mfaVerifiedAt: number | null;
  readonly sessionId: string;
  readonly sessionSecretHash: string;
  readonly userId: string;
}

const sessionWhere = (
  requestAuth: GuardedRequestAuth,
  now: number,
  databaseTime: boolean,
  requirement: SQL<boolean> = unrestrictedSession,
  additionalPredicate?: SQL<boolean>
) =>
  and(
    eq(authSession.id, requestAuth.sessionId),
    eq(authSession.userId, requestAuth.userId),
    eq(authSession.secretHash, requestAuth.sessionSecretHash),
    isNull(authSession.revokedAt),
    gt(authSession.expiresAt, now),
    isNull(authUser.disabledAt),
    eq(authSession.authTime, requestAuth.authTime),
    eq(authSession.aal, requestAuth.aal),
    eq(authSession.amr, JSON.stringify(requestAuth.amr)),
    requestAuth.mfaVerifiedAt === null
      ? isNull(authSession.mfaVerifiedAt)
      : eq(authSession.mfaVerifiedAt, requestAuth.mfaVerifiedAt),
    requirement,
    databaseTime
      ? gt(authSession.expiresAt, controlPlaneDatabaseNow)
      : undefined,
    additionalPredicate
  );

const sessionExists = (
  database: ControlPlaneDatabase,
  requestAuth: GuardedRequestAuth,
  now: number,
  databaseTime: boolean,
  requirement?: SQL<boolean>,
  additionalPredicate?: SQL<boolean>
) =>
  exists(
    database
      .select({ value: sql`1` })
      .from(authSession)
      .innerJoin(authUser, eq(authUser.id, authSession.userId))
      .where(
        sessionWhere(
          requestAuth,
          now,
          databaseTime,
          requirement,
          additionalPredicate
        )
      )
  );

export const sessionPredicate = (
  database: ControlPlaneDatabase,
  requestAuth: GuardedRequestAuth,
  now: number
) => sessionExists(database, requestAuth, now, false);

export const transactionalSessionPredicate = (
  database: ControlPlaneDatabase,
  requestAuth: GuardedRequestAuth,
  now: number
) => sessionExists(database, requestAuth, now, true);

export const sensitiveSessionPredicate = (
  database: ControlPlaneDatabase,
  requestAuth: GuardedRequestAuth,
  now: number,
  recentAuthenticationEvidence: SQL<boolean>
) =>
  sessionExists(
    database,
    requestAuth,
    now,
    true,
    unrestrictedSession,
    recentAuthenticationEvidence
  );

export const requiredSessionPredicate = (
  database: ControlPlaneDatabase,
  requestAuth: GuardedRequestAuth,
  now: number,
  requirement: SQL<boolean>
) => sessionExists(database, requestAuth, now, true, requirement);
