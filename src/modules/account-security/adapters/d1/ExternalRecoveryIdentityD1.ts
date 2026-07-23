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

import { authUserIdentity } from "#/auth/schema/modules/core";
import { authVerification } from "#/auth/schema/modules/verification";
import {
  EnrollExternalRecoveryIdentityCommand,
  ExternalRecoveryIdentityManagement,
  ExternalRecoveryIdentityManagementError,
  ExternalRecoveryIdentityOperationReceipt,
  ExternalRecoveryIdentityOperationReceiptSchema,
  ReadExternalRecoveryIdentityOperationQuery,
  VerifyExternalRecoveryIdentityCommand,
} from "#/modules/account-security/application/ExternalRecoveryIdentityManagement";
import type { ExternalRecoveryIdentityManagementOperation } from "#/modules/account-security/application/ExternalRecoveryIdentityManagement";
import {
  externalRecoveryAddressComparisonKey,
  ExternalRecoveryIdentityId,
  ExternalRecoveryIdentitySchema,
} from "#/modules/account-security/domain/ExternalRecoveryIdentity";
import { requireSensitiveOperationStepUp } from "#/modules/account-security/domain/StepUpPolicy";
import {
  sensitiveSessionPredicate,
  transactionalSessionPredicate,
} from "#/modules/account-security/integration/AccountSecurityD1RequestGuard";
import { ExternalRecoveryIdentityChallenge } from "#/modules/account-security/ports/ExternalRecoveryIdentityChallenge";
import { ExternalRecoveryIdentityDelivery } from "#/modules/account-security/ports/ExternalRecoveryIdentityDelivery";
import { ExternalRecoveryIdentityTransaction } from "#/modules/account-security/ports/ExternalRecoveryIdentityTransaction";
import { RecoverySafeIdentityPolicy } from "#/modules/account-security/ports/RecoverySafeIdentityPolicy";
import { SensitiveOperationStepUpClock } from "#/modules/account-security/ports/SensitiveOperationStepUpClock";
import { mailboxAddressAvailablePredicate } from "#/modules/address-routing/integration/AddressRoutingD1Statements";
import { AdministrativeAudit } from "#/modules/administrative-audit/contracts/AdministrativeAudit";
import type { AdministrativeAuditError } from "#/modules/administrative-audit/contracts/AdministrativeAuditError";
import { administrativeAuditInsertStatement } from "#/modules/administrative-audit/integration/AdministrativeAuditD1Statements";
import { appAuthorizationGuard } from "#/platform/control-plane-d1/AuthorizationGuardSchema";
import * as ControlPlane from "#/platform/control-plane-d1/ControlPlaneBatch";
import { ControlPlaneDatabase } from "#/platform/control-plane-d1/ControlPlaneDatabase";
import { controlPlaneDatabaseNow } from "#/platform/control-plane-d1/RequestAuthGuard";
import {
  EmailAddress,
  normalizeEmailAddressDomain,
} from "#/shared/EmailAddress";
import { CurrentRequestAuth } from "#/shared/RequestAuth";
import type { CurrentRequestAuthShape } from "#/shared/RequestAuth";
import { UnixMillis, Version } from "#/shared/Temporal";

import {
  appExternalRecoveryIdentity,
  appExternalRecoveryOperationReceipt,
} from "./AccountSecuritySchema";

export interface ExternalRecoveryIdentityRuntimeShape {
  readonly now: () => number;
  readonly randomId: () => string;
}

export class ExternalRecoveryIdentityRuntime extends Context.Service<
  ExternalRecoveryIdentityRuntime,
  ExternalRecoveryIdentityRuntimeShape
>()("cloudflare-inbox/ExternalRecoveryIdentityRuntime") {}

export const ExternalRecoveryIdentityRuntimeLayer = Layer.succeed(
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

const ReceiptRow = Schema.Struct({
  actor_user_id: Schema.String,
  challenge_id: Schema.NullOr(Schema.String),
  committed_at: Schema.Number,
  expected_identity_version: Schema.NullOr(Schema.Number),
  identity_id: Schema.String,
  identity_address: Schema.String,
  identity_comparison_key: Schema.String,
  identity_normalized_address: Schema.String,
  operation_id: Schema.String,
  operation_kind: Schema.Literals(["enroll", "verify"]),
  result_challenge_expires_at: Schema.Number,
  result_created_at: Schema.Number,
  result_revoked_at: Schema.NullOr(Schema.Number),
  result_status: Schema.Literals(["pending", "verified"]),
  result_updated_at: Schema.Number,
  result_user_id: Schema.String,
  result_verified_at: Schema.NullOr(Schema.Number),
  result_version: Schema.Number,
  schema_version: Schema.Literal(1),
  verification_secret_hash: Schema.NullOr(Schema.String),
});

type ReceiptRow = Schema.Schema.Type<typeof ReceiptRow>;

interface StoredReceipt {
  readonly receipt: ExternalRecoveryIdentityOperationReceipt;
  readonly verificationSecretHash: string | null;
}

const receiptFromRow = (
  row: ReceiptRow,
  operation: ExternalRecoveryIdentityManagementOperation
) =>
  Effect.gen(function* () {
    const result = yield* identityFromRow({
      address: row.identity_address,
      challenge_expires_at: row.result_challenge_expires_at,
      comparison_key: row.identity_comparison_key,
      created_at: row.result_created_at,
      id: row.identity_id,
      normalized_address: row.identity_normalized_address,
      revoked_at: row.result_revoked_at,
      status: row.result_status,
      updated_at: row.result_updated_at,
      user_id: row.result_user_id,
      verified_at: row.result_verified_at,
      version: row.result_version,
    });
    const receipt = yield* Schema.decodeUnknownEffect(
      ExternalRecoveryIdentityOperationReceiptSchema
    )({
      actorUserId: row.actor_user_id,
      ...(row.challenge_id === null ? {} : { challengeId: row.challenge_id }),
      committedAt: row.committed_at,
      ...(row.expected_identity_version === null
        ? {}
        : { expectedIdentityVersion: row.expected_identity_version }),
      identityId: row.identity_id,
      operationId: row.operation_id,
      operationKind: row.operation_kind,
      result,
      schemaVersion: row.schema_version,
    });
    if (
      (receipt.operationKind === "enroll") !==
      (row.verification_secret_hash === null)
    ) {
      return yield* managementError(operation, "storage");
    }
    return {
      receipt,
      verificationSecretHash: row.verification_secret_hash,
    } satisfies StoredReceipt;
  }).pipe(
    Effect.mapError((cause) => managementError(operation, "storage", cause))
  );

const receiptReadSelection = {
  actor_user_id: appExternalRecoveryOperationReceipt.actorUserId,
  challenge_id: appExternalRecoveryOperationReceipt.challengeId,
  committed_at: appExternalRecoveryOperationReceipt.committedAt,
  expected_identity_version:
    appExternalRecoveryOperationReceipt.expectedIdentityVersion,
  identity_id: appExternalRecoveryOperationReceipt.identityId,
  identity_address: appExternalRecoveryIdentity.address,
  identity_comparison_key: appExternalRecoveryIdentity.comparisonKey,
  identity_normalized_address: appExternalRecoveryIdentity.normalizedAddress,
  operation_id: appExternalRecoveryOperationReceipt.operationId,
  operation_kind: appExternalRecoveryOperationReceipt.operationKind,
  result_challenge_expires_at:
    appExternalRecoveryOperationReceipt.resultChallengeExpiresAt,
  result_created_at: appExternalRecoveryOperationReceipt.resultCreatedAt,
  result_revoked_at: appExternalRecoveryOperationReceipt.resultRevokedAt,
  result_status: appExternalRecoveryOperationReceipt.resultStatus,
  result_updated_at: appExternalRecoveryOperationReceipt.resultUpdatedAt,
  result_user_id: appExternalRecoveryOperationReceipt.resultUserId,
  result_verified_at: appExternalRecoveryOperationReceipt.resultVerifiedAt,
  result_version: appExternalRecoveryOperationReceipt.resultVersion,
  schema_version: appExternalRecoveryOperationReceipt.schemaVersion,
  verification_secret_hash:
    appExternalRecoveryOperationReceipt.verificationSecretHash,
} as const;

const receiptInsertReturning = {
  operation_id: appExternalRecoveryOperationReceipt.operationId,
} as const;

const enrollmentReceiptMatches = (
  stored: StoredReceipt,
  actorUserId: string,
  address: string
) =>
  stored.receipt.operationKind === "enroll" &&
  stored.receipt.actorUserId === actorUserId &&
  stored.receipt.result.email.address === address;

const verificationReceiptMatches = (
  stored: StoredReceipt,
  actorUserId: string,
  challengeId: string,
  expectedVersion: number,
  verificationSecretHash: string
) =>
  stored.receipt.operationKind === "verify" &&
  stored.receipt.actorUserId === actorUserId &&
  stored.receipt.challengeId === challengeId &&
  stored.receipt.expectedIdentityVersion === expectedVersion &&
  stored.verificationSecretHash === verificationSecretHash;

const verificationReplayResult = (
  stored: StoredReceipt | null,
  intent: {
    readonly actorUserId: string;
    readonly challengeId: string;
    readonly expectedVersion: number;
    readonly verificationSecretHash: string;
  }
) => {
  if (stored === null) {
    return Effect.succeed(null);
  }
  return verificationReceiptMatches(
    stored,
    intent.actorUserId,
    intent.challengeId,
    intent.expectedVersion,
    intent.verificationSecretHash
  )
    ? Effect.succeed(stored.receipt.result)
    : Effect.fail(managementError("verify", "operation-conflict"));
};

const candidateAvailablePredicate = (
  database: ControlPlaneDatabase,
  comparisonKey: string,
  userId: string,
  excludedIdentityId?: string
) =>
  and(
    mailboxAddressAvailablePredicate(database, comparisonKey),
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

function managementError(
  operation: ExternalRecoveryIdentityManagementOperation,
  reason: ExternalRecoveryIdentityManagementError["reason"],
  cause?: unknown
) {
  return new ExternalRecoveryIdentityManagementError({
    cause,
    operation,
    reason,
  });
}

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

const requireUnrestricted = (
  requestAuth: CurrentRequestAuthShape,
  operation: ExternalRecoveryIdentityManagementOperation
) =>
  (requestAuth.validated.currentSession.claims?.requirements?.length ?? 0) === 0
    ? Effect.void
    : Effect.fail(managementError(operation, "restricted-session"));

/** Recovery lifecycle with session/challenge/audit changes committed atomically. */
const ExternalRecoveryIdentityTransactionD1Layer = Layer.effect(
  ExternalRecoveryIdentityTransaction,
  Effect.gen(function* () {
    const audit = yield* AdministrativeAudit;
    const batch = yield* ControlPlane.ControlPlaneBatch;
    const challenge = yield* ExternalRecoveryIdentityChallenge;
    const database = yield* ControlPlaneDatabase;
    const delivery = yield* ExternalRecoveryIdentityDelivery;
    const policy = yield* RecoverySafeIdentityPolicy;
    const runtime = yield* ExternalRecoveryIdentityRuntime;
    const stepUpClock = yield* SensitiveOperationStepUpClock;

    const readReceipt = (
      operationId: string,
      operation: ExternalRecoveryIdentityManagementOperation
    ) =>
      database
        .select(receiptReadSelection)
        .from(appExternalRecoveryOperationReceipt)
        .innerJoin(
          appExternalRecoveryIdentity,
          eq(
            appExternalRecoveryIdentity.id,
            appExternalRecoveryOperationReceipt.identityId
          )
        )
        .where(eq(appExternalRecoveryOperationReceipt.operationId, operationId))
        .limit(1)
        .pipe(
          Effect.mapError((cause) =>
            managementError(operation, "storage", cause)
          ),
          Effect.flatMap(([row]) =>
            row === undefined
              ? Effect.succeed(null)
              : Schema.decodeUnknownEffect(ReceiptRow)(row).pipe(
                  Effect.mapError((cause) =>
                    managementError(operation, "storage", cause)
                  ),
                  Effect.flatMap((decoded) =>
                    receiptFromRow(decoded, operation)
                  )
                )
          )
        );

    return ExternalRecoveryIdentityTransaction.of({
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
          const replay = yield* readReceipt(command.operationId, "enroll");
          if (replay !== null) {
            if (
              !enrollmentReceiptMatches(
                replay,
                requestAuth.validated.actor.userId,
                command.address
              )
            ) {
              return yield* managementError("enroll", "operation-conflict");
            }
            return replay.receipt.result;
          }
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
          const operationAvailable = notExists(
            database
              .select({ value: sql`1` })
              .from(appExternalRecoveryOperationReceipt)
              .where(
                eq(
                  appExternalRecoveryOperationReceipt.operationId,
                  command.operationId
                )
              )
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
                      and ${candidateAvailable}
                      and ${operationAvailable}`
            ),
            database.all(sql`select cast(${trustedBaseSession} as integer)
                                      as session_valid,
                                   cast(${trustedStepUpSession} as integer)
                                      as step_up_valid,
                                   cast(${challengeAvailable} as integer)
                                      as challenge_valid,
                                    cast(${candidateAvailable} as integer)
                                       as candidate_available,
                                    cast(${operationAvailable} as integer)
                                       as operation_available,
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
            database
              .insert(appExternalRecoveryOperationReceipt)
              .select(
                database
                  .select({
                    actorUserId: appExternalRecoveryIdentity.userId,
                    challengeId: sql<null>`null`.as("challenge_id"),
                    committedAt: appExternalRecoveryIdentity.updatedAt,
                    expectedIdentityVersion: sql<null>`null`.as(
                      "expected_identity_version"
                    ),
                    identityId: appExternalRecoveryIdentity.id,
                    operationId: sql`${command.operationId}`.as("operation_id"),
                    operationKind: sql<"enroll">`${"enroll"}`.as(
                      "operation_kind"
                    ),
                    resultChallengeExpiresAt:
                      appExternalRecoveryIdentity.challengeExpiresAt,
                    resultCreatedAt: appExternalRecoveryIdentity.createdAt,
                    resultRevokedAt: appExternalRecoveryIdentity.revokedAt,
                    resultStatus: appExternalRecoveryIdentity.status,
                    resultUpdatedAt: appExternalRecoveryIdentity.updatedAt,
                    resultUserId: appExternalRecoveryIdentity.userId,
                    resultVerifiedAt: appExternalRecoveryIdentity.verifiedAt,
                    resultVersion: appExternalRecoveryIdentity.version,
                    schemaVersion: sql<1>`1`.as("schema_version"),
                    verificationSecretHash: sql<null>`null`.as(
                      "verification_secret_hash"
                    ),
                  })
                  .from(appExternalRecoveryIdentity)
                  .where(
                    and(
                      eq(appExternalRecoveryIdentity.id, identityId),
                      authorized
                    )
                  )
              )
              .returning(receiptInsertReturning),
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
            Effect.catchTag("ControlPlaneBatchError", (error) =>
              error.commitState === "unknown"
                ? readReceipt(command.operationId, "enroll").pipe(
                    Effect.flatMap((receipt) =>
                      receipt === null
                        ? Effect.fail(storageError("enroll", error))
                        : enrollmentReceiptMatches(
                              receipt,
                              requestAuth.validated.actor.userId,
                              command.address
                            )
                          ? Effect.succeed(receipt.receipt)
                          : Effect.fail(
                              managementError("enroll", "operation-conflict")
                            )
                    )
                  )
                : Effect.fail(storageError("enroll", error))
            )
          );
          if (results instanceof ExternalRecoveryIdentityOperationReceipt) {
            return results.result;
          }
          const status = yield* Schema.decodeUnknownEffect(
            Schema.Array(
              Schema.Struct({
                authorized: Schema.Number,
                candidate_available: Schema.Number,
                challenge_valid: Schema.Number,
                operation_available: Schema.Number,
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
            if (status[0].operation_available !== 1) {
              const concurrentReplay = yield* readReceipt(
                command.operationId,
                "enroll"
              );
              if (
                concurrentReplay !== null &&
                enrollmentReceiptMatches(
                  concurrentReplay,
                  requestAuth.validated.actor.userId,
                  command.address
                )
              ) {
                return concurrentReplay.receipt.result;
              }
              return yield* managementError("enroll", "operation-conflict");
            }
            return yield* managementError("enroll", "policy-denied");
          }
          const receiptRows = yield* Schema.decodeUnknownEffect(
            Schema.Array(Schema.Struct({ operation_id: Schema.String }))
          )(results[3]?.results).pipe(
            Effect.mapError((cause) =>
              managementError("enroll", "storage", cause)
            )
          );
          const [receiptRow] = receiptRows;
          if (receiptRow?.operation_id !== command.operationId) {
            return yield* managementError("enroll", "storage");
          }
          const identityRows = yield* Schema.decodeUnknownEffect(
            Schema.Array(RawIdentityRow)
          )(results[2]?.results).pipe(
            Effect.mapError((cause) =>
              managementError("enroll", "storage", cause)
            )
          );
          const [identityRow] = identityRows;
          if (identityRow === undefined) {
            return yield* managementError("enroll", "storage");
          }
          return yield* identityFromRow(identityRow).pipe(
            Effect.mapError((cause) =>
              managementError("enroll", "storage", cause)
            )
          );
        }),
      readOperation: (untrustedQuery) =>
        Effect.gen(function* () {
          const query = yield* Schema.decodeUnknownEffect(
            ReadExternalRecoveryIdentityOperationQuery
          )(untrustedQuery).pipe(
            Effect.mapError((cause) =>
              managementError("read-operation", "invalid-input", cause)
            )
          );
          const requestAuth = yield* CurrentRequestAuth;
          const principal = yield* AuthPermission.CurrentPrincipal;
          yield* ensureTrustedAuthInvariant(requestAuth, principal);
          yield* requireUnrestricted(requestAuth, "read-operation");
          const receipt = yield* readReceipt(
            query.operationId,
            "read-operation"
          );
          if (
            receipt === null ||
            receipt.receipt.actorUserId !== requestAuth.validated.actor.userId
          ) {
            return yield* managementError("read-operation", "not-found");
          }
          return receipt.receipt;
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
          const verificationSecretHash = yield* challenge.hashSecret(
            command.secret
          );
          const replay = yield* readReceipt(command.operationId, "verify");
          const replayResult = yield* verificationReplayResult(replay, {
            actorUserId: requestAuth.validated.actor.userId,
            challengeId: command.challengeId,
            expectedVersion: command.expectedVersion,
            verificationSecretHash,
          });
          if (replayResult !== null) {
            return replayResult;
          }
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
          const operationAvailable = notExists(
            database
              .select({ value: sql`1` })
              .from(appExternalRecoveryOperationReceipt)
              .where(
                eq(
                  appExternalRecoveryOperationReceipt.operationId,
                  command.operationId
                )
              )
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
                      and ${candidateAvailable}
                      and ${operationAvailable}`
            ),
            database.all(sql`select cast(${trustedSession} as integer)
                                      as session_valid,
                                   cast(${identityValid} as integer)
                                      as identity_valid,
                                   cast(${challengeAvailable} as integer)
                                      as challenge_valid,
                                    cast(${candidateAvailable} as integer)
                                       as candidate_available,
                                    cast(${operationAvailable} as integer)
                                       as operation_available,
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
                  eq(authVerification.secretHash, verificationSecretHash),
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
            database
              .insert(appExternalRecoveryOperationReceipt)
              .select(
                database
                  .select({
                    actorUserId: appExternalRecoveryIdentity.userId,
                    challengeId: sql`${command.challengeId}`.as("challenge_id"),
                    committedAt: appExternalRecoveryIdentity.updatedAt,
                    expectedIdentityVersion: sql`${command.expectedVersion}`.as(
                      "expected_identity_version"
                    ),
                    identityId: appExternalRecoveryIdentity.id,
                    operationId: sql`${command.operationId}`.as("operation_id"),
                    operationKind: sql<"verify">`${"verify"}`.as(
                      "operation_kind"
                    ),
                    resultChallengeExpiresAt:
                      appExternalRecoveryIdentity.challengeExpiresAt,
                    resultCreatedAt: appExternalRecoveryIdentity.createdAt,
                    resultRevokedAt: appExternalRecoveryIdentity.revokedAt,
                    resultStatus: appExternalRecoveryIdentity.status,
                    resultUpdatedAt: appExternalRecoveryIdentity.updatedAt,
                    resultUserId: appExternalRecoveryIdentity.userId,
                    resultVerifiedAt: appExternalRecoveryIdentity.verifiedAt,
                    resultVersion: appExternalRecoveryIdentity.version,
                    schemaVersion: sql<1>`1`.as("schema_version"),
                    verificationSecretHash: sql`${verificationSecretHash}`.as(
                      "verification_secret_hash"
                    ),
                  })
                  .from(appExternalRecoveryIdentity)
                  .where(
                    and(
                      eq(appExternalRecoveryIdentity.id, identityId),
                      authorized
                    )
                  )
              )
              .returning(receiptInsertReturning),
            administrativeAuditInsertStatement(database, auditEvent, nonce),
            database
              .delete(appAuthorizationGuard)
              .where(eq(appAuthorizationGuard.nonce, nonce)),
          ];
          const results = yield* batch
            .execute(statements)
            .pipe(
              Effect.catchTag("ControlPlaneBatchError", (error) =>
                error.commitState === "unknown"
                  ? readReceipt(command.operationId, "verify").pipe(
                      Effect.flatMap((receipt) =>
                        receipt === null
                          ? Effect.fail(storageError("verify", error))
                          : verificationReceiptMatches(
                                receipt,
                                requestAuth.validated.actor.userId,
                                command.challengeId,
                                command.expectedVersion,
                                verificationSecretHash
                              )
                            ? Effect.succeed(receipt.receipt)
                            : Effect.fail(
                                managementError("verify", "operation-conflict")
                              )
                      )
                    )
                  : Effect.fail(storageError("verify", error))
              )
            );
          if (results instanceof ExternalRecoveryIdentityOperationReceipt) {
            return results.result;
          }
          const status = yield* Schema.decodeUnknownEffect(
            Schema.Array(
              Schema.Struct({
                authorized: Schema.Number,
                candidate_available: Schema.Number,
                challenge_valid: Schema.Number,
                identity_valid: Schema.Number,
                operation_available: Schema.Number,
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
            if (status[0].operation_available !== 1) {
              const concurrentReplay = yield* readReceipt(
                command.operationId,
                "verify"
              );
              if (
                concurrentReplay !== null &&
                verificationReceiptMatches(
                  concurrentReplay,
                  requestAuth.validated.actor.userId,
                  command.challengeId,
                  command.expectedVersion,
                  verificationSecretHash
                )
              ) {
                return concurrentReplay.receipt.result;
              }
              return yield* managementError("verify", "operation-conflict");
            }
            if (status[0].identity_valid !== 1) {
              return yield* managementError("verify", "version-conflict");
            }
            if (status[0].challenge_valid !== 1) {
              return yield* managementError("verify", "challenge-invalid");
            }
            return yield* managementError("verify", "policy-denied");
          }
          const receiptRows = yield* Schema.decodeUnknownEffect(
            Schema.Array(Schema.Struct({ operation_id: Schema.String }))
          )(results[4]?.results).pipe(
            Effect.mapError((cause) =>
              managementError("verify", "storage", cause)
            )
          );
          const [receiptRow] = receiptRows;
          if (receiptRow?.operation_id !== command.operationId) {
            return yield* managementError("verify", "storage");
          }
          const identityRows = yield* Schema.decodeUnknownEffect(
            Schema.Array(RawIdentityRow)
          )(results[3]?.results).pipe(
            Effect.mapError((cause) =>
              managementError("verify", "storage", cause)
            )
          );
          const [identityRow] = identityRows;
          if (identityRow === undefined) {
            return yield* managementError("verify", "storage");
          }
          return yield* identityFromRow(identityRow).pipe(
            Effect.mapError((cause) =>
              managementError("verify", "storage", cause)
            )
          );
        }),
    });
  })
);

export const ExternalRecoveryIdentityD1Layer =
  ExternalRecoveryIdentityManagement.layerNoDeps.pipe(
    Layer.provide(ExternalRecoveryIdentityTransactionD1Layer)
  );
