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
import { and, eq } from "drizzle-orm";
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
import { authUserIdentity } from "../auth/schema/modules/core";
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
  sensitiveSessionParams,
  sensitiveSessionPredicate,
  sessionParams,
  transactionalSessionPredicate,
} from "./request-auth-guard-d1";
import { appExternalRecoveryIdentity } from "./schema";

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
          const sessionParameters = sensitiveSessionParams(
            requestAuth,
            timestamp
          );
          const baseSessionParameters = sessionParams(requestAuth, timestamp);
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
          const recoveryPredicate = `exists (
            select 1 from app_external_recovery_identity
             where id = ? and user_id = ? and status = 'verified'
               and version = ?
          )`;
          const challengePredicate = `exists (
            select 1 from auth_verification
             where id = ? and type = 'passkey-registration'
               and subject = ? and consumed_at is null
               and expires_at > ${controlPlaneDatabaseNow}
               and metadata = ?
          )`;
          const credentialAvailablePredicate = `not exists (
            select 1 from auth_passkey_credential where credential_id = ?
          )`;
          const recoveryParams = [
            recovery.id,
            requestAuth.validated.actor.userId,
            recovery.version,
          ] as const;
          const challengeParams = [
            command.challengeId,
            requestAuth.validated.actor.userId,
            metadataJson,
          ] as const;
          const statements: readonly ControlPlane.ControlPlaneStatement[] = [
            {
              sql: `insert into app_authorization_guard (nonce)
                    select ? where ${sensitiveSessionPredicate}
                      and ${recoveryPredicate}
                      and ${challengePredicate}
                      and ${credentialAvailablePredicate}`,
              params: [
                nonce,
                ...sessionParameters,
                ...recoveryParams,
                ...challengeParams,
                verified.credentialId,
              ],
            },
            {
              sql: `select cast(${sensitiveSessionPredicate} as integer)
                              as step_up_valid,
                           cast(${transactionalSessionPredicate} as integer)
                              as session_valid,
                           cast(${recoveryPredicate} as integer)
                              as recovery_valid,
                           cast(${challengePredicate} as integer)
                              as challenge_valid,
                           cast(${credentialAvailablePredicate} as integer)
                              as credential_available,
                           cast(exists (select 1 from app_authorization_guard
                                        where nonce = ?) as integer)
                              as authorized`,
              params: [
                ...sessionParameters,
                ...baseSessionParameters,
                ...recoveryParams,
                ...challengeParams,
                verified.credentialId,
                nonce,
              ],
            },
            {
              sql: `update auth_verification set consumed_at = ?
                     where id = ? and type = 'passkey-registration'
                       and consumed_at is null
                       and exists (select 1 from app_authorization_guard
                                    where nonce = ?)`,
              params: [timestamp, command.challengeId, nonce],
            },
            {
              sql: `insert into auth_passkey_credential
                      (id, user_id, credential_id, public_key, sign_count,
                       transports, backed_up, created_at, metadata)
                    select ?, ?, ?, ?, ?, ?, ?, ?, ?
                       from app_authorization_guard where nonce = ?
                     returning credential_id`,
              params: [
                recordId,
                requestAuth.validated.actor.userId,
                verified.credentialId,
                verified.publicKey,
                verified.signCount,
                nullableJson(verified.transports),
                backedUpValue(verified.backedUp),
                timestamp,
                nullableJson(verified.metadata),
                nonce,
              ],
            },
            {
              sql: `insert into auth_audit_log
                      (id, type, user_id, actor_user_id, occurred_at, event,
                       created_at)
                    select ?, ?, ?, ?, ?, ?, ?
                      from app_authorization_guard where nonce = ?`,
              params: [
                `passkey-enrollment:${metadata.operationId}`,
                auditEvent.type,
                requestAuth.validated.actor.userId,
                requestAuth.validated.actor.userId,
                timestamp,
                JSON.stringify(auditEvent),
                timestamp,
                nonce,
              ],
            },
            {
              sql: "delete from app_authorization_guard where nonce = ?",
              params: [nonce],
            },
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
