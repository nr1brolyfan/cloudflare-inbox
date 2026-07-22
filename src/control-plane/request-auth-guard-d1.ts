import { maximumSessionAuthenticationEvents } from "@effect-auth/core/Assurance";
import { and, eq, exists, gt, isNull, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import { authUser } from "../auth/schema/modules/core";
import { authSession } from "../auth/schema/modules/sessions";
import type { CurrentRequestAuthShape } from "../auth/session";
import {
  AUTHENTICATION_EVENT_SCHEMA_VERSION,
  CONTROL_PLANE_STEP_UP_POLICY,
} from "../auth/step-up-policy";
import type { SensitiveOperationEvidenceMethod } from "../auth/step-up-policy";
import type { ControlPlaneDatabase } from "./database";

export const controlPlaneDatabaseNow = sql<number>`cast(
  unixepoch('subsec') * 1000 as integer
 )`;

const evidenceSqlByMethod: Readonly<
  Record<SensitiveOperationEvidenceMethod, SQL<boolean>>
> = {
  password: sql<boolean>`(json_extract(event.value, '$.type') = 'password'
          and json_type(event.value, '$.credentialId') = 'text')`,
  totp: sql<boolean>`(json_extract(event.value, '$.type') = 'totp'
          and json_type(event.value, '$.factorId') = 'text'
          and json_type(event.value, '$.acceptedCounter') = 'integer'
          and json_extract(event.value, '$.acceptedCounter') >= 0)`,
  "verified-passkey": sql<boolean>`(json_extract(event.value, '$.type') = 'passkey'
          and json_type(event.value, '$.credentialId') = 'text'
          and json_extract(event.value, '$.userVerification') = 'verified'
          and (json_type(event.value, '$.authenticatorAttachment') is null
            or json_extract(event.value, '$.authenticatorAttachment')
              in ('platform', 'cross-platform'))
          and (json_type(event.value, '$.backedUp') is null
            or json_type(event.value, '$.backedUp') in ('true', 'false'))
          and (json_type(event.value, '$.backupEligible') is null
            or json_type(event.value, '$.backupEligible') in ('true', 'false'))
          and (json_type(event.value, '$.signCount') is null
            or (json_type(event.value, '$.signCount') = 'integer'
              and json_extract(event.value, '$.signCount') >= 0))
          and (json_type(event.value, '$.aaguid') is null
           or (json_type(event.value, '$.aaguid') = 'text'
              and length(json_extract(event.value, '$.aaguid')) > 0)))`,
};

const acceptedEvidencePredicates =
  CONTROL_PLANE_STEP_UP_POLICY.acceptedEvidence.map(
    (method) => evidenceSqlByMethod[method]
  );

const unrestrictedSession = sql<boolean>`coalesce(json_array_length(
  json_extract(
    ${authSession.metadata},
    '$.__effectAuthSession.claims.requirements'
  )
), 0) = 0`;

const recentAuthenticationEvidence = sql<boolean>`json_array_length(
  case
    when json_valid(${authSession.authenticationEvents}) then
      case
        when json_type(${authSession.authenticationEvents}) = 'array'
          then ${authSession.authenticationEvents}
        else '[]'
      end
    else '[]'
  end
) <= ${maximumSessionAuthenticationEvents}
and exists (
  select 1
    from json_each(
      case
        when json_valid(${authSession.authenticationEvents}) then
          case
            when json_type(${authSession.authenticationEvents}) = 'array'
              then ${authSession.authenticationEvents}
            else '[]'
          end
        else '[]'
      end
    ) as event
   where json_type(event.value, '$.version') = 'integer'
     and json_extract(event.value, '$.version') = ${AUTHENTICATION_EVENT_SCHEMA_VERSION}
     and json_type(event.value, '$.verifiedAt') = 'integer'
     and json_extract(event.value, '$.verifiedAt') >= 0
     and json_extract(event.value, '$.verifiedAt') between
       ${controlPlaneDatabaseNow} - ${CONTROL_PLANE_STEP_UP_POLICY.maxAgeMs}
       and ${controlPlaneDatabaseNow}
     and (${sql.join(acceptedEvidencePredicates, sql` or `)})
)`;

const sessionWhere = (
  requestAuth: CurrentRequestAuthShape,
  now: number,
  databaseTime: boolean,
  sensitive: boolean
) => {
  const { validated } = requestAuth;
  const mfaVerifiedAt = validated.issued.mfaVerifiedAt ?? null;
  return and(
    eq(authSession.id, validated.issued.sessionId),
    eq(authSession.userId, validated.issued.userId),
    eq(authSession.secretHash, requestAuth.sessionSecretHash),
    isNull(authSession.revokedAt),
    gt(authSession.expiresAt, now),
    isNull(authUser.disabledAt),
    eq(authSession.authTime, validated.issued.authTime),
    eq(authSession.aal, validated.issued.aal),
    eq(authSession.amr, JSON.stringify(validated.issued.amr)),
    mfaVerifiedAt === null
      ? isNull(authSession.mfaVerifiedAt)
      : eq(authSession.mfaVerifiedAt, mfaVerifiedAt),
    unrestrictedSession,
    databaseTime
      ? gt(authSession.expiresAt, controlPlaneDatabaseNow)
      : undefined,
    sensitive ? recentAuthenticationEvidence : undefined
  );
};

const sessionExists = (
  database: ControlPlaneDatabase,
  requestAuth: CurrentRequestAuthShape,
  now: number,
  databaseTime: boolean,
  sensitive: boolean
) =>
  exists(
    database
      .select({ value: sql`1` })
      .from(authSession)
      .innerJoin(authUser, eq(authUser.id, authSession.userId))
      .where(sessionWhere(requestAuth, now, databaseTime, sensitive))
  );

export const sessionPredicate = (
  database: ControlPlaneDatabase,
  requestAuth: CurrentRequestAuthShape,
  now: number
) => sessionExists(database, requestAuth, now, false, false);

export const transactionalSessionPredicate = (
  database: ControlPlaneDatabase,
  requestAuth: CurrentRequestAuthShape,
  now: number
) => sessionExists(database, requestAuth, now, true, false);

export const sensitiveSessionPredicate = (
  database: ControlPlaneDatabase,
  requestAuth: CurrentRequestAuthShape,
  now: number
) => sessionExists(database, requestAuth, now, true, true);
