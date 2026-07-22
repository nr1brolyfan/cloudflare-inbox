import * as AuthPermission from "@effect-auth/core/Permission";
import { and, eq } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { AdministrativeAudit } from "../audit/administrative-audit";
import type { AdministrativeAuditError } from "../audit/administrative-audit-error";
import {
  externalRecoveryAddressComparisonKey,
  ExternalRecoveryIdentityId,
  ExternalRecoveryIdentitySchema,
  RecoverySafeIdentityPolicy,
} from "../auth/external-recovery-identity";
import {
  EnrollExternalRecoveryIdentityCommand,
  ExternalRecoveryIdentityChallenge,
  ExternalRecoveryIdentityDelivery,
  ExternalRecoveryIdentityManagement,
  ExternalRecoveryIdentityManagementError,
  VerifyExternalRecoveryIdentityCommand,
} from "../auth/external-recovery-identity-management";
import type { ExternalRecoveryIdentityManagementOperation } from "../auth/external-recovery-identity-management";
import type { CurrentRequestAuthShape } from "../auth/session";
import { CurrentRequestAuth } from "../auth/session";
import {
  requireSensitiveOperationStepUp,
  SensitiveOperationStepUpClock,
} from "../auth/step-up-policy";
import {
  EmailAddress,
  UnixMillis,
  Version,
  normalizeEmailAddressDomain,
} from "../mailboxes/core";
import { administrativeAuditInsertStatement } from "./administrative-audit-d1";
import * as ControlPlane from "./batch";
import { ControlPlaneDatabase } from "./database";
import {
  controlPlaneDatabaseNow,
  sensitiveSessionParams,
  sensitiveSessionPredicate,
  sessionParams,
  transactionalSessionPredicate,
} from "./request-auth-guard-d1";
import { appExternalRecoveryIdentity } from "./schema";

export interface ExternalRecoveryIdentityRuntime {
  readonly now: () => number;
  readonly randomId: () => string;
}

export const ExternalRecoveryIdentityRuntime =
  Context.Service<ExternalRecoveryIdentityRuntime>(
    "cloudflare-inbox/ExternalRecoveryIdentityRuntime"
  );

export const ExternalRecoveryIdentityRuntimeLive = Layer.succeed(
  ExternalRecoveryIdentityRuntime,
  ExternalRecoveryIdentityRuntime.of({
    now: Date.now,
    randomId: () => crypto.randomUUID(),
  })
);

const RawIdentityRow = Schema.Struct({
  address: Schema.String,
  challenge_expires_at: Schema.Number,
  comparison_key: Schema.String,
  created_at: Schema.Number,
  id: Schema.String,
  normalized_address: Schema.String,
  revoked_at: Schema.NullOr(Schema.Number),
  status: Schema.Literals(["pending", "revoked", "verified"]),
  updated_at: Schema.Number,
  user_id: Schema.String,
  verified_at: Schema.NullOr(Schema.Number),
  version: Schema.Number,
});

type RawIdentityRow = Schema.Schema.Type<typeof RawIdentityRow>;

const identityFromRow = (row: RawIdentityRow) =>
  Schema.decodeUnknownEffect(ExternalRecoveryIdentitySchema)({
    createdAt: row.created_at,
    email: {
      address: row.address,
      comparisonKey: row.comparison_key,
      normalizedAddress: row.normalized_address,
    },
    id: row.id,
    state:
      row.status === "pending"
        ? { _tag: "Pending", challengeExpiresAt: row.challenge_expires_at }
        : row.status === "verified"
          ? { _tag: "Verified", verifiedAt: row.verified_at }
          : {
              _tag: "Revoked",
              revokedAt: row.revoked_at,
              ...(row.verified_at === null
                ? {}
                : { verifiedAt: row.verified_at }),
            },
    updatedAt: row.updated_at,
    userId: row.user_id,
    version: row.version,
  });

const identityColumns = `id, user_id, address, normalized_address,
  comparison_key, status, challenge_expires_at, created_at, updated_at,
  verified_at, revoked_at, version`;

const candidateAvailablePredicate = `(not exists (
    select 1 from app_mailbox_address
     where lower(normalized_address) = ?
  ) and not exists (
    select 1 from auth_user_identity
     where kind = 'email' and revoked_at is null
       and lower(normalized_value) = ?
  ) and not exists (
    select 1 from app_external_recovery_identity
     where (status = 'verified'
         or (status = 'pending'
           and challenge_expires_at > ${controlPlaneDatabaseNow}))
       and (comparison_key = ? or user_id = ?)
       and (? is null or id <> ?)
  ))`;

const candidateParams = (
  comparisonKey: string,
  userId: string,
  excludedIdentityId?: string
) =>
  [
    comparisonKey,
    comparisonKey,
    comparisonKey,
    userId,
    excludedIdentityId ?? null,
    excludedIdentityId ?? null,
  ] as const;

const challengeAvailablePredicate = `exists (
  select 1 from auth_verification
   where id = ? and type = 'external-recovery-identity-verification'
     and subject = ? and consumed_at is null and expires_at = ?
     and json_valid(metadata) and json_extract(metadata, '$.userId') = ?
     and expires_at > ${controlPlaneDatabaseNow}
)`;

const ensureTrustedAuthInvariant = (
  requestAuth: CurrentRequestAuthShape,
  principal: AuthPermission.PermissionSubject
) => {
  const { validated } = requestAuth;
  return validated.actor.sessionId === validated.currentSession.sessionId &&
    validated.actor.sessionId === validated.issued.sessionId &&
    validated.actor.userId === validated.currentSession.userId &&
    validated.actor.userId === validated.issued.userId &&
    principal.type === "user" &&
    principal.id === validated.actor.userId
    ? Effect.void
    : Effect.die(new Error("Current request auth contexts are inconsistent"));
};

const managementError = (
  operation: ExternalRecoveryIdentityManagementOperation,
  reason: ExternalRecoveryIdentityManagementError["reason"],
  cause?: unknown
) => new ExternalRecoveryIdentityManagementError({ cause, operation, reason });

const storageError = (
  operation: ExternalRecoveryIdentityManagementOperation,
  error: ControlPlane.ControlPlaneBatchError
) =>
  new ExternalRecoveryIdentityManagementError({
    cause: error.cause,
    commitState: error.commitState,
    operation,
    reason: "storage",
  });

const auditError = (
  operation: ExternalRecoveryIdentityManagementOperation,
  error: AdministrativeAuditError
) =>
  new ExternalRecoveryIdentityManagementError({
    cause: error,
    commitState: "not-committed",
    operation,
    reason: "storage",
  });

const decodeRows = (
  results: readonly ControlPlane.ControlPlaneBatchResult[],
  statement: number,
  operation: ExternalRecoveryIdentityManagementOperation
) =>
  Schema.decodeUnknownEffect(Schema.Array(RawIdentityRow))(
    results[statement]?.results
  ).pipe(
    Effect.mapError((cause) => managementError(operation, "storage", cause))
  );

const requireUnrestricted = (
  requestAuth: CurrentRequestAuthShape,
  operation: ExternalRecoveryIdentityManagementOperation
) =>
  (requestAuth.validated.currentSession.claims?.requirements?.length ?? 0) === 0
    ? Effect.void
    : Effect.fail(managementError(operation, "restricted-session"));

/** Recovery lifecycle with session/challenge/audit changes committed atomically. */
export const ExternalRecoveryIdentityManagementLive = Layer.effect(
  ExternalRecoveryIdentityManagement,
  Effect.gen(function* () {
    const audit = yield* AdministrativeAudit;
    const batch = yield* ControlPlane.ControlPlaneBatch;
    const challenge = yield* ExternalRecoveryIdentityChallenge;
    const database = yield* ControlPlaneDatabase;
    const delivery = yield* ExternalRecoveryIdentityDelivery;
    const policy = yield* RecoverySafeIdentityPolicy;
    const runtime = yield* ExternalRecoveryIdentityRuntime;
    const stepUpClock = yield* SensitiveOperationStepUpClock;

    return ExternalRecoveryIdentityManagement.of({
      enroll: (untrustedCommand) =>
        Effect.gen(function* () {
          const command = yield* Schema.decodeUnknownEffect(
            EnrollExternalRecoveryIdentityCommand
          )(untrustedCommand).pipe(
            Effect.mapError((cause) =>
              managementError("enroll", "invalid-input", cause)
            )
          );
          const requestAuth = yield* CurrentRequestAuth;
          const principal = yield* AuthPermission.CurrentPrincipal;
          yield* ensureTrustedAuthInvariant(requestAuth, principal);
          yield* requireUnrestricted(requestAuth, "enroll");
          yield* requireSensitiveOperationStepUp(
            requestAuth.validated.currentSession,
            stepUpClock.now()
          ).pipe(
            Effect.mapError(() => managementError("enroll", "step-up-required"))
          );
          yield* policy
            .requireExternalRecoveryAddress({ address: command.address })
            .pipe(
              Effect.mapError((cause) =>
                managementError("enroll", "policy-denied", cause)
              )
            );

          const timestamp = Schema.decodeUnknownSync(UnixMillis)(runtime.now());
          const identityId = Schema.decodeUnknownSync(
            ExternalRecoveryIdentityId
          )(runtime.randomId());
          const nonce = runtime.randomId();
          const comparisonKey = externalRecoveryAddressComparisonKey(
            command.address
          );
          const normalizedAddress = normalizeEmailAddressDomain(
            command.address
          );
          const auditEvent = yield* audit
            .prepare({
              _tag: "ExternalRecoveryIdentityEnrolled",
              identityId,
              occurredAt: timestamp,
              operationId: command.operationId,
            })
            .pipe(Effect.mapError((error) => auditError("enroll", error)));
          const issued = yield* challenge.issue({
            identityId,
            userId: requestAuth.validated.actor.userId,
          });
          yield* delivery
            .sendVerification({ address: command.address, challenge: issued })
            .pipe(Effect.tapError(() => challenge.consume(issued.challengeId)));
          const baseParams = sessionParams(requestAuth, timestamp);
          const stepUpParams = sensitiveSessionParams(requestAuth, timestamp);
          const availabilityParams = candidateParams(
            comparisonKey,
            requestAuth.validated.actor.userId
          );
          const challengeParams = [
            issued.challengeId,
            identityId,
            issued.expiresAt,
            requestAuth.validated.actor.userId,
          ] as const;
          const statements: readonly ControlPlane.ControlPlaneStatement[] = [
            {
              sql: `insert into app_authorization_guard (nonce)
                    select ? where ${sensitiveSessionPredicate}
                      and ${challengeAvailablePredicate}
                      and ${candidateAvailablePredicate}`,
              params: [
                nonce,
                ...stepUpParams,
                ...challengeParams,
                ...availabilityParams,
              ],
            },
            {
              sql: `select cast(${transactionalSessionPredicate} as integer)
                              as session_valid,
                           cast(${sensitiveSessionPredicate} as integer)
                              as step_up_valid,
                           cast(${challengeAvailablePredicate} as integer)
                              as challenge_valid,
                           cast(${candidateAvailablePredicate} as integer)
                              as candidate_available,
                           cast(exists (select 1 from app_authorization_guard
                                        where nonce = ?) as integer)
                              as authorized`,
              params: [
                ...baseParams,
                ...stepUpParams,
                ...challengeParams,
                ...availabilityParams,
                nonce,
              ],
            },
            {
              sql: `insert into app_external_recovery_identity
                      (id, user_id, address, normalized_address, comparison_key,
                       status, challenge_id, challenge_expires_at,
                       enrollment_operation_id, created_at, updated_at, version)
                    select ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, 1
                      from app_authorization_guard where nonce = ?
                    returning ${identityColumns}`,
              params: [
                identityId,
                requestAuth.validated.actor.userId,
                command.address,
                normalizedAddress,
                comparisonKey,
                issued.challengeId,
                issued.expiresAt,
                command.operationId,
                timestamp,
                timestamp,
                nonce,
              ],
            },
            administrativeAuditInsertStatement(auditEvent, nonce),
            {
              sql: "delete from app_authorization_guard where nonce = ?",
              params: [nonce],
            },
          ];
          const results = yield* batch.execute(statements).pipe(
            Effect.tapError((error) =>
              error.commitState === "unknown"
                ? Effect.void
                : challenge.consume(issued.challengeId)
            ),
            Effect.mapError((error) => storageError("enroll", error))
          );
          const status = yield* Schema.decodeUnknownEffect(
            Schema.Array(
              Schema.Struct({
                authorized: Schema.Number,
                candidate_available: Schema.Number,
                challenge_valid: Schema.Number,
                session_valid: Schema.Number,
                step_up_valid: Schema.Number,
              })
            )
          )(results[1]?.results).pipe(
            Effect.mapError((cause) =>
              managementError("enroll", "storage", cause)
            )
          );
          if (status[0]?.authorized !== 1) {
            yield* challenge.consume(issued.challengeId);
            if (status[0]?.session_valid !== 1) {
              return yield* managementError("enroll", "restricted-session");
            }
            if (status[0].step_up_valid !== 1) {
              return yield* managementError("enroll", "step-up-required");
            }
            return yield* managementError("enroll", "policy-denied");
          }
          const [row] = yield* decodeRows(results, 2, "enroll");
          if (row === undefined) {
            return yield* managementError("enroll", "storage");
          }
          return yield* identityFromRow(row).pipe(
            Effect.mapError((cause) =>
              managementError("enroll", "storage", cause)
            )
          );
        }),
      verify: (untrustedCommand) =>
        Effect.gen(function* () {
          const command = yield* Schema.decodeUnknownEffect(
            VerifyExternalRecoveryIdentityCommand
          )(untrustedCommand).pipe(
            Effect.mapError((cause) =>
              managementError("verify", "invalid-input", cause)
            )
          );
          const requestAuth = yield* CurrentRequestAuth;
          const principal = yield* AuthPermission.CurrentPrincipal;
          yield* ensureTrustedAuthInvariant(requestAuth, principal);
          yield* requireUnrestricted(requestAuth, "verify");
          const [stored] = yield* database
            .select()
            .from(appExternalRecoveryIdentity)
            .where(
              and(
                eq(
                  appExternalRecoveryIdentity.challengeId,
                  command.challengeId
                ),
                eq(
                  appExternalRecoveryIdentity.userId,
                  requestAuth.validated.actor.userId
                ),
                eq(appExternalRecoveryIdentity.status, "pending")
              )
            )
            .limit(1)
            .pipe(
              Effect.mapError((cause) =>
                managementError("verify", "storage", cause)
              )
            );
          if (stored === undefined) {
            return yield* managementError("verify", "challenge-invalid");
          }
          const identityId = Schema.decodeUnknownSync(
            ExternalRecoveryIdentityId
          )(stored.id);
          if (stored.version !== command.expectedVersion) {
            return yield* managementError("verify", "version-conflict");
          }
          yield* challenge.inspect({
            challengeId: command.challengeId,
            identityId,
            secret: command.secret,
            userId: requestAuth.validated.actor.userId,
          });
          const storedAddress = yield* Schema.decodeUnknownEffect(EmailAddress)(
            stored.address
          ).pipe(
            Effect.mapError((cause) =>
              managementError("verify", "storage", cause)
            )
          );
          yield* policy
            .requireExternalRecoveryAddress({
              address: storedAddress,
              excludeRecoveryIdentityId: identityId,
            })
            .pipe(
              Effect.mapError((cause) =>
                managementError("verify", "policy-denied", cause)
              )
            );

          const timestamp = Schema.decodeUnknownSync(UnixMillis)(runtime.now());
          const nonce = runtime.randomId();
          const beforeVersion = Schema.decodeUnknownSync(Version)(
            stored.version
          );
          const auditEvent = yield* audit
            .prepare({
              _tag: "ExternalRecoveryIdentityVerified",
              beforeVersion,
              identityId,
              occurredAt: timestamp,
              operationId: command.operationId,
            })
            .pipe(Effect.mapError((error) => auditError("verify", error)));
          const trustedSessionParams = sessionParams(requestAuth, timestamp);
          const availabilityParams = candidateParams(
            stored.comparisonKey,
            requestAuth.validated.actor.userId,
            identityId
          );
          const identityPredicate = `exists (
            select 1 from app_external_recovery_identity
             where id = ? and user_id = ? and challenge_id = ?
               and status = 'pending' and version = ?
          )`;
          const identityParams = [
            identityId,
            requestAuth.validated.actor.userId,
            command.challengeId,
            beforeVersion,
          ] as const;
          const challengeParams = [
            command.challengeId,
            identityId,
            stored.challengeExpiresAt,
            requestAuth.validated.actor.userId,
          ] as const;
          const statements: readonly ControlPlane.ControlPlaneStatement[] = [
            {
              sql: `insert into app_authorization_guard (nonce)
                    select ? where ${transactionalSessionPredicate}
                      and ${identityPredicate}
                      and ${challengeAvailablePredicate}
                      and ${candidateAvailablePredicate}`,
              params: [
                nonce,
                ...trustedSessionParams,
                ...identityParams,
                ...challengeParams,
                ...availabilityParams,
              ],
            },
            {
              sql: `select cast(${transactionalSessionPredicate} as integer)
                              as session_valid,
                           cast(${identityPredicate} as integer)
                              as identity_valid,
                           cast(${challengeAvailablePredicate} as integer)
                              as challenge_valid,
                           cast(${candidateAvailablePredicate} as integer)
                              as candidate_available,
                           cast(exists (select 1 from app_authorization_guard
                                        where nonce = ?) as integer)
                              as authorized`,
              params: [
                ...trustedSessionParams,
                ...identityParams,
                ...challengeParams,
                ...availabilityParams,
                nonce,
              ],
            },
            {
              sql: `update auth_verification set consumed_at = ?
                     where id = ? and type = 'external-recovery-identity-verification'
                       and subject = ? and consumed_at is null
                       and expires_at = ? and expires_at > ${controlPlaneDatabaseNow}
                       and exists (select 1 from app_authorization_guard
                                    where nonce = ?)`,
              params: [
                timestamp,
                command.challengeId,
                identityId,
                stored.challengeExpiresAt,
                nonce,
              ],
            },
            {
              sql: `update app_external_recovery_identity
                       set status = 'verified', verified_at = ?, updated_at = ?,
                           version = version + 1
                     where id = ? and user_id = ? and challenge_id = ?
                       and status = 'pending' and version = ?
                       and exists (select 1 from app_authorization_guard
                                    where nonce = ?)
                     returning ${identityColumns}`,
              params: [
                timestamp,
                timestamp,
                identityId,
                requestAuth.validated.actor.userId,
                command.challengeId,
                beforeVersion,
                nonce,
              ],
            },
            administrativeAuditInsertStatement(auditEvent, nonce),
            {
              sql: "delete from app_authorization_guard where nonce = ?",
              params: [nonce],
            },
          ];
          const results = yield* batch
            .execute(statements)
            .pipe(Effect.mapError((error) => storageError("verify", error)));
          const status = yield* Schema.decodeUnknownEffect(
            Schema.Array(
              Schema.Struct({
                authorized: Schema.Number,
                candidate_available: Schema.Number,
                challenge_valid: Schema.Number,
                identity_valid: Schema.Number,
                session_valid: Schema.Number,
              })
            )
          )(results[1]?.results).pipe(
            Effect.mapError((cause) =>
              managementError("verify", "storage", cause)
            )
          );
          if (status[0]?.authorized !== 1) {
            if (status[0]?.session_valid !== 1) {
              return yield* managementError("verify", "restricted-session");
            }
            if (status[0].identity_valid !== 1) {
              return yield* managementError("verify", "version-conflict");
            }
            if (status[0].challenge_valid !== 1) {
              return yield* managementError("verify", "challenge-invalid");
            }
            return yield* managementError("verify", "policy-denied");
          }
          const [row] = yield* decodeRows(results, 3, "verify");
          if (row === undefined) {
            return yield* managementError("verify", "storage");
          }
          return yield* identityFromRow(row).pipe(
            Effect.mapError((cause) =>
              managementError("verify", "storage", cause)
            )
          );
        }),
    });
  })
);
