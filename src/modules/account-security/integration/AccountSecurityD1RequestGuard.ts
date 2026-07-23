import { maximumSessionAuthenticationEvents } from "@effect-auth/core/Assurance";
import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import { authSession } from "#/auth/schema/modules/sessions";
import {
  AUTHENTICATION_EVENT_SCHEMA_VERSION,
  CONTROL_PLANE_STEP_UP_POLICY,
} from "#/modules/account-security/domain/StepUpPolicy";
import type { SensitiveOperationEvidenceMethod } from "#/modules/account-security/domain/StepUpPolicy";
import type { CurrentRequestAuthShape } from "#/modules/account-security/ports/CurrentRequestAuth";
import type { ControlPlaneDatabase } from "#/platform/control-plane-d1/ControlPlaneDatabase";
import {
  controlPlaneDatabaseNow as databaseNow,
  requiredSessionPredicate as platformRequiredSessionPredicate,
  sensitiveSessionPredicate as platformSensitiveSessionPredicate,
  sessionPredicate as platformSessionPredicate,
  transactionalSessionPredicate as platformTransactionalSessionPredicate,
} from "#/platform/control-plane-d1/RequestAuthGuard";
import type { GuardedRequestAuth } from "#/platform/control-plane-d1/RequestAuthGuard";

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
       ${databaseNow} - ${CONTROL_PLANE_STEP_UP_POLICY.maxAgeMs}
       and ${databaseNow}
     and (${sql.join(acceptedEvidencePredicates, sql` or `)})
)`;

const recoveryRemediationSession = sql<boolean>`json_array_length(
  json_extract(
    ${authSession.metadata},
    '$.__effectAuthSession.claims.requirements'
  )
) = 1
and json_extract(
  ${authSession.metadata},
  '$.__effectAuthSession.claims.requirements[0]'
) = 'recovery_remediation'
and exists (
  select 1
    from json_each(json_extract(
      ${authSession.metadata},
      '$.__effectAuthSession.claims.recoveryRemediation.allowed'
    )) as capability
   where capability.value = 'second-passkey'
)`;

const guardedRequestAuth = (
  requestAuth: CurrentRequestAuthShape
): GuardedRequestAuth => ({
  aal: requestAuth.validated.issued.aal,
  amr: requestAuth.validated.issued.amr,
  authTime: requestAuth.validated.issued.authTime,
  mfaVerifiedAt: requestAuth.validated.issued.mfaVerifiedAt ?? null,
  sessionId: requestAuth.validated.issued.sessionId,
  sessionSecretHash: requestAuth.sessionSecretHash,
  userId: requestAuth.validated.issued.userId,
});

export { controlPlaneDatabaseNow } from "#/platform/control-plane-d1/RequestAuthGuard";

export const sessionPredicate = (
  database: ControlPlaneDatabase,
  requestAuth: CurrentRequestAuthShape,
  now: number
) => platformSessionPredicate(database, guardedRequestAuth(requestAuth), now);

export const transactionalSessionPredicate = (
  database: ControlPlaneDatabase,
  requestAuth: CurrentRequestAuthShape,
  now: number
) =>
  platformTransactionalSessionPredicate(
    database,
    guardedRequestAuth(requestAuth),
    now
  );

export const sensitiveSessionPredicate = (
  database: ControlPlaneDatabase,
  requestAuth: CurrentRequestAuthShape,
  now: number
) =>
  platformSensitiveSessionPredicate(
    database,
    guardedRequestAuth(requestAuth),
    now,
    recentAuthenticationEvidence
  );

export const recoveryRemediationSessionPredicate = (
  database: ControlPlaneDatabase,
  requestAuth: CurrentRequestAuthShape,
  now: number
) =>
  platformRequiredSessionPredicate(
    database,
    guardedRequestAuth(requestAuth),
    now,
    recoveryRemediationSession
  );
