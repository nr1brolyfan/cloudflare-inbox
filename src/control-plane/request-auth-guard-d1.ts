import { maximumSessionAuthenticationEvents } from "@effect-auth/core/Assurance";

import type { CurrentRequestAuthShape } from "../auth/session";
import {
  AUTHENTICATION_EVENT_SCHEMA_VERSION,
  CONTROL_PLANE_STEP_UP_POLICY,
} from "../auth/step-up-policy";
import type { SensitiveOperationEvidenceMethod } from "../auth/step-up-policy";

const sessionWhere = `session.id = ?
      and session.user_id = ?
      and session.secret_hash = ?
      and session.revoked_at is null
      and session.expires_at > ?
      and user.disabled_at is null
      and session.auth_time = ?
      and session.aal = ?
      and session.amr = ?
      and ((session.mfa_verified_at is null and ? is null) or session.mfa_verified_at = ?)
      and coalesce(json_array_length(
        json_extract(session.metadata, '$.__effectAuthSession.claims.requirements')
      ), 0) = 0`;

export const sessionPredicate = `exists (
  select 1
    from auth_session as session
    join auth_user as user on user.id = session.user_id
   where ${sessionWhere}
)`;

export const controlPlaneDatabaseNow =
  "cast(unixepoch('subsec') * 1000 as integer)";

export const transactionalSessionPredicate = `exists (
  select 1
    from auth_session as session
    join auth_user as user on user.id = session.user_id
   where ${sessionWhere}
     and session.expires_at > ${controlPlaneDatabaseNow}
)`;

const evidenceSqlByMethod: Readonly<
  Record<SensitiveOperationEvidenceMethod, string>
> = {
  password: `(json_extract(event.value, '$.type') = 'password'
          and json_type(event.value, '$.credentialId') = 'text')`,
  totp: `(json_extract(event.value, '$.type') = 'totp'
          and json_type(event.value, '$.factorId') = 'text'
          and json_type(event.value, '$.acceptedCounter') = 'integer'
          and json_extract(event.value, '$.acceptedCounter') >= 0)`,
  "verified-passkey": `(json_extract(event.value, '$.type') = 'passkey'
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

const acceptedEvidencePredicates = CONTROL_PLANE_STEP_UP_POLICY.acceptedEvidence
  .map((method) => evidenceSqlByMethod[method])
  .join(" or ");

export const sensitiveSessionPredicate = `exists (
  /* ${CONTROL_PLANE_STEP_UP_POLICY.id}/v${CONTROL_PLANE_STEP_UP_POLICY.version} */
  select 1
    from auth_session as session
    join auth_user as user on user.id = session.user_id
   where ${sessionWhere}
     and session.expires_at > ${controlPlaneDatabaseNow}
     and json_array_length(
       case
         when json_valid(session.authentication_events) then
           case
             when json_type(session.authentication_events) = 'array'
               then session.authentication_events
             else '[]'
           end
         else '[]'
       end
     ) <= ${maximumSessionAuthenticationEvents}
     and exists (
       select 1
          from json_each(
            case
              when json_valid(session.authentication_events) then
                case
                  when json_type(session.authentication_events) = 'array'
                    then session.authentication_events
                  else '[]'
                end
              else '[]'
            end
         ) as event
        where json_type(event.value, '$.version') = 'integer'
          and json_extract(event.value, '$.version') = ?
          and json_type(event.value, '$.verifiedAt') = 'integer'
          and json_extract(event.value, '$.verifiedAt') >= 0
          and json_extract(event.value, '$.verifiedAt')
              between ${controlPlaneDatabaseNow} - ? and ${controlPlaneDatabaseNow}
          and (${acceptedEvidencePredicates})
     )
)`;

export const sessionParams = (
  requestAuth: CurrentRequestAuthShape,
  now: number
): readonly unknown[] => {
  const { validated } = requestAuth;
  const mfaVerifiedAt = validated.issued.mfaVerifiedAt ?? null;
  return [
    validated.issued.sessionId,
    validated.issued.userId,
    requestAuth.sessionSecretHash,
    now,
    validated.issued.authTime,
    validated.issued.aal,
    JSON.stringify(validated.issued.amr),
    mfaVerifiedAt,
    mfaVerifiedAt,
  ];
};

export const sensitiveSessionParams = (
  requestAuth: CurrentRequestAuthShape,
  now: number
): readonly unknown[] => [
  ...sessionParams(requestAuth, now),
  AUTHENTICATION_EVENT_SCHEMA_VERSION,
  CONTROL_PLANE_STEP_UP_POLICY.maxAgeMs,
];
