import { CustomAuditEventSchema } from "@effect-auth/core/AuditLog";
import { AuthRateLimit } from "@effect-auth/core/AuthRateLimit";
import { Challenge } from "@effect-auth/core/Challenge";
import { Crypto } from "@effect-auth/core/Crypto";
import {
  PasskeyOptions,
  PasskeyVerifier,
  passkeyRegistrationChallengeType,
} from "@effect-auth/core/Passkey";
import * as AuthPermission from "@effect-auth/core/Permission";
import { and, eq, exists, gt, isNull, notExists, sql } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

import { PasskeyRuntimeConfig } from "../auth/passkey-config";
import {
  EnrolledPasskeyCredential,
  FinishPasskeyEnrollmentCommand,
  PasskeyEnrollment,
  PasskeyEnrollmentChallengeMetadata,
  PasskeyEnrollmentError,
  StartPasskeyEnrollmentCommand,
  StartedPasskeyEnrollment,
} from "../auth/passkey-enrollment";
import { authAuditLog } from "../auth/schema/modules/audit-log";
import { authUserIdentity } from "../auth/schema/modules/core";
import { authPasskeyCredential } from "../auth/schema/modules/passkeys";
import { authVerification } from "../auth/schema/modules/verification";
import type { CurrentRequestAuthShape } from "../auth/session";
import { CurrentRequestAuth } from "../auth/session";
import {
  CONTROL_PLANE_STEP_UP_POLICY,
  requireSensitiveOperationStepUp,
  SensitiveOperationStepUpClock,
} from "../auth/step-up-policy";
import { UnixMillis } from "../mailboxes/core";
import * as ControlPlane from "./batch";
import { ControlPlaneDatabase } from "./database";
import {
  controlPlaneDatabaseNow,
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
    const stepUpClock = yield* SensitiveOperationStepUpClock;
    const verifier = yield* PasskeyVerifier;

    const prerequisites = (operation: "finish" | "start") =>
      Effect.gen(function* () {
        const requestAuth = yield* CurrentRequestAuth;
        const principal = yield* AuthPermission.CurrentPrincipal;
        yield* ensureTrusted(requestAuth, principal);
        yield* requireSession(requestAuth, operation);
        yield* requireSensitiveOperationStepUp(
          requestAuth.validated.currentSession,
          stepUpClock.now()
        ).pipe(Effect.mapError(() => error(operation, "step-up-required")));
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
              eq(appExternalRecoveryIdentity.status, "verified")
            )
          )
          .limit(1)
          .pipe(Effect.mapError((cause) => error(operation, "storage", cause)));
        if (recovery === undefined) {
          return yield* error(operation, "recovery-identity-required");
        }
        return { recovery, requestAuth };
      });

    return PasskeyEnrollment.of({
      start: (untrusted) =>
        Effect.gen(function* () {
          yield* Schema.decodeUnknownEffect(StartPasskeyEnrollmentCommand)(
            untrusted
          ).pipe(
            Effect.mapError((cause) => error("start", "invalid-input", cause))
          );
          const { recovery, requestAuth } = yield* prerequisites("start");
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
                operationId,
                purpose: "passkey-enrollment",
                recoveryIdentityId: recovery.id,
                recoveryIdentityVersion: recovery.version,
                sessionId: requestAuth.validated.actor.sessionId,
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
        Effect.gen(function* () {
          const command = yield* Schema.decodeUnknownEffect(
            FinishPasskeyEnrollmentCommand
          )(untrusted).pipe(
            Effect.mapError((cause) => error("finish", "invalid-input", cause))
          );
          const { recovery, requestAuth } = yield* prerequisites("finish");
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
            metadata.recoveryIdentityId !== recovery.id ||
            metadata.recoveryIdentityVersion !== recovery.version
          ) {
            return yield* error("finish", "challenge-invalid");
          }

          const timestamp = Schema.decodeUnknownSync(UnixMillis)(runtime.now());
          const nonce = runtime.randomId();
          const recordId = yield* crypto
            .randomToken(16)
            .pipe(
              Effect.mapError((cause) => error("finish", "storage", cause))
            );
          const trustedStepUpSession = sensitiveSessionPredicate(
            database,
            requestAuth,
            timestamp
          );
          const trustedBaseSession = transactionalSessionPredicate(
            database,
            requestAuth,
            timestamp
          );
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
                  reason: "storage",
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
            Effect.mapError((cause) => error("finish", "storage", cause))
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
            Effect.mapError((cause) => error("finish", "storage", cause))
          );
          if (returned[0]?.credential_id !== verified.credentialId) {
            return yield* error("finish", "storage");
          }
          return yield* Schema.decodeUnknownEffect(EnrolledPasskeyCredential)({
            credentialId: verified.credentialId,
          }).pipe(
            Effect.mapError((cause) => error("finish", "storage", cause))
          );
        }),
    });
  })
);
