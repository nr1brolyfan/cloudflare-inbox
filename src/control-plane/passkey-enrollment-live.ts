import { passkeyEvidence } from "@effect-auth/core/Assurance";
import { CustomAuditEventSchema } from "@effect-auth/core/AuditLog";
import { AuthRateLimit } from "@effect-auth/core/AuthRateLimit";
import { Challenge } from "@effect-auth/core/Challenge";
import { Crypto } from "@effect-auth/core/Crypto";
import {
  CredentialId,
  UnixMillis as AuthUnixMillis,
} from "@effect-auth/core/Identifiers";
import {
  PasskeyOptions,
  PasskeyVerifier,
  passkeyRegistrationChallengeType,
} from "@effect-auth/core/Passkey";
import * as AuthPermission from "@effect-auth/core/Permission";
import { RecoveryCodes } from "@effect-auth/core/RecoveryCode";
import { Sessions } from "@effect-auth/core/Sessions";
import {
  and,
  eq,
  exists,
  gt,
  isNotNull,
  isNull,
  ne,
  notExists,
  sql,
} from "drizzle-orm";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

import { UnixMillis } from "#/modules/mailbox/domain/Mailbox";

import {
  ACCOUNT_RECOVERY_EVIDENCE_POLICY_ID,
  ACCOUNT_RECOVERY_EVIDENCE_POLICY_VERSION,
} from "../auth/account-recovery";
import { PasskeyRuntimeConfig } from "../auth/passkey-config";
import {
  EnrolledPasskeyCredential,
  FinishPasskeyEnrollmentCommand,
  PasskeyEnrollment,
  PasskeyEnrollmentChallengeMetadata,
  PasskeyEnrollmentError,
  RecoveryPasskeyRemediationCompleted,
  StartPasskeyEnrollmentCommand,
  StartedPasskeyEnrollment,
} from "../auth/passkey-enrollment";
import { authAuditLog } from "../auth/schema/modules/audit-log";
import { authUserIdentity } from "../auth/schema/modules/core";
import { authCredential } from "../auth/schema/modules/credentials";
import { authPasskeyCredential } from "../auth/schema/modules/passkeys";
import { authRecoveryCode } from "../auth/schema/modules/recovery-codes";
import { authSession } from "../auth/schema/modules/sessions";
import { authTotpFactor } from "../auth/schema/modules/totp";
import { authVerification } from "../auth/schema/modules/verification";
import type { CurrentRequestAuthShape } from "../auth/session";
import { CurrentRequestAuth } from "../auth/session";
import {
  CONTROL_PLANE_STEP_UP_POLICY,
  requireSensitiveOperationStepUp,
  SensitiveOperationStepUpClock,
} from "../auth/step-up-policy";
import * as ControlPlane from "./batch";
import { ControlPlaneDatabase } from "./database";
import {
  controlPlaneDatabaseNow,
  recoveryRemediationSessionPredicate,
  sensitiveSessionPredicate,
  transactionalSessionPredicate,
} from "./request-auth-guard-d1";
import { appAuthorizationGuard, appExternalRecoveryIdentity } from "./schema";

export interface PasskeyEnrollmentRuntime {
  readonly now: () => number;
  readonly randomId: () => string;
}

export const PasskeyEnrollmentRuntime =
  Context.Service<PasskeyEnrollmentRuntime>(
    "cloudflare-inbox/PasskeyEnrollmentRuntime"
  );

export const PasskeyEnrollmentRuntimeLive = Layer.succeed(
  PasskeyEnrollmentRuntime,
  PasskeyEnrollmentRuntime.of({
    now: Date.now,
    randomId: () => crypto.randomUUID(),
  })
);

const error = (
  operation: "finish" | "start",
  reason: PasskeyEnrollmentError["reason"],
  cause?: unknown
) => new PasskeyEnrollmentError({ cause, operation, reason });

const ensureTrusted = (
  requestAuth: CurrentRequestAuthShape,
  principal: AuthPermission.PermissionSubject
) => {
  const { validated } = requestAuth;
  return principal.type === "user" &&
    principal.id === validated.actor.userId &&
    validated.actor.userId === validated.currentSession.userId &&
    validated.actor.userId === validated.issued.userId &&
    validated.actor.sessionId === validated.currentSession.sessionId &&
    validated.actor.sessionId === validated.issued.sessionId
    ? Effect.void
    : Effect.die(new Error("Current request auth contexts are inconsistent"));
};

const requireSession = (
  requestAuth: CurrentRequestAuthShape,
  operation: "finish" | "start"
) =>
  (requestAuth.validated.currentSession.claims?.requirements?.length ?? 0) === 0
    ? Effect.void
    : Effect.fail(error(operation, "restricted-session"));

const nullableJson = (value: unknown | undefined) =>
  value === undefined ? null : JSON.stringify(value);

const backedUpValue = (value: boolean | undefined) => {
  if (value === undefined) {
    return null;
  }
  return value ? 1 : 0;
};

/** Guarded first-passkey enrollment over the maintained effect-auth primitives. */
export const PasskeyEnrollmentLive = Layer.effect(
  PasskeyEnrollment,
  Effect.gen(function* () {
    const batch = yield* ControlPlane.ControlPlaneBatch;
    const authRateLimit = yield* AuthRateLimit;
    const challenge = yield* Challenge;
    const crypto = yield* Crypto;
    const database = yield* ControlPlaneDatabase;
    const options = yield* PasskeyOptions;
    const passkeyConfig = yield* PasskeyRuntimeConfig;
    const runtime = yield* PasskeyEnrollmentRuntime;
    const recoveryCodes = yield* RecoveryCodes;
    const sessions = yield* Sessions;
    const stepUpClock = yield* SensitiveOperationStepUpClock;
    const verifier = yield* PasskeyVerifier;

    const prerequisites = (operation: "finish" | "start") =>
      Effect.gen(function* () {
        const requestAuth = yield* CurrentRequestAuth;
        const principal = yield* AuthPermission.CurrentPrincipal;
        yield* ensureTrusted(requestAuth, principal);
        const { claims } = requestAuth.validated.currentSession;
        const recoveryMode =
          claims?.requirements?.length === 1 &&
          claims.requirements[0] === "recovery_remediation" &&
          claims.recoveryRemediation?.allowed.includes("second-passkey") ===
            true;
        const recoveryEvidence = recoveryMode
          ? requestAuth.validated.currentSession.authenticationEvents.find(
              (event) =>
                event.type === "custom" &&
                event.policyId === ACCOUNT_RECOVERY_EVIDENCE_POLICY_ID &&
                event.policyVersion ===
                  ACCOUNT_RECOVERY_EVIDENCE_POLICY_VERSION &&
                event.kind === "external-recovery-link"
            )
          : undefined;
        const boundRecoveryIdentityId =
          recoveryEvidence?.type === "custom"
            ? recoveryEvidence.properties.externalRecoveryIdentityId
            : undefined;
        const boundRecoveryIdentityVersion =
          recoveryEvidence?.type === "custom"
            ? recoveryEvidence.properties.externalRecoveryIdentityVersion
            : undefined;
        if (
          recoveryMode &&
          (typeof boundRecoveryIdentityId !== "string" ||
            typeof boundRecoveryIdentityVersion !== "number" ||
            !Number.isSafeInteger(boundRecoveryIdentityVersion))
        ) {
          return yield* error(operation, "restricted-session");
        }
        if (!recoveryMode) {
          yield* requireSession(requestAuth, operation);
          yield* requireSensitiveOperationStepUp(
            requestAuth.validated.currentSession,
            stepUpClock.now()
          ).pipe(Effect.mapError(() => error(operation, "step-up-required")));
        }
        yield* authRateLimit
          .require({
            operation:
              operation === "start"
                ? "auth.passkey.registration_start"
                : "auth.passkey.registration_finish",
            userId: requestAuth.validated.actor.userId,
          })
          .pipe(
            Effect.mapError((cause) =>
              error(
                operation,
                cause._tag === "RateLimitExceededError"
                  ? "rate-limited"
                  : "storage",
                cause
              )
            )
          );
        const [recovery] = yield* database
          .select({
            id: appExternalRecoveryIdentity.id,
            version: appExternalRecoveryIdentity.version,
          })
          .from(appExternalRecoveryIdentity)
          .where(
            and(
              eq(
                appExternalRecoveryIdentity.userId,
                requestAuth.validated.actor.userId
              ),
              eq(appExternalRecoveryIdentity.status, "verified"),
              recoveryMode
                ? eq(
                    appExternalRecoveryIdentity.id,
                    boundRecoveryIdentityId as string
                  )
                : undefined,
              recoveryMode
                ? eq(
                    appExternalRecoveryIdentity.version,
                    boundRecoveryIdentityVersion as number
                  )
                : undefined
            )
          )
          .limit(1)
          .pipe(Effect.mapError((cause) => error(operation, "storage", cause)));
        if (recovery === undefined) {
          return yield* error(operation, "recovery-identity-required");
        }
        return { recovery, recoveryMode, requestAuth };
      });

    return PasskeyEnrollment.of({
      start: (untrusted) =>
        Effect.gen(function* () {
          yield* Schema.decodeUnknownEffect(StartPasskeyEnrollmentCommand)(
            untrusted
          ).pipe(
            Effect.mapError((cause) => error("start", "invalid-input", cause))
          );
          const { recovery, recoveryMode, requestAuth } =
            yield* prerequisites("start");
          const [identity] = yield* database
            .select({ value: authUserIdentity.value })
            .from(authUserIdentity)
            .where(
              and(
                eq(authUserIdentity.userId, requestAuth.validated.actor.userId),
                eq(authUserIdentity.kind, "email")
              )
            )
            .limit(1)
            .pipe(Effect.mapError((cause) => error("start", "storage", cause)));
          const userName =
            identity?.value ?? requestAuth.validated.actor.userId;
          const operationId = Schema.decodeUnknownSync(
            PasskeyEnrollmentChallengeMetadata.fields.operationId
          )(runtime.randomId());
          const started = yield* options
            .startRegistration({
              attestation: passkeyConfig.attestation,
              authenticatorSelection: passkeyConfig.authenticatorSelection,
              metadata: {
                authorization: recoveryMode
                  ? "recovery-remediation"
                  : "step-up",
                operationId,
                purpose: "passkey-enrollment",
                recoveryIdentityId: recovery.id,
                recoveryIdentityVersion: recovery.version,
                sessionId: requestAuth.validated.actor.sessionId,
                sessionSecretHash: requestAuth.sessionSecretHash,
                stepUpPolicyId: CONTROL_PLANE_STEP_UP_POLICY.id,
                stepUpPolicyVersion: CONTROL_PLANE_STEP_UP_POLICY.version,
              },
              relyingParty: passkeyConfig.relyingParty,
              userDisplayName: userName,
              userId: requestAuth.validated.actor.userId,
              userName,
            })
            .pipe(Effect.mapError((cause) => error("start", "storage", cause)));
          return yield* Schema.decodeUnknownEffect(StartedPasskeyEnrollment)(
            started
          ).pipe(Effect.mapError((cause) => error("start", "storage", cause)));
        }),
      finish: (untrusted) =>
        // oxlint-disable-next-line eslint/complexity -- Authorization, credential insertion, and recovery rotation must share one atomic batch.
        Effect.gen(function* () {
          const command = yield* Schema.decodeUnknownEffect(
            FinishPasskeyEnrollmentCommand
          )(untrusted).pipe(
            Effect.mapError((cause) => error("finish", "invalid-input", cause))
          );
          const { recovery, recoveryMode, requestAuth } =
            yield* prerequisites("finish");
          const verified = yield* verifier
            .verifyRegistration({
              expectedOrigin: passkeyConfig.expectedOrigin,
              relyingPartyId: passkeyConfig.relyingParty.id,
              requireUserVerification: true,
              response: command.credential,
              userId: requestAuth.validated.actor.userId,
            })
            .pipe(
              Effect.mapError((cause) =>
                error("finish", "verification-failed", cause)
              )
            );
          if (
            !Number.isSafeInteger(verified.signCount) ||
            verified.signCount < 0
          ) {
            return yield* error("finish", "verification-failed");
          }
          const inspected = yield* challenge
            .inspect({
              challengeId: command.challengeId,
              secret: Redacted.make(verified.challenge),
              type: passkeyRegistrationChallengeType,
            })
            .pipe(
              Effect.mapError((cause) =>
                error("finish", "challenge-invalid", cause)
              )
            );
          const metadata = yield* Schema.decodeUnknownEffect(
            PasskeyEnrollmentChallengeMetadata
          )(inspected.metadata).pipe(
            Effect.mapError((cause) =>
              error("finish", "challenge-invalid", cause)
            )
          );
          if (
            inspected.subject !== requestAuth.validated.actor.userId ||
            metadata.sessionId !== requestAuth.validated.actor.sessionId ||
            metadata.sessionSecretHash !== requestAuth.sessionSecretHash ||
            metadata.authorization !==
              (recoveryMode ? "recovery-remediation" : "step-up") ||
            metadata.recoveryIdentityId !== recovery.id ||
            metadata.recoveryIdentityVersion !== recovery.version
          ) {
            return yield* error("finish", "challenge-invalid");
          }

          const timestamp = Schema.decodeUnknownSync(UnixMillis)(runtime.now());
          const authTimestamp = AuthUnixMillis(timestamp);
          const enrolled = yield* Schema.decodeUnknownEffect(
            EnrolledPasskeyCredential
          )({ credentialId: verified.credentialId }).pipe(
            Effect.mapError((cause) => error("finish", "storage", cause))
          );
          const nonce = runtime.randomId();
          const recordId = yield* crypto
            .randomToken(16)
            .pipe(
              Effect.mapError((cause) => error("finish", "storage", cause))
            );
          const remediation = recoveryMode
            ? yield* Effect.gen(function* () {
                const [identity] = yield* database
                  .select({ id: authUserIdentity.id })
                  .from(authUserIdentity)
                  .where(
                    and(
                      eq(
                        authUserIdentity.userId,
                        requestAuth.validated.actor.userId
                      ),
                      eq(authUserIdentity.isPrimaryLogin, 1),
                      isNotNull(authUserIdentity.verifiedAt),
                      isNull(authUserIdentity.revokedAt)
                    )
                  )
                  .limit(1)
                  .pipe(
                    Effect.mapError((cause) =>
                      error("finish", "storage", cause)
                    )
                  );
                if (
                  identity === undefined ||
                  sessions.prepareCreate === undefined
                ) {
                  return yield* error("finish", "storage");
                }
                const replacementIdentityId = yield* crypto
                  .randomToken(16)
                  .pipe(
                    Effect.mapError((cause) =>
                      error("finish", "storage", cause)
                    )
                  );
                const plaintext = yield* recoveryCodes
                  .generate({ count: 10, groupSize: 4, length: 16 })
                  .pipe(
                    Effect.mapError((cause) =>
                      error("finish", "storage", cause)
                    )
                  );
                const codeRecords = yield* Effect.all(
                  plaintext.map((code) =>
                    Effect.gen(function* () {
                      const codeHash = yield* recoveryCodes
                        .hash({ code })
                        .pipe(
                          Effect.mapError((cause) =>
                            error("finish", "storage", cause)
                          )
                        );
                      const id = yield* crypto
                        .randomToken(16)
                        .pipe(
                          Effect.mapError((cause) =>
                            error("finish", "storage", cause)
                          )
                        );
                      return { codeHash, id };
                    })
                  )
                );
                const authenticationEvidence = passkeyEvidence({
                  backedUp: verified.backedUp,
                  credentialId: CredentialId(verified.credentialId),
                  signCount: verified.signCount,
                  userVerification: "verified",
                  verifiedAt: authTimestamp,
                });
                const prepared = yield* sessions
                  .prepareCreate({
                    authenticationEvents: [authenticationEvidence],
                    claims: {
                      verifiedIdentityKinds: ["email", "recovery-passkey"],
                    },
                    metadata: { purpose: "account-recovery-completed" },
                    now: authTimestamp,
                    userId: requestAuth.validated.actor.userId,
                  })
                  .pipe(
                    Effect.mapError((cause) =>
                      error("finish", "storage", cause)
                    )
                  );
                const body = yield* Schema.decodeUnknownEffect(
                  RecoveryPasskeyRemediationCompleted
                )({
                  codes: plaintext.map((code) => Redacted.value(code)),
                  credentialId: verified.credentialId,
                  generatedAt: timestamp,
                  type: "recovery-remediation-completed",
                }).pipe(
                  Effect.mapError((cause) => error("finish", "storage", cause))
                );
                return {
                  body,
                  codeRecords,
                  previousIdentityId: identity.id,
                  prepared,
                  replacementIdentityId,
                };
              })
            : undefined;
          const trustedStepUpSession = recoveryMode
            ? recoveryRemediationSessionPredicate(
                database,
                requestAuth,
                timestamp
              )
            : sensitiveSessionPredicate(database, requestAuth, timestamp);
          const trustedBaseSession = recoveryMode
            ? trustedStepUpSession
            : transactionalSessionPredicate(database, requestAuth, timestamp);
          const metadataJson = JSON.stringify(metadata);
          const auditEvent = yield* Schema.decodeUnknownEffect(
            CustomAuditEventSchema
          )({
            actor: {
              sessionId: requestAuth.validated.actor.sessionId,
              type: "user",
              userId: requestAuth.validated.actor.userId,
            },
            occurredAt: timestamp,
            payload: {
              credentialRecordId: recordId,
              operationId: metadata.operationId,
            },
            subject: {
              type: "user",
              userId: requestAuth.validated.actor.userId,
            },
            type: "app.passkey.enrolled",
            version: 1,
          }).pipe(
            Effect.mapError((cause) => error("finish", "storage", cause))
          );
          const remediationAuditEvent =
            remediation === undefined
              ? undefined
              : yield* Schema.decodeUnknownEffect(CustomAuditEventSchema)({
                  actor: {
                    sessionId: requestAuth.validated.actor.sessionId,
                    type: "user",
                    userId: requestAuth.validated.actor.userId,
                  },
                  occurredAt: timestamp,
                  payload: {
                    codeCount: remediation.codeRecords.length,
                    credentialRecordId: recordId,
                    operationId: metadata.operationId,
                  },
                  subject: {
                    type: "user",
                    userId: requestAuth.validated.actor.userId,
                  },
                  type: "app.account_recovery.completed",
                  version: 1,
                }).pipe(
                  Effect.mapError((cause) => error("finish", "storage", cause))
                );
          const recoveryValid = exists(
            database
              .select({ value: sql`1` })
              .from(appExternalRecoveryIdentity)
              .where(
                and(
                  eq(appExternalRecoveryIdentity.id, recovery.id),
                  eq(
                    appExternalRecoveryIdentity.userId,
                    requestAuth.validated.actor.userId
                  ),
                  eq(appExternalRecoveryIdentity.status, "verified"),
                  eq(appExternalRecoveryIdentity.version, recovery.version)
                )
              )
          );
          const challengeValid = exists(
            database
              .select({ value: sql`1` })
              .from(authVerification)
              .where(
                and(
                  eq(authVerification.id, command.challengeId),
                  eq(authVerification.type, "passkey-registration"),
                  eq(
                    authVerification.subject,
                    requestAuth.validated.actor.userId
                  ),
                  isNull(authVerification.consumedAt),
                  gt(authVerification.expiresAt, controlPlaneDatabaseNow),
                  eq(authVerification.metadata, metadataJson)
                )
              )
          );
          const credentialAvailable = notExists(
            database
              .select({ value: sql`1` })
              .from(authPasskeyCredential)
              .where(
                eq(authPasskeyCredential.credentialId, verified.credentialId)
              )
          );
          const authorized = exists(
            database
              .select({ value: sql`1` })
              .from(appAuthorizationGuard)
              .where(eq(appAuthorizationGuard.nonce, nonce))
          );
          const remediationStatements: readonly ControlPlane.ControlPlaneStatement[] =
            remediation === undefined || remediationAuditEvent === undefined
              ? []
              : [
                  database
                    .update(authSession)
                    .set({ revokedAt: timestamp })
                    .where(
                      and(
                        eq(
                          authSession.userId,
                          requestAuth.validated.actor.userId
                        ),
                        ne(authSession.id, remediation.prepared.row.id),
                        isNull(authSession.revokedAt),
                        authorized
                      )
                    ),
                  database
                    .update(authUserIdentity)
                    .set({
                      replacedById: remediation.replacementIdentityId,
                      revokedAt: sql<number>`max(
                        ${timestamp},
                        ${authUserIdentity.createdAt},
                        ${controlPlaneDatabaseNow}
                      )`,
                      updatedAt: sql<number>`max(
                        ${timestamp},
                        ${authUserIdentity.updatedAt},
                        ${controlPlaneDatabaseNow}
                      )`,
                    })
                    .where(
                      and(
                        eq(authUserIdentity.id, remediation.previousIdentityId),
                        eq(
                          authUserIdentity.userId,
                          requestAuth.validated.actor.userId
                        ),
                        eq(authUserIdentity.isPrimaryLogin, 1),
                        isNotNull(authUserIdentity.verifiedAt),
                        isNull(authUserIdentity.revokedAt),
                        authorized
                      )
                    ),
                  database.insert(authUserIdentity).select(
                    database
                      .select({
                        createdAt: sql`${timestamp}`.as("created_at"),
                        id: sql`${remediation.replacementIdentityId}`.as("id"),
                        isPrimaryLogin: sql`1`.as("is_primary_login"),
                        kind: sql`'recovery-passkey'`.as("kind"),
                        metadata: sql`${JSON.stringify({
                          purpose: "account-recovery-completed",
                        })}`.as("metadata"),
                        normalizedValue:
                          sql`${requestAuth.validated.actor.userId}`.as(
                            "normalized_value"
                          ),
                        replacedById: sql<null>`null`.as("replaced_by_id"),
                        revokedAt: sql<null>`null`.as("revoked_at"),
                        scopeId: sql`'global'`.as("scope_id"),
                        scopeType: sql`'global'`.as("scope_type"),
                        updatedAt: sql`${timestamp}`.as("updated_at"),
                        userId: sql`${requestAuth.validated.actor.userId}`.as(
                          "user_id"
                        ),
                        value: sql`${requestAuth.validated.actor.userId}`.as(
                          "value"
                        ),
                        verifiedAt: sql`${timestamp}`.as("verified_at"),
                      })
                      .from(appAuthorizationGuard)
                      .where(eq(appAuthorizationGuard.nonce, nonce))
                  ),
                  database
                    .update(authPasskeyCredential)
                    .set({
                      revokedAt: sql<number>`max(
                        ${timestamp},
                        ${authPasskeyCredential.createdAt},
                        ${controlPlaneDatabaseNow}
                      )`,
                    })
                    .where(
                      and(
                        eq(
                          authPasskeyCredential.userId,
                          requestAuth.validated.actor.userId
                        ),
                        ne(authPasskeyCredential.id, recordId),
                        isNull(authPasskeyCredential.revokedAt),
                        authorized
                      )
                    ),
                  database
                    .update(authCredential)
                    .set({
                      revokedAt: sql<number>`max(
                        ${timestamp},
                        ${authCredential.createdAt},
                        ${controlPlaneDatabaseNow}
                      )`,
                      updatedAt: sql<number>`max(
                        ${timestamp},
                        ${authCredential.updatedAt},
                        ${controlPlaneDatabaseNow}
                      )`,
                    })
                    .where(
                      and(
                        eq(
                          authCredential.userId,
                          requestAuth.validated.actor.userId
                        ),
                        isNull(authCredential.revokedAt),
                        authorized
                      )
                    ),
                  database
                    .update(authTotpFactor)
                    .set({
                      revokedAt: sql<number>`max(
                        ${timestamp},
                        ${authTotpFactor.createdAt},
                        ${controlPlaneDatabaseNow}
                      )`,
                    })
                    .where(
                      and(
                        eq(
                          authTotpFactor.userId,
                          requestAuth.validated.actor.userId
                        ),
                        isNull(authTotpFactor.revokedAt),
                        authorized
                      )
                    ),
                  database
                    .update(authRecoveryCode)
                    .set({
                      revokedAt: sql<number>`max(
                        ${timestamp},
                        ${authRecoveryCode.createdAt},
                        ${controlPlaneDatabaseNow}
                      )`,
                    })
                    .where(
                      and(
                        eq(
                          authRecoveryCode.userId,
                          requestAuth.validated.actor.userId
                        ),
                        isNull(authRecoveryCode.usedAt),
                        isNull(authRecoveryCode.revokedAt),
                        authorized
                      )
                    ),
                  ...remediation.codeRecords.map((code) =>
                    database.insert(authRecoveryCode).select(
                      sql`select ${code.id},
                                 ${requestAuth.validated.actor.userId},
                                 ${code.codeHash}, ${timestamp}, null, null,
                                 ${JSON.stringify({ purpose: "account-recovery-completed" })}
                          where ${authorized}`
                    )
                  ),
                  database.insert(authSession).select(
                    database
                      .select({
                        aal: sql`${remediation.prepared.row.aal}`.as("aal"),
                        amr: sql`${JSON.stringify(remediation.prepared.row.amr)}`.as(
                          "amr"
                        ),
                        authTime: sql`${remediation.prepared.row.authTime}`.as(
                          "auth_time"
                        ),
                        authenticationEvents:
                          sql`${JSON.stringify(remediation.prepared.row.authenticationEvents)}`.as(
                            "authentication_events"
                          ),
                        createdAt:
                          sql`${remediation.prepared.row.createdAt}`.as(
                            "created_at"
                          ),
                        expiresAt:
                          sql`${remediation.prepared.row.expiresAt}`.as(
                            "expires_at"
                          ),
                        id: sql`${remediation.prepared.row.id}`.as("id"),
                        lastSeenAt: sql<null>`null`.as("last_seen_at"),
                        metadata: sql`${JSON.stringify({
                          __effectAuthSession: {
                            claims: remediation.prepared.row.claims,
                            metadata: remediation.prepared.row.metadata,
                            version: 1,
                          },
                        })}`.as("metadata"),
                        mfaVerifiedAt:
                          remediation.prepared.row.mfaVerifiedAt === undefined
                            ? sql<null>`null`.as("mfa_verified_at")
                            : sql`${remediation.prepared.row.mfaVerifiedAt}`.as(
                                "mfa_verified_at"
                              ),
                        revokedAt: sql<null>`null`.as("revoked_at"),
                        rotatedAt: sql<null>`null`.as("rotated_at"),
                        secretHash:
                          sql`${remediation.prepared.row.secretHash}`.as(
                            "secret_hash"
                          ),
                        userId: sql`${remediation.prepared.row.userId}`.as(
                          "user_id"
                        ),
                      })
                      .from(appAuthorizationGuard)
                      .where(eq(appAuthorizationGuard.nonce, nonce))
                  ),
                  database.insert(authAuditLog).select(
                    database
                      .select({
                        actorUserId:
                          sql`${requestAuth.validated.actor.userId}`.as(
                            "actor_user_id"
                          ),
                        createdAt: sql`${timestamp}`.as("created_at"),
                        event: sql`${JSON.stringify(remediationAuditEvent)}`.as(
                          "event"
                        ),
                        id: sql`${`account-recovery-completed:${metadata.operationId}`}`.as(
                          "id"
                        ),
                        occurredAt: sql`${timestamp}`.as("occurred_at"),
                        type: sql`${remediationAuditEvent.type}`.as("type"),
                        userId: sql`${requestAuth.validated.actor.userId}`.as(
                          "user_id"
                        ),
                      })
                      .from(appAuthorizationGuard)
                      .where(eq(appAuthorizationGuard.nonce, nonce))
                  ),
                ];
          const statements: ControlPlane.ControlPlaneStatements = [
            database.insert(appAuthorizationGuard).select(
              sql`select ${nonce} where ${trustedStepUpSession}
                      and ${recoveryValid}
                      and ${challengeValid}
                      and ${credentialAvailable}`
            ),
            database.all(sql`select cast(${trustedStepUpSession} as integer)
                                      as step_up_valid,
                                   cast(${trustedBaseSession} as integer)
                                      as session_valid,
                                   cast(${recoveryValid} as integer)
                                      as recovery_valid,
                                   cast(${challengeValid} as integer)
                                      as challenge_valid,
                                   cast(${credentialAvailable} as integer)
                                      as credential_available,
                                   cast(${authorized} as integer) as authorized`),
            database
              .update(authVerification)
              .set({ consumedAt: timestamp })
              .where(
                and(
                  eq(authVerification.id, command.challengeId),
                  eq(authVerification.type, "passkey-registration"),
                  isNull(authVerification.consumedAt),
                  authorized
                )
              ),
            database
              .insert(authPasskeyCredential)
              .select(
                database
                  .select({
                    backedUp: sql`${backedUpValue(verified.backedUp)}`.as(
                      "backed_up"
                    ),
                    createdAt: sql`${timestamp}`.as("created_at"),
                    credentialId: sql`${verified.credentialId}`.as(
                      "credential_id"
                    ),
                    id: sql`${recordId}`.as("id"),
                    metadata: sql`${nullableJson(verified.metadata)}`.as(
                      "metadata"
                    ),
                    publicKey: sql`${verified.publicKey}`.as("public_key"),
                    signCount: sql`${verified.signCount}`.as("sign_count"),
                    transports: sql`${nullableJson(verified.transports)}`.as(
                      "transports"
                    ),
                    userId: sql`${requestAuth.validated.actor.userId}`.as(
                      "user_id"
                    ),
                  })
                  .from(appAuthorizationGuard)
                  .where(eq(appAuthorizationGuard.nonce, nonce))
              )
              .returning({
                credential_id: authPasskeyCredential.credentialId,
              }),
            ...remediationStatements,
            database.insert(authAuditLog).select(
              database
                .select({
                  actorUserId: sql`${requestAuth.validated.actor.userId}`.as(
                    "actor_user_id"
                  ),
                  createdAt: sql`${timestamp}`.as("created_at"),
                  event: sql`${JSON.stringify(auditEvent)}`.as("event"),
                  id: sql`${`passkey-enrollment:${metadata.operationId}`}`.as(
                    "id"
                  ),
                  occurredAt: sql`${timestamp}`.as("occurred_at"),
                  type: sql`${auditEvent.type}`.as("type"),
                  userId: sql`${requestAuth.validated.actor.userId}`.as(
                    "user_id"
                  ),
                })
                .from(appAuthorizationGuard)
                .where(eq(appAuthorizationGuard.nonce, nonce))
            ),
            database
              .delete(appAuthorizationGuard)
              .where(eq(appAuthorizationGuard.nonce, nonce)),
          ];
          const results = yield* batch.execute(statements).pipe(
            Effect.mapError(
              (cause) =>
                new PasskeyEnrollmentError({
                  cause: cause.cause,
                  commitState: cause.commitState,
                  operation: "finish",
                  reason:
                    cause.commitState === "unknown"
                      ? "indeterminate"
                      : "storage",
                })
            )
          );
          const [status] = yield* Schema.decodeUnknownEffect(
            Schema.Array(
              Schema.Struct({
                authorized: Schema.Number,
                challenge_valid: Schema.Number,
                credential_available: Schema.Number,
                recovery_valid: Schema.Number,
                session_valid: Schema.Number,
                step_up_valid: Schema.Number,
              })
            )
          )(results[1]?.results).pipe(
            Effect.mapError((cause) => error("finish", "indeterminate", cause))
          );
          if (status?.authorized !== 1) {
            if (status?.session_valid !== 1) {
              return yield* error("finish", "restricted-session");
            }
            if (status?.step_up_valid !== 1) {
              return yield* error("finish", "step-up-required");
            }
            if (status.recovery_valid !== 1) {
              return yield* error("finish", "recovery-identity-required");
            }
            if (status.credential_available !== 1) {
              return yield* error("finish", "credential-conflict");
            }
            return yield* error("finish", "challenge-invalid");
          }
          const returned = yield* Schema.decodeUnknownEffect(
            Schema.Array(Schema.Struct({ credential_id: Schema.String }))
          )(results[3]?.results).pipe(
            Effect.mapError((cause) => error("finish", "indeterminate", cause))
          );
          if (returned[0]?.credential_id !== verified.credentialId) {
            return yield* error("finish", "indeterminate");
          }
          return remediation === undefined
            ? enrolled
            : {
                ...enrolled,
                remediation: {
                  body: remediation.body,
                  session: remediation.prepared.session,
                },
              };
        }),
    });
  })
);
