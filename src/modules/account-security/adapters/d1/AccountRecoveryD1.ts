import { recoveryCodeEvidence } from "@effect-auth/core/Assurance";
import { CustomAuditEventSchema } from "@effect-auth/core/AuditLog";
import { AuthSecrets } from "@effect-auth/core/AuthConfig";
import { AuthFlowState } from "@effect-auth/core/AuthFlow";
import { AuthRateLimit } from "@effect-auth/core/AuthRateLimit";
import { Crypto } from "@effect-auth/core/Crypto";
import {
  ChallengeId,
  UnixMillis,
  UserIdSchema,
} from "@effect-auth/core/Identifiers";
import {
  RecoveryCodeManagement,
  RecoveryCodes,
} from "@effect-auth/core/RecoveryCode";
import { withRecoveryRemediationRequirement } from "@effect-auth/core/RecoveryPolicy";
import { Sessions } from "@effect-auth/core/Sessions";
import { VerificationStore } from "@effect-auth/core/Storage";
import { and, eq, exists, isNull, notExists, sql } from "drizzle-orm";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

import { authAuditLog } from "#/auth/schema/modules/audit-log";
import { authUser } from "#/auth/schema/modules/core";
import { authRecoveryCode } from "#/auth/schema/modules/recovery-codes";
import { authSession } from "#/auth/schema/modules/sessions";
import { authVerification } from "#/auth/schema/modules/verification";
import { AccountRecovery } from "#/modules/account-security/application/AccountRecovery";
import {
  accountRecoveryAccepted,
  AccountRecoveryCompletionReceipt,
  AccountRecoveryError,
  CompleteAccountRecoveryCommand,
  externalRecoveryLinkEvidence,
  ReadAccountRecoveryCompletionCommand,
  StartAccountRecoveryCommand,
} from "#/modules/account-security/domain/AccountRecovery";
import {
  ExternalRecoveryIdentityId,
  externalRecoveryAddressComparisonKey,
} from "#/modules/account-security/domain/ExternalRecoveryIdentity";
import { AccountRecoveryDelivery } from "#/modules/account-security/ports/AccountRecoveryDelivery";
import { AccountRecoveryTransaction } from "#/modules/account-security/ports/AccountRecoveryTransaction";
import { RecoverySafeIdentityPolicy } from "#/modules/account-security/ports/RecoverySafeIdentityPolicy";
import { appAuthorizationGuard } from "#/platform/control-plane-d1/AuthorizationGuardSchema";
import * as ControlPlane from "#/platform/control-plane-d1/ControlPlaneBatch";
import { ControlPlaneDatabase } from "#/platform/control-plane-d1/ControlPlaneDatabase";
import { EmailAddress } from "#/shared/EmailAddress";

import {
  appAccountRecoveryCompletionReceipt,
  appExternalRecoveryIdentity,
} from "./AccountSecuritySchema";

const FLOW_TTL = Duration.minutes(10);
const PUBLIC_START_RESPONSE_FLOOR = Duration.millis(500);
const REMEDIATION_SESSION_TTL = {
  absoluteTtl: Duration.minutes(15),
  idleTtl: Duration.minutes(15),
  refreshAfter: Duration.minutes(15),
} as const;
const flowMetadata = Schema.Struct({
  externalRecoveryIdentityId: Schema.String,
  externalRecoveryIdentityVersion: Schema.Number,
  purpose: Schema.Literal("account-recovery"),
});
const CompletionReceiptRow = Schema.Struct({
  completedAt: Schema.Number,
  expectedExternalRecoveryIdentityVersion: Schema.Number,
  externalRecoveryIdentityId: Schema.String,
  flowId: Schema.String,
  flowSecretHash: Schema.String,
  operationId: Schema.String,
  readbackSecretHash: Schema.String,
  recoveryCodeHash: Schema.String,
  recoveryCodeId: Schema.String,
  resultStatus: Schema.String,
  schemaVersion: Schema.Number,
  sessionId: Schema.String,
  userId: Schema.String,
});
type CompletionReceiptRow = Schema.Schema.Type<typeof CompletionReceiptRow>;

const publicReceipt = (row: CompletionReceiptRow) =>
  Schema.decodeUnknownEffect(AccountRecoveryCompletionReceipt)({
    completedAt: row.completedAt,
    operationId: row.operationId,
    schemaVersion: row.schemaVersion,
    status: row.resultStatus,
  });

const exactCompletionIntent = (
  row: CompletionReceiptRow,
  intent: {
    readonly flowId: string;
    readonly flowSecretHash: string;
    readonly readbackSecretHash: string;
    readonly recoveryCodeHash: string;
  }
) =>
  row.flowId === intent.flowId &&
  row.flowSecretHash === intent.flowSecretHash &&
  row.readbackSecretHash === intent.readbackSecretHash &&
  row.recoveryCodeHash === intent.recoveryCodeHash;

const failure = (
  operation: AccountRecoveryError["operation"],
  reason: AccountRecoveryError["reason"],
  cause?: unknown
) => new AccountRecoveryError({ cause, operation, reason });

const withPublicStartResponseFloor = <A, E, R>(
  effect: Effect.Effect<A, E, R>
) =>
  Effect.gen(function* () {
    const startedAt = Date.now();
    return yield* effect.pipe(
      Effect.ensuring(
        Effect.suspend(() =>
          Effect.sleep(
            Duration.millis(
              Math.max(
                0,
                Duration.toMillis(PUBLIC_START_RESPONSE_FLOOR) -
                  (Date.now() - startedAt)
              )
            )
          )
        )
      )
    );
  });

const AccountRecoveryTransactionD1Layer = Layer.effect(
  AccountRecoveryTransaction,
  Effect.gen(function* () {
    const authFlowState = yield* AuthFlowState;
    const authRateLimit = yield* AuthRateLimit;
    const authSecrets = yield* AuthSecrets;
    const batch = yield* ControlPlane.ControlPlaneBatch;
    const crypto = yield* Crypto;
    const database = yield* ControlPlaneDatabase;
    const delivery = yield* AccountRecoveryDelivery;
    const recoveryCodes = yield* RecoveryCodeManagement;
    const recoveryCodePrimitives = yield* RecoveryCodes;
    const recoverySafeIdentity = yield* RecoverySafeIdentityPolicy;
    const sessions = yield* Sessions;
    const verificationStore = yield* VerificationStore;

    const readStoredReceipt = (
      operationId: string,
      operation: AccountRecoveryError["operation"]
    ) =>
      database
        .select({
          completedAt: appAccountRecoveryCompletionReceipt.completedAt,
          expectedExternalRecoveryIdentityVersion:
            appAccountRecoveryCompletionReceipt.expectedExternalRecoveryIdentityVersion,
          externalRecoveryIdentityId:
            appAccountRecoveryCompletionReceipt.externalRecoveryIdentityId,
          flowId: appAccountRecoveryCompletionReceipt.flowId,
          flowSecretHash: appAccountRecoveryCompletionReceipt.flowSecretHash,
          operationId: appAccountRecoveryCompletionReceipt.operationId,
          readbackSecretHash:
            appAccountRecoveryCompletionReceipt.readbackSecretHash,
          recoveryCodeHash:
            appAccountRecoveryCompletionReceipt.recoveryCodeHash,
          recoveryCodeId: appAccountRecoveryCompletionReceipt.recoveryCodeId,
          resultStatus: appAccountRecoveryCompletionReceipt.resultStatus,
          schemaVersion: appAccountRecoveryCompletionReceipt.schemaVersion,
          sessionId: appAccountRecoveryCompletionReceipt.sessionId,
          userId: appAccountRecoveryCompletionReceipt.userId,
        })
        .from(appAccountRecoveryCompletionReceipt)
        .where(eq(appAccountRecoveryCompletionReceipt.operationId, operationId))
        .limit(1)
        .pipe(
          Effect.mapError((cause) => failure(operation, "storage", cause)),
          Effect.flatMap(([row]) =>
            row === undefined
              ? Effect.succeed(null)
              : Schema.decodeUnknownEffect(CompletionReceiptRow)(row).pipe(
                  Effect.mapError((cause) =>
                    failure(operation, "storage", cause)
                  )
                )
          )
        );

    const hashReadbackSecret = (
      secret: string,
      operation: AccountRecoveryError["operation"]
    ) =>
      crypto
        .hmacSha256({
          data: `account-recovery-readback:${secret}`,
          key: authSecrets.privacy,
        })
        .pipe(Effect.mapError((cause) => failure(operation, "storage", cause)));

    return AccountRecoveryTransaction.of({
      start: (untrusted) =>
        withPublicStartResponseFloor(
          Effect.gen(function* () {
            const command = yield* Schema.decodeUnknownEffect(
              StartAccountRecoveryCommand
            )(untrusted).pipe(
              Effect.mapError((cause) =>
                failure("start", "invalid-input", cause)
              )
            );
            const comparisonKey = externalRecoveryAddressComparisonKey(
              command.address
            );
            const [identity] = yield* database
              .select({
                address: appExternalRecoveryIdentity.address,
                id: appExternalRecoveryIdentity.id,
                userId: appExternalRecoveryIdentity.userId,
                version: appExternalRecoveryIdentity.version,
              })
              .from(appExternalRecoveryIdentity)
              .where(
                and(
                  eq(appExternalRecoveryIdentity.comparisonKey, comparisonKey),
                  eq(appExternalRecoveryIdentity.status, "verified"),
                  exists(
                    database
                      .select({ value: sql`1` })
                      .from(authUser)
                      .where(
                        and(
                          eq(authUser.id, appExternalRecoveryIdentity.userId),
                          isNull(authUser.disabledAt)
                        )
                      )
                  ),
                  exists(
                    database
                      .select({ value: sql`1` })
                      .from(authRecoveryCode)
                      .where(
                        and(
                          eq(
                            authRecoveryCode.userId,
                            appExternalRecoveryIdentity.userId
                          ),
                          isNull(authRecoveryCode.usedAt),
                          isNull(authRecoveryCode.revokedAt)
                        )
                      )
                  )
                )
              )
              .limit(1)
              .pipe(
                Effect.mapError((cause) => failure("start", "storage", cause))
              );
            if (identity === undefined) {
              return accountRecoveryAccepted;
            }
            const identityId = yield* Schema.decodeUnknownEffect(
              ExternalRecoveryIdentityId
            )(identity.id).pipe(
              Effect.mapError((cause) => failure("start", "storage", cause))
            );
            const userId = yield* Schema.decodeUnknownEffect(UserIdSchema)(
              identity.userId
            ).pipe(
              Effect.mapError((cause) => failure("start", "storage", cause))
            );
            const recoveryAddress = yield* Schema.decodeUnknownEffect(
              EmailAddress
            )(identity.address).pipe(
              Effect.mapError((cause) => failure("start", "storage", cause))
            );
            const safe = yield* recoverySafeIdentity
              .requireExternalRecoveryAddress({
                address: recoveryAddress,
                excludeRecoveryIdentityId: identityId,
              })
              .pipe(
                Effect.as(true),
                Effect.catchTag("RecoverySafeIdentityRejected", () =>
                  Effect.succeed(false)
                )
              );
            if (!safe) {
              return accountRecoveryAccepted;
            }
            const now = UnixMillis(Date.now());
            const secret = Redacted.make(
              yield* crypto
                .randomToken(32)
                .pipe(
                  Effect.mapError((cause) => failure("start", "storage", cause))
                )
            );
            const started = yield* authFlowState
              .start({
                evidence: [
                  externalRecoveryLinkEvidence.make({
                    properties: {
                      externalRecoveryIdentityId: identity.id,
                      externalRecoveryIdentityVersion: identity.version,
                    },
                    verifiedAt: now,
                  }),
                ],
                factors: [{ type: "backup-code" }],
                metadata: {
                  externalRecoveryIdentityId: identity.id,
                  externalRecoveryIdentityVersion: identity.version,
                  purpose: "account-recovery",
                },
                method: "external-recovery-link",
                secret,
                ttl: FLOW_TTL,
                userId,
              })
              .pipe(
                Effect.mapError((cause) => failure("start", "storage", cause))
              );
            yield* delivery
              .send({
                address: recoveryAddress,
                expiresAt: Number(started.expiresAt),
                flowId: started.flowId,
                secret,
              })
              .pipe(Effect.catch(() => Effect.void));
            return accountRecoveryAccepted;
          })
        ),
      complete: (untrusted) =>
        // oxlint-disable-next-line eslint/complexity -- Completion maps every proof, atomic guard, replay, and unknown-commit branch to one public-safe outcome.
        Effect.gen(function* () {
          const command = yield* Schema.decodeUnknownEffect(
            CompleteAccountRecoveryCommand
          )(untrusted).pipe(
            Effect.mapError((cause) =>
              failure("complete", "invalid-input", cause)
            )
          );
          const readbackSecretHash = yield* hashReadbackSecret(
            command.readbackSecret,
            "complete"
          );
          const flowSecretHash = yield* crypto
            .hmacSha256({ data: command.secret, key: authSecrets.challenge })
            .pipe(
              Effect.mapError((cause) => failure("complete", "storage", cause))
            );
          const recoveryCodeHash = yield* recoveryCodePrimitives
            .hash({ code: Redacted.make(command.code) })
            .pipe(
              Effect.mapError((cause) =>
                failure("complete", "invalid-proof", cause)
              )
            );
          const intent = {
            flowId: command.flowId,
            flowSecretHash,
            readbackSecretHash,
            recoveryCodeHash,
          };
          const replay = yield* readStoredReceipt(
            command.operationId,
            "complete"
          );
          if (replay !== null) {
            if (!exactCompletionIntent(replay, intent)) {
              return yield* failure("complete", "invalid-proof");
            }
            const receipt = yield* publicReceipt(replay).pipe(
              Effect.mapError((cause) => failure("complete", "storage", cause))
            );
            return {
              _tag: "AccountRecoveryAlreadyCompleted" as const,
              receipt,
            };
          }
          const pending = yield* authFlowState
            .inspect(command.flowId, Redacted.make(command.secret))
            .pipe(
              Effect.mapError((cause) =>
                failure("complete", "invalid-proof", cause)
              )
            );
          const metadata = yield* Schema.decodeUnknownEffect(flowMetadata)(
            pending.metadata
          ).pipe(
            Effect.mapError((cause) =>
              failure("complete", "invalid-proof", cause)
            )
          );
          if (
            pending.method !== "external-recovery-link" ||
            pending.factors?.length !== 1 ||
            pending.factors[0]?.type !== "backup-code"
          ) {
            return yield* failure("complete", "invalid-proof");
          }
          yield* authRateLimit
            .require({
              operation: "auth.recovery_code.verify",
              userId: pending.userId,
            })
            .pipe(
              Effect.mapError((cause) =>
                failure(
                  "complete",
                  cause._tag === "RateLimitExceededError"
                    ? "rate-limited"
                    : "storage",
                  cause
                )
              )
            );
          const [eligible] = yield* database
            .select({ id: appExternalRecoveryIdentity.id })
            .from(appExternalRecoveryIdentity)
            .where(
              and(
                eq(
                  appExternalRecoveryIdentity.id,
                  metadata.externalRecoveryIdentityId
                ),
                eq(appExternalRecoveryIdentity.userId, pending.userId),
                eq(
                  appExternalRecoveryIdentity.version,
                  metadata.externalRecoveryIdentityVersion
                ),
                eq(appExternalRecoveryIdentity.status, "verified"),
                exists(
                  database
                    .select({ value: sql`1` })
                    .from(authUser)
                    .where(
                      and(
                        eq(authUser.id, pending.userId),
                        isNull(authUser.disabledAt)
                      )
                    )
                )
              )
            )
            .limit(1)
            .pipe(
              Effect.mapError((cause) => failure("complete", "storage", cause))
            );
          if (eligible === undefined) {
            return yield* failure("complete", "invalid-proof");
          }
          const verification = yield* verificationStore
            .findById(ChallengeId(command.flowId))
            .pipe(
              Effect.mapError((cause) => failure("complete", "storage", cause)),
              Effect.flatMap((row) =>
                Option.isNone(row)
                  ? Effect.fail(failure("complete", "invalid-proof"))
                  : Effect.succeed(row.value)
              )
            );
          if (verification.secretHash !== flowSecretHash) {
            return yield* failure("complete", "invalid-proof");
          }
          const identified = yield* recoveryCodes
            .identifyForUser({
              code: Redacted.make(command.code),
              userId: pending.userId,
            })
            .pipe(
              Effect.mapError((cause) => failure("complete", "storage", cause))
            );
          if (!identified.valid || identified.code === undefined) {
            return yield* failure("complete", "invalid-proof");
          }
          if (sessions.prepareCreate === undefined) {
            return yield* failure("complete", "storage");
          }
          const completedAt = UnixMillis(Date.now());
          const prepared = yield* sessions
            .prepareCreate({
              authenticationEvents: [
                ...pending.evidence,
                recoveryCodeEvidence({
                  codeId: identified.code.id,
                  verifiedAt: completedAt,
                }),
              ],
              claims: withRecoveryRemediationRequirement(undefined, [
                "second-passkey",
              ]),
              metadata: {
                externalRecoveryIdentityId: metadata.externalRecoveryIdentityId,
                externalRecoveryIdentityVersion:
                  metadata.externalRecoveryIdentityVersion,
                purpose: "account-recovery",
              },
              now: completedAt,
              ttl: REMEDIATION_SESSION_TTL,
              userId: pending.userId,
            })
            .pipe(
              Effect.mapError((cause) => failure("complete", "storage", cause))
            );
          const nonce = globalThis.crypto.randomUUID();
          const authorized = exists(
            database
              .select({ value: sql`1` })
              .from(appAuthorizationGuard)
              .where(eq(appAuthorizationGuard.nonce, nonce))
          );
          const exactVerificationRow = and(
            eq(authVerification.id, verification.id),
            eq(authVerification.type, verification.type),
            eq(authVerification.subject, verification.subject),
            verification.secretHash === undefined
              ? isNull(authVerification.secretHash)
              : eq(authVerification.secretHash, verification.secretHash),
            eq(authVerification.createdAt, Number(verification.createdAt)),
            eq(authVerification.expiresAt, Number(verification.expiresAt)),
            verification.metadata === undefined
              ? isNull(authVerification.metadata)
              : eq(
                  authVerification.metadata,
                  JSON.stringify(verification.metadata)
                ),
            isNull(authVerification.consumedAt),
            sql`${authVerification.expiresAt} > ${completedAt}`
          );
          const exactVerification = exists(
            database
              .select({ value: sql`1` })
              .from(authVerification)
              .where(exactVerificationRow)
          );
          const recoveryStillValid = exists(
            database
              .select({ value: sql`1` })
              .from(appExternalRecoveryIdentity)
              .where(
                and(
                  eq(
                    appExternalRecoveryIdentity.id,
                    metadata.externalRecoveryIdentityId
                  ),
                  eq(appExternalRecoveryIdentity.userId, pending.userId),
                  eq(
                    appExternalRecoveryIdentity.version,
                    metadata.externalRecoveryIdentityVersion
                  ),
                  eq(appExternalRecoveryIdentity.status, "verified")
                )
              )
          );
          const userStillActive = exists(
            database
              .select({ value: sql`1` })
              .from(authUser)
              .where(
                and(
                  eq(authUser.id, pending.userId),
                  isNull(authUser.disabledAt)
                )
              )
          );
          const codeStillActive = exists(
            database
              .select({ value: sql`1` })
              .from(authRecoveryCode)
              .where(
                and(
                  eq(authRecoveryCode.id, identified.code.id),
                  eq(authRecoveryCode.userId, pending.userId),
                  eq(authRecoveryCode.codeHash, recoveryCodeHash),
                  isNull(authRecoveryCode.usedAt),
                  isNull(authRecoveryCode.revokedAt)
                )
              )
          );
          const sessionAvailable = notExists(
            database
              .select({ value: sql`1` })
              .from(authSession)
              .where(eq(authSession.id, prepared.row.id))
          );
          const operationAvailable = notExists(
            database
              .select({ value: sql`1` })
              .from(appAccountRecoveryCompletionReceipt)
              .where(
                eq(
                  appAccountRecoveryCompletionReceipt.operationId,
                  command.operationId
                )
              )
          );
          const auditEvent = yield* Schema.decodeUnknownEffect(
            CustomAuditEventSchema
          )({
            actor: { type: "user", userId: pending.userId },
            occurredAt: completedAt,
            payload: {
              externalRecoveryIdentityId: metadata.externalRecoveryIdentityId,
              operationId: command.operationId,
            },
            subject: { type: "user", userId: pending.userId },
            type: "app.account_recovery.entered",
            version: 1,
          }).pipe(
            Effect.mapError((cause) => failure("complete", "storage", cause))
          );
          const sessionMetadata = JSON.stringify({
            __effectAuthSession: {
              claims: prepared.row.claims,
              metadata: prepared.row.metadata,
              version: 1,
            },
          });
          const statements: ControlPlane.ControlPlaneStatements = [
            database.insert(appAuthorizationGuard).select(
              sql`select ${nonce} where ${exactVerification}
                        and ${codeStillActive}
                        and ${recoveryStillValid}
                        and ${userStillActive}
                        and ${sessionAvailable}
                        and ${operationAvailable}`
            ),
            database.all(
              sql`select cast(${authorized} as integer) as authorized,
                           cast(${operationAvailable} as integer)
                             as operation_available`
            ),
            database
              .update(authVerification)
              .set({ consumedAt: completedAt })
              .where(and(exactVerificationRow, authorized)),
            database
              .update(authRecoveryCode)
              .set({
                metadata: JSON.stringify({ purpose: "account-recovery" }),
                usedAt: completedAt,
              })
              .where(
                and(
                  eq(authRecoveryCode.id, identified.code.id),
                  eq(authRecoveryCode.userId, pending.userId),
                  isNull(authRecoveryCode.usedAt),
                  isNull(authRecoveryCode.revokedAt),
                  authorized
                )
              ),
            database.insert(authSession).select(
              database
                .select({
                  aal: sql`${prepared.row.aal}`.as("aal"),
                  amr: sql`${JSON.stringify(prepared.row.amr)}`.as("amr"),
                  authTime: sql`${prepared.row.authTime}`.as("auth_time"),
                  authenticationEvents:
                    sql`${JSON.stringify(prepared.row.authenticationEvents)}`.as(
                      "authentication_events"
                    ),
                  createdAt: sql`${prepared.row.createdAt}`.as("created_at"),
                  expiresAt: sql`${prepared.row.expiresAt}`.as("expires_at"),
                  id: sql`${prepared.row.id}`.as("id"),
                  lastSeenAt: sql<null>`null`.as("last_seen_at"),
                  metadata: sql`${sessionMetadata}`.as("metadata"),
                  mfaVerifiedAt:
                    prepared.row.mfaVerifiedAt === undefined
                      ? sql<null>`null`.as("mfa_verified_at")
                      : sql`${prepared.row.mfaVerifiedAt}`.as(
                          "mfa_verified_at"
                        ),
                  revokedAt: sql<null>`null`.as("revoked_at"),
                  rotatedAt: sql<null>`null`.as("rotated_at"),
                  secretHash: sql`${prepared.row.secretHash}`.as("secret_hash"),
                  userId: sql`${prepared.row.userId}`.as("user_id"),
                })
                .from(appAuthorizationGuard)
                .where(eq(appAuthorizationGuard.nonce, nonce))
            ),
            database.insert(authAuditLog).select(
              database
                .select({
                  actorUserId: sql`${pending.userId}`.as("actor_user_id"),
                  createdAt: sql`${completedAt}`.as("created_at"),
                  event: sql`${JSON.stringify(auditEvent)}`.as("event"),
                  id: sql`${`account-recovery:${command.operationId}`}`.as(
                    "id"
                  ),
                  occurredAt: sql`${completedAt}`.as("occurred_at"),
                  type: sql`${auditEvent.type}`.as("type"),
                  userId: sql`${pending.userId}`.as("user_id"),
                })
                .from(appAuthorizationGuard)
                .where(eq(appAuthorizationGuard.nonce, nonce))
            ),
            database
              .insert(appAccountRecoveryCompletionReceipt)
              .select(
                database
                  .select({
                    completedAt: sql`${completedAt}`.as("completed_at"),
                    expectedExternalRecoveryIdentityVersion:
                      sql`${metadata.externalRecoveryIdentityVersion}`.as(
                        "expected_external_recovery_identity_version"
                      ),
                    externalRecoveryIdentityId:
                      sql`${metadata.externalRecoveryIdentityId}`.as(
                        "external_recovery_identity_id"
                      ),
                    flowId: sql`${command.flowId}`.as("flow_id"),
                    flowSecretHash: sql`${flowSecretHash}`.as(
                      "flow_secret_hash"
                    ),
                    operationId: sql`${command.operationId}`.as("operation_id"),
                    readbackSecretHash: sql`${readbackSecretHash}`.as(
                      "readback_secret_hash"
                    ),
                    recoveryCodeHash: sql`${recoveryCodeHash}`.as(
                      "recovery_code_hash"
                    ),
                    recoveryCodeId: sql`${identified.code.id}`.as(
                      "recovery_code_id"
                    ),
                    resultStatus: sql`'recovery-remediation-required'`.as(
                      "result_status"
                    ),
                    schemaVersion: sql<1>`1`.as("schema_version"),
                    sessionId: sql`${prepared.row.id}`.as("session_id"),
                    userId: sql`${pending.userId}`.as("user_id"),
                  })
                  .from(appAuthorizationGuard)
                  .where(eq(appAuthorizationGuard.nonce, nonce))
              )
              .returning({
                operation_id: appAccountRecoveryCompletionReceipt.operationId,
              }),
            database
              .delete(appAuthorizationGuard)
              .where(eq(appAuthorizationGuard.nonce, nonce)),
          ];
          const results = yield* batch.execute(statements).pipe(
            Effect.catchTag("ControlPlaneBatchError", (cause) =>
              cause.commitState === "unknown"
                ? readStoredReceipt(command.operationId, "complete").pipe(
                    Effect.flatMap((stored) =>
                      stored === null
                        ? Effect.fail(
                            failure("complete", "indeterminate", cause.cause)
                          )
                        : exactCompletionIntent(stored, intent)
                          ? publicReceipt(stored).pipe(
                              Effect.map((receipt) => ({
                                _tag: "AccountRecoveryAlreadyCompleted" as const,
                                receipt,
                              })),
                              Effect.mapError((decodeCause) =>
                                failure("complete", "storage", decodeCause)
                              )
                            )
                          : Effect.fail(
                              failure("complete", "invalid-proof", cause.cause)
                            )
                    )
                  )
                : Effect.fail(failure("complete", "storage", cause.cause))
            )
          );
          if ("_tag" in results) {
            return results;
          }
          const [status] = yield* Schema.decodeUnknownEffect(
            Schema.Array(
              Schema.Struct({
                authorized: Schema.Number,
                operation_available: Schema.Number,
              })
            )
          )(results[1]?.results).pipe(
            Effect.mapError((cause) =>
              failure("complete", "indeterminate", cause)
            )
          );
          if (status?.authorized !== 1) {
            if (status?.operation_available !== 1) {
              const concurrentReplay = yield* readStoredReceipt(
                command.operationId,
                "complete"
              );
              if (
                concurrentReplay !== null &&
                exactCompletionIntent(concurrentReplay, intent)
              ) {
                const receipt = yield* publicReceipt(concurrentReplay).pipe(
                  Effect.mapError((cause) =>
                    failure("complete", "storage", cause)
                  )
                );
                return {
                  _tag: "AccountRecoveryAlreadyCompleted" as const,
                  receipt,
                };
              }
            }
            return yield* failure("complete", "invalid-proof");
          }
          const receiptRows = yield* Schema.decodeUnknownEffect(
            Schema.Array(Schema.Struct({ operation_id: Schema.String }))
          )(results[6]?.results).pipe(
            Effect.mapError((cause) => failure("complete", "storage", cause))
          );
          if (receiptRows[0]?.operation_id !== command.operationId) {
            return yield* failure("complete", "storage");
          }
          const receipt = yield* Schema.decodeUnknownEffect(
            AccountRecoveryCompletionReceipt
          )({
            completedAt: Number(completedAt),
            operationId: command.operationId,
            schemaVersion: 1,
            status: "recovery-remediation-required",
          }).pipe(
            Effect.mapError((cause) => failure("complete", "storage", cause))
          );
          return {
            _tag: "AccountRecoveryCompleted" as const,
            receipt,
            session: prepared.session,
          };
        }),
      readCompletion: (untrusted) =>
        Effect.gen(function* () {
          const command = yield* Schema.decodeUnknownEffect(
            ReadAccountRecoveryCompletionCommand
          )(untrusted).pipe(
            Effect.mapError((cause) =>
              failure("read-completion", "invalid-input", cause)
            )
          );
          const readbackSecretHash = yield* hashReadbackSecret(
            command.readbackSecret,
            "read-completion"
          );
          const stored = yield* readStoredReceipt(
            command.operationId,
            "read-completion"
          );
          if (
            stored === null ||
            stored.readbackSecretHash !== readbackSecretHash
          ) {
            return yield* failure("read-completion", "invalid-proof");
          }
          return yield* publicReceipt(stored).pipe(
            Effect.mapError((cause) =>
              failure("read-completion", "storage", cause)
            )
          );
        }),
    });
  })
);

export const AccountRecoveryD1Layer = AccountRecovery.layerNoDeps.pipe(
  Layer.provide(AccountRecoveryTransactionD1Layer)
);
