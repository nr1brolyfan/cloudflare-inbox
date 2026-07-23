import * as AuthPermission from "@effect-auth/core/Permission";
import {
  and,
  eq,
  exists,
  gt,
  isNull,
  ne,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { administrativeAuditInsertStatement } from "#/modules/administrative-audit/adapters/d1/AdministrativeAuditD1";
import { AdministrativeAudit } from "#/modules/administrative-audit/application/AdministrativeAudit";
import type { AdministrativeAuditError } from "#/modules/administrative-audit/application/AdministrativeAuditError";
import {
  EmailAddress,
  Version,
  normalizeEmailAddressDomain,
} from "#/modules/mailbox/domain/Mailbox";
import { appMailboxAddress } from "#/modules/organization/adapters/d1/OrganizationSchema";
import { UnixMillis } from "#/shared/Temporal";

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
import { authUserIdentity } from "../auth/schema/modules/core";
import { authVerification } from "../auth/schema/modules/verification";
import type { CurrentRequestAuthShape } from "../auth/session";
import { CurrentRequestAuth } from "../auth/session";
import {
  requireSensitiveOperationStepUp,
  SensitiveOperationStepUpClock,
} from "../auth/step-up-policy";
import * as ControlPlane from "../platform/control-plane-d1/ControlPlaneBatch";
import { ControlPlaneDatabase } from "../platform/control-plane-d1/ControlPlaneDatabase";
import {
  appAuthorizationGuard,
  appExternalRecoveryIdentity,
} from "../platform/control-plane-d1/ControlPlaneSchema";
import {
  controlPlaneDatabaseNow,
  sensitiveSessionPredicate,
  transactionalSessionPredicate,
} from "../platform/control-plane-d1/RequestAuthGuard";

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

const identityReturning = {
  address: appExternalRecoveryIdentity.address,
  challenge_expires_at: appExternalRecoveryIdentity.challengeExpiresAt,
  comparison_key: appExternalRecoveryIdentity.comparisonKey,
  created_at: appExternalRecoveryIdentity.createdAt,
  id: appExternalRecoveryIdentity.id,
  normalized_address: appExternalRecoveryIdentity.normalizedAddress,
  revoked_at: appExternalRecoveryIdentity.revokedAt,
  status: appExternalRecoveryIdentity.status,
  updated_at: appExternalRecoveryIdentity.updatedAt,
  user_id: appExternalRecoveryIdentity.userId,
  verified_at: appExternalRecoveryIdentity.verifiedAt,
  version: appExternalRecoveryIdentity.version,
} as const;

const candidateAvailablePredicate = (
  database: ControlPlaneDatabase,
  comparisonKey: string,
  userId: string,
  excludedIdentityId?: string
) =>
  and(
    notExists(
      database
        .select({ value: sql`1` })
        .from(appMailboxAddress)
        .where(
          sql`lower(${appMailboxAddress.normalizedAddress}) = ${comparisonKey}`
        )
    ),
    notExists(
      database
        .select({ value: sql`1` })
        .from(authUserIdentity)
        .where(
          and(
            eq(authUserIdentity.kind, "email"),
            isNull(authUserIdentity.revokedAt),
            sql`lower(${authUserIdentity.normalizedValue}) = ${comparisonKey}`
          )
        )
    ),
    notExists(
      database
        .select({ value: sql`1` })
        .from(appExternalRecoveryIdentity)
        .where(
          and(
            or(
              eq(appExternalRecoveryIdentity.status, "verified"),
              and(
                eq(appExternalRecoveryIdentity.status, "pending"),
                gt(
                  appExternalRecoveryIdentity.challengeExpiresAt,
                  controlPlaneDatabaseNow
                )
              )
            ),
            or(
              eq(appExternalRecoveryIdentity.comparisonKey, comparisonKey),
              eq(appExternalRecoveryIdentity.userId, userId)
            ),
            excludedIdentityId === undefined
              ? undefined
              : ne(appExternalRecoveryIdentity.id, excludedIdentityId)
          )
        )
    )
  );

const challengeAvailablePredicate = (
  database: ControlPlaneDatabase,
  challengeId: string,
  identityId: string,
  expiresAt: number,
  userId: string
) =>
  exists(
    database
      .select({ value: sql`1` })
      .from(authVerification)
      .where(
        and(
          eq(authVerification.id, challengeId),
          eq(authVerification.type, "external-recovery-identity-verification"),
          eq(authVerification.subject, identityId),
          isNull(authVerification.consumedAt),
          eq(authVerification.expiresAt, expiresAt),
          sql`json_valid(${authVerification.metadata})`,
          sql`json_extract(${authVerification.metadata}, '$.userId') = ${userId}`,
          gt(authVerification.expiresAt, controlPlaneDatabaseNow)
        )
      )
  );

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
          const trustedBaseSession = transactionalSessionPredicate(
            database,
            requestAuth,
            timestamp
          );
          const trustedStepUpSession = sensitiveSessionPredicate(
            database,
            requestAuth,
            timestamp
          );
          const candidateAvailable = candidateAvailablePredicate(
            database,
            comparisonKey,
            requestAuth.validated.actor.userId
          );
          const challengeAvailable = challengeAvailablePredicate(
            database,
            issued.challengeId,
            identityId,
            issued.expiresAt,
            requestAuth.validated.actor.userId
          );
          const authorized = exists(
            database
              .select({ value: sql`1` })
              .from(appAuthorizationGuard)
              .where(eq(appAuthorizationGuard.nonce, nonce))
          );
          const statements: ControlPlane.ControlPlaneStatements = [
            database.insert(appAuthorizationGuard).select(
              sql`select ${nonce} where ${trustedStepUpSession}
                      and ${challengeAvailable}
                      and ${candidateAvailable}`
            ),
            database.all(sql`select cast(${trustedBaseSession} as integer)
                                      as session_valid,
                                   cast(${trustedStepUpSession} as integer)
                                      as step_up_valid,
                                   cast(${challengeAvailable} as integer)
                                      as challenge_valid,
                                   cast(${candidateAvailable} as integer)
                                      as candidate_available,
                                   cast(${authorized} as integer) as authorized`),
            database
              .insert(appExternalRecoveryIdentity)
              .select(
                database
                  .select({
                    address: sql`${command.address}`.as("address"),
                    challengeExpiresAt: sql`${issued.expiresAt}`.as(
                      "challenge_expires_at"
                    ),
                    challengeId: sql`${issued.challengeId}`.as("challenge_id"),
                    comparisonKey: sql`${comparisonKey}`.as("comparison_key"),
                    createdAt: sql`${timestamp}`.as("created_at"),
                    enrollmentOperationId: sql`${command.operationId}`.as(
                      "enrollment_operation_id"
                    ),
                    id: sql`${identityId}`.as("id"),
                    normalizedAddress: sql`${normalizedAddress}`.as(
                      "normalized_address"
                    ),
                    status: sql`${"pending"}`.as("status"),
                    updatedAt: sql`${timestamp}`.as("updated_at"),
                    userId: sql`${requestAuth.validated.actor.userId}`.as(
                      "user_id"
                    ),
                    version: sql<number>`1`.as("version"),
                  })
                  .from(appAuthorizationGuard)
                  .where(eq(appAuthorizationGuard.nonce, nonce))
              )
              .returning(identityReturning),
            administrativeAuditInsertStatement(database, auditEvent, nonce),
            database
              .delete(appAuthorizationGuard)
              .where(eq(appAuthorizationGuard.nonce, nonce)),
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
          const trustedSession = transactionalSessionPredicate(
            database,
            requestAuth,
            timestamp
          );
          const candidateAvailable = candidateAvailablePredicate(
            database,
            stored.comparisonKey,
            requestAuth.validated.actor.userId,
            identityId
          );
          const identityValid = exists(
            database
              .select({ value: sql`1` })
              .from(appExternalRecoveryIdentity)
              .where(
                and(
                  eq(appExternalRecoveryIdentity.id, identityId),
                  eq(
                    appExternalRecoveryIdentity.userId,
                    requestAuth.validated.actor.userId
                  ),
                  eq(
                    appExternalRecoveryIdentity.challengeId,
                    command.challengeId
                  ),
                  eq(appExternalRecoveryIdentity.status, "pending"),
                  eq(appExternalRecoveryIdentity.version, beforeVersion)
                )
              )
          );
          const challengeAvailable = challengeAvailablePredicate(
            database,
            command.challengeId,
            identityId,
            stored.challengeExpiresAt,
            requestAuth.validated.actor.userId
          );
          const authorized = exists(
            database
              .select({ value: sql`1` })
              .from(appAuthorizationGuard)
              .where(eq(appAuthorizationGuard.nonce, nonce))
          );
          const statements: ControlPlane.ControlPlaneStatements = [
            database.insert(appAuthorizationGuard).select(
              sql`select ${nonce} where ${trustedSession}
                      and ${identityValid}
                      and ${challengeAvailable}
                      and ${candidateAvailable}`
            ),
            database.all(sql`select cast(${trustedSession} as integer)
                                      as session_valid,
                                   cast(${identityValid} as integer)
                                      as identity_valid,
                                   cast(${challengeAvailable} as integer)
                                      as challenge_valid,
                                   cast(${candidateAvailable} as integer)
                                      as candidate_available,
                                   cast(${authorized} as integer) as authorized`),
            database
              .update(authVerification)
              .set({ consumedAt: timestamp })
              .where(
                and(
                  eq(authVerification.id, command.challengeId),
                  eq(
                    authVerification.type,
                    "external-recovery-identity-verification"
                  ),
                  eq(authVerification.subject, identityId),
                  isNull(authVerification.consumedAt),
                  eq(authVerification.expiresAt, stored.challengeExpiresAt),
                  gt(authVerification.expiresAt, controlPlaneDatabaseNow),
                  authorized
                )
              ),
            database
              .update(appExternalRecoveryIdentity)
              .set({
                status: "verified",
                updatedAt: timestamp,
                verifiedAt: timestamp,
                version: sql`${appExternalRecoveryIdentity.version} + 1`,
              })
              .where(
                and(
                  eq(appExternalRecoveryIdentity.id, identityId),
                  eq(
                    appExternalRecoveryIdentity.userId,
                    requestAuth.validated.actor.userId
                  ),
                  eq(
                    appExternalRecoveryIdentity.challengeId,
                    command.challengeId
                  ),
                  eq(appExternalRecoveryIdentity.status, "pending"),
                  eq(appExternalRecoveryIdentity.version, beforeVersion),
                  authorized
                )
              )
              .returning(identityReturning),
            administrativeAuditInsertStatement(database, auditEvent, nonce),
            database
              .delete(appAuthorizationGuard)
              .where(eq(appAuthorizationGuard.nonce, nonce)),
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
