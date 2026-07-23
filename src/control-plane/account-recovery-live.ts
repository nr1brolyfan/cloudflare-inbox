import { recoveryCodeEvidence } from "@effect-auth/core/Assurance";
import { CustomAuditEventSchema } from "@effect-auth/core/AuditLog";
import { AuthFlowState } from "@effect-auth/core/AuthFlow";
import { AuthRateLimit } from "@effect-auth/core/AuthRateLimit";
import { Crypto } from "@effect-auth/core/Crypto";
import {
  ChallengeId,
  UnixMillis,
  UserIdSchema,
} from "@effect-auth/core/Identifiers";
import { RecoveryCodeManagement } from "@effect-auth/core/RecoveryCode";
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

import { EmailAddress } from "#/modules/mailbox/domain/Mailbox";

import {
  AccountRecovery,
  accountRecoveryAccepted,
  AccountRecoveryDelivery,
  AccountRecoveryError,
  CompleteAccountRecoveryCommand,
  externalRecoveryLinkEvidence,
  StartAccountRecoveryCommand,
} from "../auth/account-recovery";
import {
  ExternalRecoveryIdentityId,
  externalRecoveryAddressComparisonKey,
  RecoverySafeIdentityPolicy,
} from "../auth/external-recovery-identity";
import { authAuditLog } from "../auth/schema/modules/audit-log";
import { authUser } from "../auth/schema/modules/core";
import { authRecoveryCode } from "../auth/schema/modules/recovery-codes";
import { authSession } from "../auth/schema/modules/sessions";
import { authVerification } from "../auth/schema/modules/verification";
import * as ControlPlane from "./batch";
import { ControlPlaneDatabase } from "./database";
import { appAuthorizationGuard, appExternalRecoveryIdentity } from "./schema";

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

export const AccountRecoveryLive = Layer.effect(
  AccountRecovery,
  Effect.gen(function* () {
    const authFlowState = yield* AuthFlowState;
    const authRateLimit = yield* AuthRateLimit;
    const batch = yield* ControlPlane.ControlPlaneBatch;
    const crypto = yield* Crypto;
    const database = yield* ControlPlaneDatabase;
    const delivery = yield* AccountRecoveryDelivery;
    const recoveryCodes = yield* RecoveryCodeManagement;
    const recoverySafeIdentity = yield* RecoverySafeIdentityPolicy;
    const sessions = yield* Sessions;
    const verificationStore = yield* VerificationStore;

    return AccountRecovery.of({
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
        Effect.gen(function* () {
          const command = yield* Schema.decodeUnknownEffect(
            CompleteAccountRecoveryCommand
          )(untrusted).pipe(
            Effect.mapError((cause) =>
              failure("complete", "invalid-input", cause)
            )
          );
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
          const auditEvent = yield* Schema.decodeUnknownEffect(
            CustomAuditEventSchema
          )({
            actor: { type: "user", userId: pending.userId },
            occurredAt: completedAt,
            payload: {
              externalRecoveryIdentityId: metadata.externalRecoveryIdentityId,
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
          const results = yield* batch
            .execute([
              database.insert(appAuthorizationGuard).select(
                sql`select ${nonce} where ${exactVerification}
                        and ${codeStillActive}
                        and ${recoveryStillValid}
                        and ${userStillActive}
                        and ${sessionAvailable}`
              ),
              database.all(
                sql`select cast(${authorized} as integer) as authorized`
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
                    secretHash: sql`${prepared.row.secretHash}`.as(
                      "secret_hash"
                    ),
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
                    id: sql`${`account-recovery:${prepared.row.id}`}`.as("id"),
                    occurredAt: sql`${completedAt}`.as("occurred_at"),
                    type: sql`${auditEvent.type}`.as("type"),
                    userId: sql`${pending.userId}`.as("user_id"),
                  })
                  .from(appAuthorizationGuard)
                  .where(eq(appAuthorizationGuard.nonce, nonce))
              ),
              database
                .delete(appAuthorizationGuard)
                .where(eq(appAuthorizationGuard.nonce, nonce)),
            ])
            .pipe(
              Effect.mapError((cause) =>
                failure(
                  "complete",
                  cause.commitState === "unknown" ? "indeterminate" : "storage",
                  cause
                )
              )
            );
          const [status] = yield* Schema.decodeUnknownEffect(
            Schema.Array(Schema.Struct({ authorized: Schema.Number }))
          )(results[1]?.results).pipe(
            Effect.mapError((cause) =>
              failure("complete", "indeterminate", cause)
            )
          );
          if (status?.authorized !== 1) {
            return yield* failure("complete", "invalid-proof");
          }
          return prepared.session;
        }),
    });
  })
);
