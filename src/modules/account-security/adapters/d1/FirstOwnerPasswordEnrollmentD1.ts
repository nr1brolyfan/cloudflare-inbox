import { maximumSessionAuthenticationEvents } from "@effect-auth/core/Assurance";
import { CustomAuditEventSchema } from "@effect-auth/core/AuditLog";
import { AuthSecrets } from "@effect-auth/core/AuthConfig";
import { AuthRateLimit } from "@effect-auth/core/AuthRateLimit";
import { Crypto } from "@effect-auth/core/Crypto";
import { PasswordHasher } from "@effect-auth/core/Password";
import {
  enforcePasswordRisk,
  PasswordRiskPolicy,
} from "@effect-auth/core/PasswordRisk";
import * as AuthPermission from "@effect-auth/core/Permission";
import {
  and,
  eq,
  exists,
  isNotNull,
  isNull,
  notExists,
  sql,
} from "drizzle-orm";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

import { authApiKey } from "#/auth/schema/modules/api-keys";
import { authAuditLog } from "#/auth/schema/modules/audit-log";
import { authUserIdentity } from "#/auth/schema/modules/core";
import { authCredential } from "#/auth/schema/modules/credentials";
import { authPasskeyCredential } from "#/auth/schema/modules/passkeys";
import {
  authPermissionGrant,
  authRoleGrant,
} from "#/auth/schema/modules/permissions";
import { authRecoveryCode } from "#/auth/schema/modules/recovery-codes";
import { authSession } from "#/auth/schema/modules/sessions";
import { authTotpFactor } from "#/auth/schema/modules/totp";
import {
  appAccountRecoveryCompletionReceipt,
  appExternalRecoveryIdentity,
  appExternalRecoveryOperationReceipt,
  appFirstOwnerPasswordEnrollment,
  appPasskeyCredentialRevocation,
  appPasskeyEnrollmentReceipt,
  appRecoveryCodeRotationReceipt,
} from "#/modules/account-security/adapters/d1/AccountSecuritySchema";
import {
  EnrollFirstOwnerPasswordCommand,
  FirstOwnerPasswordAlreadyEnrolled,
  FirstOwnerPasswordEnrolled,
  FirstOwnerPasswordEnrollment,
  FirstOwnerPasswordEnrollmentError,
  FirstOwnerPasswordEnrollmentReceipt,
} from "#/modules/account-security/application/FirstOwnerPasswordEnrollment";
import {
  AUTHENTICATION_EVENT_SCHEMA_VERSION,
  CONTROL_PLANE_STEP_UP_POLICY,
} from "#/modules/account-security/domain/StepUpPolicy";
import { transactionalSessionPredicate } from "#/modules/account-security/integration/AccountSecurityD1RequestGuard";
import { FirstOwnerPasswordEnrollmentTransaction } from "#/modules/account-security/ports/FirstOwnerPasswordEnrollmentTransaction";
import { MailboxBootstrapConfig } from "#/modules/organization/contracts/MailboxBootstrapConfig";
import { firstOwnerEnrollmentDeploymentEmptyPredicate } from "#/modules/organization/integration/OrganizationD1Predicates";
import { appAuthorizationGuard } from "#/platform/control-plane-d1/AuthorizationGuardSchema";
import * as ControlPlane from "#/platform/control-plane-d1/ControlPlaneBatch";
import { ControlPlaneDatabase } from "#/platform/control-plane-d1/ControlPlaneDatabase";
import { controlPlaneDatabaseNow } from "#/platform/control-plane-d1/RequestAuthGuard";
import { CurrentRequestAuth } from "#/shared/RequestAuth";
import type { CurrentRequestAuthShape } from "#/shared/RequestAuth";
import { UnixMillis } from "#/shared/Temporal";

export interface FirstOwnerPasswordEnrollmentRuntimeShape {
  readonly now: () => number;
}

export class FirstOwnerPasswordEnrollmentRuntime extends Context.Service<
  FirstOwnerPasswordEnrollmentRuntime,
  FirstOwnerPasswordEnrollmentRuntimeShape
>()("cloudflare-inbox/FirstOwnerPasswordEnrollmentRuntime") {}

export const FirstOwnerPasswordEnrollmentRuntimeLayer = Layer.succeed(
  FirstOwnerPasswordEnrollmentRuntime,
  FirstOwnerPasswordEnrollmentRuntime.of({ now: Date.now })
);

type EnrollmentProofType = "email_otp" | "magic_link";

interface EnrollmentProof {
  readonly identityId: string;
  readonly type: EnrollmentProofType;
  readonly verifiedAt: number;
}

const failure = (
  reason: FirstOwnerPasswordEnrollmentError["reason"],
  cause?: unknown,
  commitState?: FirstOwnerPasswordEnrollmentError["commitState"]
) =>
  new FirstOwnerPasswordEnrollmentError({
    cause,
    ...(commitState === undefined ? {} : { commitState }),
    reason,
  });

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

const requireUnrestricted = (requestAuth: CurrentRequestAuthShape) =>
  (requestAuth.validated.currentSession.claims?.requirements?.length ?? 0) ===
    0 &&
  requestAuth.validated.currentSession.claims?.recoveryEnrollment ===
    undefined &&
  requestAuth.validated.currentSession.claims?.recoveryRemediation === undefined
    ? Effect.void
    : Effect.fail(failure("restricted-session"));

const matchingProof = (
  requestAuth: CurrentRequestAuthShape,
  identityId: string,
  now: number
): EnrollmentProof | undefined => {
  const cutoff = now - CONTROL_PLANE_STEP_UP_POLICY.maxAgeMs;
  let latest: EnrollmentProof | undefined;
  for (const event of requestAuth.validated.currentSession
    .authenticationEvents) {
    if (
      (event.type === "email_otp" || event.type === "magic_link") &&
      event.identityId === identityId &&
      event.verifiedAt >= cutoff &&
      event.verifiedAt <= now &&
      (latest === undefined || event.verifiedAt > latest.verifiedAt)
    ) {
      latest = {
        identityId: event.identityId,
        type: event.type,
        verifiedAt: event.verifiedAt,
      };
    }
  }
  return latest;
};

const ReceiptRow = Schema.Struct({
  actorUserId: Schema.String,
  committedAt: Schema.Number,
  credentialId: Schema.String,
  loginIdentityId: Schema.String,
  operationId: Schema.String,
  passwordIntentDigest: Schema.String,
  proofType: Schema.Literals(["email_otp", "magic_link"]),
  proofVerifiedAt: Schema.Number,
  schemaVersion: Schema.Number,
  sessionId: Schema.String,
});
type ReceiptRow = Schema.Schema.Type<typeof ReceiptRow>;

const receiptFromRow = (row: ReceiptRow) =>
  Schema.decodeUnknownEffect(FirstOwnerPasswordEnrollmentReceipt)({
    committedAt: row.committedAt,
    operationId: row.operationId,
    schemaVersion: row.schemaVersion,
  });

/** One-time first-owner password credential installation over a guarded D1 batch. */
const FirstOwnerPasswordEnrollmentTransactionD1Layer = Layer.effect(
  FirstOwnerPasswordEnrollmentTransaction,
  Effect.gen(function* () {
    const authRateLimit = yield* AuthRateLimit;
    const authSecrets = yield* AuthSecrets;
    const batch = yield* ControlPlane.ControlPlaneBatch;
    const config = yield* MailboxBootstrapConfig;
    const crypto = yield* Crypto;
    const database = yield* ControlPlaneDatabase;
    const hasher = yield* PasswordHasher;
    const passwordRisk = yield* PasswordRiskPolicy;
    const runtime = yield* FirstOwnerPasswordEnrollmentRuntime;

    const readReceipt = (operationId: string) =>
      database
        .select({
          actorUserId: appFirstOwnerPasswordEnrollment.actorUserId,
          committedAt: appFirstOwnerPasswordEnrollment.committedAt,
          credentialId: appFirstOwnerPasswordEnrollment.credentialId,
          loginIdentityId: appFirstOwnerPasswordEnrollment.loginIdentityId,
          operationId: appFirstOwnerPasswordEnrollment.operationId,
          passwordIntentDigest:
            appFirstOwnerPasswordEnrollment.passwordIntentDigest,
          proofType: appFirstOwnerPasswordEnrollment.proofType,
          proofVerifiedAt: appFirstOwnerPasswordEnrollment.proofVerifiedAt,
          schemaVersion: appFirstOwnerPasswordEnrollment.schemaVersion,
          sessionId: appFirstOwnerPasswordEnrollment.sessionId,
        })
        .from(appFirstOwnerPasswordEnrollment)
        .where(eq(appFirstOwnerPasswordEnrollment.operationId, operationId))
        .limit(1)
        .pipe(
          Effect.mapError((cause) => failure("storage", cause)),
          Effect.flatMap(([row]) =>
            row === undefined
              ? Effect.succeed(null)
              : Schema.decodeUnknownEffect(ReceiptRow)(row).pipe(
                  Effect.mapError((cause) => failure("storage", cause)),
                  Effect.flatMap((receipt) =>
                    Effect.all(
                      [
                        database
                          .select({ value: sql`1` })
                          .from(authCredential)
                          .where(
                            and(
                              eq(authCredential.id, receipt.credentialId),
                              eq(authCredential.userId, receipt.actorUserId),
                              eq(authCredential.type, "password")
                            )
                          ),
                        database
                          .select({ value: sql`1` })
                          .from(authUserIdentity)
                          .where(
                            and(
                              eq(authUserIdentity.id, receipt.loginIdentityId),
                              eq(authUserIdentity.userId, receipt.actorUserId)
                            )
                          ),
                        database
                          .select({ value: sql`1` })
                          .from(authAuditLog)
                          .where(
                            and(
                              eq(
                                authAuditLog.id,
                                `first-owner-password-enrollment:${receipt.operationId}`
                              ),
                              eq(authAuditLog.userId, receipt.actorUserId),
                              eq(authAuditLog.actorUserId, receipt.actorUserId),
                              eq(
                                authAuditLog.type,
                                "app.first_owner.password_enrolled"
                              ),
                              eq(authAuditLog.occurredAt, receipt.committedAt),
                              eq(authAuditLog.createdAt, receipt.committedAt),
                              sql`json_valid(${authAuditLog.event})
                                and json_extract(${authAuditLog.event}, '$.version') = 1
                                and json_extract(${authAuditLog.event}, '$.actor.type') = 'user'
                                and json_extract(${authAuditLog.event}, '$.actor.userId') = ${receipt.actorUserId}
                                and json_extract(${authAuditLog.event}, '$.actor.sessionId') = ${receipt.sessionId}
                                and json_extract(${authAuditLog.event}, '$.subject.type') = 'user'
                                and json_extract(${authAuditLog.event}, '$.subject.userId') = ${receipt.actorUserId}
                                and json_extract(${authAuditLog.event}, '$.occurredAt') = ${receipt.committedAt}
                                and json_extract(${authAuditLog.event}, '$.payload.operationId') = ${receipt.operationId}
                                and json_extract(${authAuditLog.event}, '$.payload.credentialId') = ${receipt.credentialId}
                                and json_extract(${authAuditLog.event}, '$.payload.proofType') = ${receipt.proofType}
                                and json_extract(${authAuditLog.event}, '$.payload.proofVerifiedAt') = ${receipt.proofVerifiedAt}
                                and (select count(*) from json_each(${authAuditLog.event}, '$.payload')) = 4
                                and (select count(*) from json_each(${authAuditLog.event})) = 6`
                            )
                          ),
                      ],
                      { concurrency: "unbounded" }
                    ).pipe(
                      Effect.mapError((cause) => failure("storage", cause)),
                      Effect.flatMap((artifacts) =>
                        artifacts.every((rows) => rows.length === 1)
                          ? Effect.succeed(receipt)
                          : Effect.fail(failure("storage"))
                      )
                    )
                  )
                )
          )
        );

    const passwordIntentDigest = (password: string) =>
      crypto
        .hmacSha256({
          data: `first-owner-password-enrollment:v1:${password}`,
          key: authSecrets.privacy,
        })
        .pipe(Effect.mapError((cause) => failure("storage", cause)));

    return FirstOwnerPasswordEnrollmentTransaction.of({
      enroll: (untrusted) =>
        // oxlint-disable-next-line eslint/complexity -- Replay, proof, empty-state, and atomic-result classification form one security transaction.
        Effect.gen(function* () {
          const command = yield* Schema.decodeUnknownEffect(
            EnrollFirstOwnerPasswordCommand
          )(untrusted).pipe(Effect.mapError(() => failure("invalid-input")));
          const requestAuth = yield* CurrentRequestAuth;
          const principal = yield* AuthPermission.CurrentPrincipal;
          yield* ensureTrusted(requestAuth, principal);
          yield* requireUnrestricted(requestAuth);
          const actorUserId = requestAuth.validated.actor.userId;
          const timestamp = Schema.decodeUnknownSync(UnixMillis)(runtime.now());
          yield* authRateLimit
            .require({
              operation: "auth.step_up.password_verify",
              policy: AuthRateLimit.rules([
                {
                  id: "app.first_owner_password.enroll.user",
                  key: "user",
                  limit: 5,
                  window: Duration.minutes(10),
                },
              ]),
              userId: actorUserId,
            })
            .pipe(
              Effect.mapError((cause) =>
                failure(
                  cause._tag === "RateLimitExceededError"
                    ? "rate-limited"
                    : "storage",
                  cause
                )
              )
            );
          const persistedSessionRows = yield* database
            .all(
              sql`select cast(${transactionalSessionPredicate(
                database,
                requestAuth,
                timestamp
              )} as integer) as session_valid`
            )
            .pipe(Effect.mapError((cause) => failure("storage", cause)));
          const [persistedSession] = yield* Schema.decodeUnknownEffect(
            Schema.Array(Schema.Struct({ session_valid: Schema.Number }))
          )(persistedSessionRows).pipe(
            Effect.mapError((cause) => failure("storage", cause))
          );
          if (persistedSession?.session_valid !== 1) {
            return yield* failure("restricted-session");
          }
          const intentDigest = yield* passwordIntentDigest(command.password);
          const replay = yield* readReceipt(command.operationId);
          if (replay !== null) {
            if (
              replay.actorUserId !== actorUserId ||
              replay.passwordIntentDigest !== intentDigest
            ) {
              return yield* failure("operation-conflict");
            }
            const receipt = yield* receiptFromRow(replay).pipe(
              Effect.mapError((cause) => failure("storage", cause))
            );
            return FirstOwnerPasswordAlreadyEnrolled.make({
              _tag: "FirstOwnerPasswordAlreadyEnrolled",
              receipt,
            });
          }
          if (config.ownerEmailAllowlist.length !== 1) {
            return yield* failure("owner-config-invalid");
          }
          const [ownerAddress] = config.ownerEmailAllowlist;
          if (
            ownerAddress.slice(ownerAddress.lastIndexOf("@") + 1) ===
            config.initialDomain
          ) {
            return yield* failure("owner-config-invalid");
          }
          const [identity] = yield* database
            .select({ id: authUserIdentity.id })
            .from(authUserIdentity)
            .where(
              and(
                eq(authUserIdentity.userId, actorUserId),
                eq(authUserIdentity.scopeType, "global"),
                eq(authUserIdentity.scopeId, "global"),
                eq(authUserIdentity.kind, "email"),
                eq(authUserIdentity.normalizedValue, ownerAddress),
                eq(authUserIdentity.isPrimaryLogin, 1),
                isNotNull(authUserIdentity.verifiedAt),
                isNull(authUserIdentity.revokedAt),
                isNull(authUserIdentity.replacedById)
              )
            )
            .limit(1)
            .pipe(Effect.mapError((cause) => failure("storage", cause)));
          if (identity === undefined) {
            return yield* failure("owner-not-eligible");
          }
          const proof = matchingProof(requestAuth, identity.id, timestamp);
          if (proof === undefined) {
            return yield* failure("proof-required");
          }
          const redactedPassword = Redacted.make(command.password);
          yield* enforcePasswordRisk(passwordRisk, {
            operation: "set",
            password: redactedPassword,
          }).pipe(Effect.mapError((cause) => failure("invalid-input", cause)));
          const passwordHash = yield* hasher
            .hash({ password: redactedPassword })
            .pipe(Effect.mapError((cause) => failure("storage", cause)));
          const credentialId = yield* crypto
            .randomToken(16)
            .pipe(Effect.mapError((cause) => failure("storage", cause)));
          const nonce = yield* crypto
            .randomToken(16)
            .pipe(Effect.mapError((cause) => failure("storage", cause)));

          const trustedSession = transactionalSessionPredicate(
            database,
            requestAuth,
            timestamp
          );
          const proofValid = exists(
            database
              .select({ value: sql`1` })
              .from(authSession)
              .where(
                and(
                  eq(authSession.id, requestAuth.validated.actor.sessionId),
                  sql`json_array_length(
                    case when json_valid(${authSession.authenticationEvents})
                      and json_type(${authSession.authenticationEvents}) = 'array'
                    then ${authSession.authenticationEvents} else '[]' end
                  ) <= ${maximumSessionAuthenticationEvents}`,
                  sql`exists (
                    select 1 from json_each(${authSession.authenticationEvents}) event
                     where json_type(event.value, '$.version') = 'integer'
                       and json_extract(event.value, '$.version') = ${AUTHENTICATION_EVENT_SCHEMA_VERSION}
                       and json_extract(event.value, '$.type') = ${proof.type}
                       and json_type(event.value, '$.identityId') = 'text'
                       and json_extract(event.value, '$.identityId') = ${identity.id}
                       and json_type(event.value, '$.verifiedAt') = 'integer'
                       and json_extract(event.value, '$.verifiedAt') = ${proof.verifiedAt}
                       and json_extract(event.value, '$.verifiedAt') between
                         ${controlPlaneDatabaseNow} - ${CONTROL_PLANE_STEP_UP_POLICY.maxAgeMs}
                         and ${controlPlaneDatabaseNow}
                  )`
                )
              )
          );
          const identityValid = exists(
            database
              .select({ value: sql`1` })
              .from(authUserIdentity)
              .where(
                and(
                  eq(authUserIdentity.id, identity.id),
                  eq(authUserIdentity.userId, actorUserId),
                  eq(authUserIdentity.scopeType, "global"),
                  eq(authUserIdentity.scopeId, "global"),
                  eq(authUserIdentity.kind, "email"),
                  eq(authUserIdentity.normalizedValue, ownerAddress),
                  eq(authUserIdentity.isPrimaryLogin, 1),
                  isNotNull(authUserIdentity.verifiedAt),
                  isNull(authUserIdentity.revokedAt),
                  isNull(authUserIdentity.replacedById)
                )
              )
          );
          const deploymentEmpty = and(
            firstOwnerEnrollmentDeploymentEmptyPredicate(database),
            notExists(database.select({ value: sql`1` }).from(authRoleGrant)),
            notExists(
              database.select({ value: sql`1` }).from(authPermissionGrant)
            )
          );
          const credentialStateEmpty = and(
            notExists(database.select({ value: sql`1` }).from(authCredential)),
            notExists(database.select({ value: sql`1` }).from(authApiKey)),
            notExists(
              database.select({ value: sql`1` }).from(authPasskeyCredential)
            ),
            notExists(database.select({ value: sql`1` }).from(authTotpFactor)),
            notExists(
              database.select({ value: sql`1` }).from(authRecoveryCode)
            ),
            notExists(
              database
                .select({ value: sql`1` })
                .from(appExternalRecoveryIdentity)
            ),
            notExists(
              database
                .select({ value: sql`1` })
                .from(appExternalRecoveryOperationReceipt)
            ),
            notExists(
              database
                .select({ value: sql`1` })
                .from(appRecoveryCodeRotationReceipt)
            ),
            notExists(
              database
                .select({ value: sql`1` })
                .from(appAccountRecoveryCompletionReceipt)
            ),
            notExists(
              database
                .select({ value: sql`1` })
                .from(appPasskeyEnrollmentReceipt)
            ),
            notExists(
              database
                .select({ value: sql`1` })
                .from(appPasskeyCredentialRevocation)
            )
          );
          const operationAvailable = notExists(
            database
              .select({ value: sql`1` })
              .from(appFirstOwnerPasswordEnrollment)
          );
          const authorized = exists(
            database
              .select({ value: sql`1` })
              .from(appAuthorizationGuard)
              .where(eq(appAuthorizationGuard.nonce, nonce))
          );
          const auditAvailable = notExists(
            database
              .select({ value: sql`1` })
              .from(authAuditLog)
              .where(
                eq(
                  authAuditLog.id,
                  `first-owner-password-enrollment:${command.operationId}`
                )
              )
          );
          const auditEvent = yield* Schema.decodeUnknownEffect(
            CustomAuditEventSchema
          )({
            actor: {
              sessionId: requestAuth.validated.actor.sessionId,
              type: "user",
              userId: actorUserId,
            },
            occurredAt: timestamp,
            payload: {
              credentialId,
              operationId: command.operationId,
              proofType: proof.type,
              proofVerifiedAt: proof.verifiedAt,
            },
            subject: { type: "user", userId: actorUserId },
            type: "app.first_owner.password_enrolled",
            version: 1,
          }).pipe(Effect.mapError((cause) => failure("storage", cause)));
          const statements: ControlPlane.ControlPlaneStatements = [
            database.insert(appAuthorizationGuard).select(
              sql`select ${nonce} where ${trustedSession}
                    and ${proofValid} and ${identityValid}
                    and ${deploymentEmpty} and ${credentialStateEmpty}
                    and ${operationAvailable} and ${auditAvailable}`
            ),
            database.all(sql`select cast(${trustedSession} as integer)
                                      as session_valid,
                                   cast(${proofValid} as integer)
                                      as proof_valid,
                                   cast(${identityValid} as integer)
                                      as identity_valid,
                                   cast(${deploymentEmpty} as integer)
                                      as deployment_empty,
                                   cast(${credentialStateEmpty} as integer)
                                      as credential_state_empty,
                                   cast(${operationAvailable} as integer)
                                      as operation_available,
                                   cast(${auditAvailable} as integer)
                                      as audit_available,
                                   cast(${authorized} as integer) as authorized`),
            database.insert(authCredential).select(
              database
                .select({
                  createdAt: sql`${timestamp}`.as("created_at"),
                  id: sql`${credentialId}`.as("id"),
                  metadata: sql<null>`null`.as("metadata"),
                  passwordHash: sql`${passwordHash}`.as("password_hash"),
                  revokedAt: sql<null>`null`.as("revoked_at"),
                  type: sql`'password'`.as("type"),
                  updatedAt: sql`${timestamp}`.as("updated_at"),
                  userId: sql`${actorUserId}`.as("user_id"),
                })
                .from(appAuthorizationGuard)
                .where(eq(appAuthorizationGuard.nonce, nonce))
            ),
            database.insert(authAuditLog).select(
              database
                .select({
                  actorUserId: sql`${actorUserId}`.as("actor_user_id"),
                  createdAt: sql`${timestamp}`.as("created_at"),
                  event: sql`${JSON.stringify(auditEvent)}`.as("event"),
                  id: sql`${`first-owner-password-enrollment:${command.operationId}`}`.as(
                    "id"
                  ),
                  occurredAt: sql`${timestamp}`.as("occurred_at"),
                  type: sql`${auditEvent.type}`.as("type"),
                  userId: sql`${actorUserId}`.as("user_id"),
                })
                .from(appAuthorizationGuard)
                .where(eq(appAuthorizationGuard.nonce, nonce))
            ),
            database
              .insert(appFirstOwnerPasswordEnrollment)
              .select(
                database
                  .select({
                    actorUserId: sql`${actorUserId}`.as("actor_user_id"),
                    committedAt: sql`${timestamp}`.as("committed_at"),
                    credentialId: sql`${credentialId}`.as("credential_id"),
                    loginIdentityId: sql`${identity.id}`.as(
                      "login_identity_id"
                    ),
                    operationId: sql`${command.operationId}`.as("operation_id"),
                    passwordIntentDigest: sql`${intentDigest}`.as(
                      "password_intent_digest"
                    ),
                    proofType: sql`${proof.type}`.as("proof_type"),
                    proofVerifiedAt: sql`${proof.verifiedAt}`.as(
                      "proof_verified_at"
                    ),
                    schemaVersion: sql<1>`1`.as("schema_version"),
                    sessionId: sql`${requestAuth.validated.actor.sessionId}`.as(
                      "session_id"
                    ),
                    singletonKey: sql<1>`1`.as("singleton_key"),
                  })
                  .from(appAuthorizationGuard)
                  .where(eq(appAuthorizationGuard.nonce, nonce))
              )
              .returning({
                operation_id: appFirstOwnerPasswordEnrollment.operationId,
              }),
            database
              .delete(appAuthorizationGuard)
              .where(eq(appAuthorizationGuard.nonce, nonce)),
          ];
          const results = yield* batch.execute(statements).pipe(
            Effect.catchTag("ControlPlaneBatchError", (cause) =>
              cause.commitState === "unknown"
                ? readReceipt(command.operationId).pipe(
                    Effect.flatMap((stored) => {
                      if (stored === null) {
                        return Effect.fail(
                          failure("indeterminate", cause.cause, "unknown")
                        );
                      }
                      if (
                        stored.actorUserId !== actorUserId ||
                        stored.passwordIntentDigest !== intentDigest
                      ) {
                        return Effect.fail(failure("operation-conflict"));
                      }
                      return receiptFromRow(stored).pipe(
                        Effect.map((receipt) =>
                          FirstOwnerPasswordAlreadyEnrolled.make({
                            _tag: "FirstOwnerPasswordAlreadyEnrolled",
                            receipt,
                          })
                        ),
                        Effect.mapError((error) => failure("storage", error))
                      );
                    }),
                    Effect.catch((readbackError) =>
                      readbackError.reason === "operation-conflict"
                        ? Effect.fail(readbackError)
                        : Effect.fail(
                            failure("indeterminate", cause.cause, "unknown")
                          )
                    )
                  )
                : Effect.fail(
                    failure("storage", cause.cause, cause.commitState)
                  )
            )
          );
          if (results instanceof FirstOwnerPasswordAlreadyEnrolled) {
            return results;
          }
          const [status] = yield* Schema.decodeUnknownEffect(
            Schema.Array(
              Schema.Struct({
                authorized: Schema.Number,
                audit_available: Schema.Number,
                credential_state_empty: Schema.Number,
                deployment_empty: Schema.Number,
                identity_valid: Schema.Number,
                operation_available: Schema.Number,
                proof_valid: Schema.Number,
                session_valid: Schema.Number,
              })
            )
          )(results[1]?.results).pipe(
            Effect.mapError((cause) => failure("storage", cause))
          );
          if (status?.authorized !== 1) {
            if (status?.session_valid !== 1) {
              return yield* failure("restricted-session");
            }
            if (status.proof_valid !== 1) {
              return yield* failure("proof-required");
            }
            if (status.identity_valid !== 1) {
              return yield* failure("owner-not-eligible");
            }
            if (status.deployment_empty !== 1) {
              return yield* failure("deployment-not-empty");
            }
            if (status.operation_available !== 1) {
              const concurrent = yield* readReceipt(command.operationId);
              if (
                concurrent?.actorUserId === actorUserId &&
                concurrent.passwordIntentDigest === intentDigest
              ) {
                const receipt = yield* receiptFromRow(concurrent).pipe(
                  Effect.mapError((cause) => failure("storage", cause))
                );
                return FirstOwnerPasswordAlreadyEnrolled.make({
                  _tag: "FirstOwnerPasswordAlreadyEnrolled",
                  receipt,
                });
              }
              return yield* failure("operation-conflict");
            }
            if (status.credential_state_empty !== 1) {
              return yield* failure("state-conflict");
            }
            if (status.audit_available !== 1) {
              return yield* failure("state-conflict");
            }
            return yield* failure("storage");
          }
          const receiptRows = yield* Schema.decodeUnknownEffect(
            Schema.Array(Schema.Struct({ operation_id: Schema.String }))
          )(results[4]?.results).pipe(
            Effect.mapError((cause) => failure("storage", cause))
          );
          if (receiptRows[0]?.operation_id !== command.operationId) {
            return yield* failure("storage");
          }
          const receipt = FirstOwnerPasswordEnrollmentReceipt.make({
            committedAt: timestamp,
            operationId: command.operationId,
            schemaVersion: 1,
          });
          return FirstOwnerPasswordEnrolled.make({
            _tag: "FirstOwnerPasswordEnrolled",
            receipt,
          });
        }),
    });
  })
);

export const FirstOwnerPasswordEnrollmentD1Layer =
  FirstOwnerPasswordEnrollment.layerNoDeps.pipe(
    Layer.provide(FirstOwnerPasswordEnrollmentTransactionD1Layer)
  );
